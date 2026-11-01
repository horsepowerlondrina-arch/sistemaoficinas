import { fipePlacaAllowed, fipePlacaToken, lookupFipePlaca } from "./fipePlaca.js";
import type { DB } from "../db/database.js";
import { z } from "zod";
type FipeLookup = Awaited<ReturnType<typeof lookupFipePlaca>>;
const pending = new WeakMap<object, Map<string, Promise<FipeLookup>>>();
type PublicLookupResult = {
  source: string;
  vehicle: Record<string, unknown> | null;
  message: string;
  [key: string]: unknown;
};
function publicCachedLookup(result: Record<string, unknown>): PublicLookupResult {
  const { _confirmation: _discardConfirmation, ...publicResult } = result;
  return publicResult as PublicLookupResult;
}
async function cachedFipeLookup(
  db: DB,
  tenant: string,
  plate: string,
  token: string,
  fetcher: typeof fetch,
) {
  const saved = await db
    .prepare(
      "SELECT result_json FROM vehicle_lookup_cache WHERE tenant_id=? AND plate=? AND expires_at>?",
    )
    .get(tenant, plate, Date.now());
  if (saved) return { ...publicCachedLookup(JSON.parse(saved.result_json) as Record<string, unknown>), cache_status: "hit" };
  let running = pending.get(db);
  if (!running) {
    running = new Map();
    pending.set(db, running);
  }
  const key = JSON.stringify([tenant, plate]);
  if (running.has(key)) return running.get(key)!;
  const task = (async () => {
    const result = await lookupFipePlaca(plate, token, fetcher, true);
    const ttl =
      "fipe_status" in result && result.fipe_status === "found"
        ? 86400000
        : 600000;
    try {
      await db
        .prepare(
          "INSERT INTO vehicle_lookup_cache(tenant_id,plate,result_json,expires_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,plate) DO UPDATE SET result_json=excluded.result_json,expires_at=excluded.expires_at",
        )
        .run(tenant, plate, JSON.stringify(result), Date.now() + ttl);
      await db
        .prepare("DELETE FROM vehicle_lookup_cache WHERE tenant_id=? AND expires_at<?")
        .run(tenant, Date.now());
    } catch {
      // Do not discard a paid provider result or trigger a client retry if only caching failed.
    }
    return { ...result, cache_status: "miss" };
  })();
  running.set(key, task);
  try {
    return await task;
  } finally {
    running.delete(key);
  }
}
export const normalizePlate = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function providerToken(tenant: string, authorized?: boolean) {
  if (authorized === false) return null;
  const current = fipePlacaToken(tenant, authorized);
  if (current) return current;
  return legacyProviderToken(tenant);
}
function legacyProviderToken(tenant: string) {
  try {
    const entries = JSON.parse(process.env.PLACA_FIPE_TOKENS_JSON || "{}");
    return typeof entries[tenant] === "string" ? entries[tenant] : null;
  } catch {
    return null;
  }
}
export function plateLookupStatus(tenant: string, authorized?: boolean) {
  const configured = !!providerToken(tenant, true);
  const allowed = authorized ?? (fipePlacaAllowed(tenant) || !!legacyProviderToken(tenant));
  return {
    status: !allowed ? "unauthorized" : !configured ? "not_configured" : "available",
    enabled: allowed && configured,
    configured,
    authorized: allowed,
  };
}
export async function vehicleLookupAccess(db: DB, tenant: string) {
  const modules = await db.getTenantModuleAccess?.(tenant);
  return {...plateLookupStatus(tenant, modules?.external_plate_lookup), override: modules?.external_plate_lookup};
}
function unavailableLookup(status: string) {
  return {
    source: "unavailable",
    vehicle: null,
    code: status === "unauthorized" ? "plate_lookup_forbidden" : "plate_lookup_not_configured",
    message: status === "unauthorized"
      ? "A consulta externa de placas não está autorizada para esta oficina. Solicite a liberação ao administrador; o cadastro manual continua disponível."
      : "A integração de consulta de placas não está configurada para esta oficina. Solicite a configuração ao administrador; o cadastro manual continua disponível.",
  };
}
const responseSchema = z.object({
  codigo: z.number(),
  informacoes_veiculo: z
    .object({
      marca: z.string().max(150),
      modelo: z.string().max(150),
      ano: z.union([z.string(), z.number()]).optional(),
      ano_modelo: z.union([z.string(), z.number()]).optional(),
      combustivel: z.string().max(80).optional(),
      cor: z.string().max(80).optional(),
    })
    .optional(),
});
export async function lookupVehicleExternal(
  db: DB,
  tenant: string,
  rawPlate: string,
  fetcher: typeof fetch = fetch,
) {
  const plate = normalizePlate(rawPlate);
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate))
    throw new Error("Informe uma placa válida.");
  const access = await vehicleLookupAccess(db, tenant);
  if (!access.enabled) return unavailableLookup(access.status);
  const token = providerToken(tenant, access.override)!;
  if (fipePlacaToken(tenant, access.override))
    return cachedFipeLookup(db, tenant, plate, token, fetcher);
  const saved = await db.prepare(
    "SELECT result_json FROM vehicle_lookup_cache WHERE tenant_id=? AND plate=? AND expires_at>?",
  ).get(tenant, plate, Date.now());
  if (saved) return { ...publicCachedLookup(JSON.parse(saved.result_json) as Record<string, unknown>), cache_status: "hit" };
  try {
    const response = await fetcher("https://api.placafipe.com.br/getplaca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placa: plate, token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("provider");
    const result = responseSchema.parse(await response.json());
    if (result.codigo !== 1 || !result.informacoes_veiculo)
      return {
        source: "not_found",
        vehicle: null,
        message: "Placa não localizada pelo provedor. Confira a placa ou preencha os dados.",
      };
    const current = result.informacoes_veiculo;
    const year = Number(current.ano_modelo || current.ano);
    const output = {
      source: "external",
      vehicle: {
        plate,
        brand: current.marca,
        model: current.modelo,
        year: Number.isInteger(Number(current.ano)) && Number(current.ano) >= 1900 && Number(current.ano) <= 2100 ? Number(current.ano) : Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
        model_year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
        fuel: current.combustivel || "",
        color: current.cor || "",
      },
      message: "Dados consultados via Placa FIPE. Confira antes de salvar.",
      cache_status: "miss",
    };
    try {
      await db.prepare(
        "INSERT INTO vehicle_lookup_cache(tenant_id,plate,result_json,expires_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,plate) DO UPDATE SET result_json=excluded.result_json,expires_at=excluded.expires_at",
      ).run(tenant, plate, JSON.stringify(output), Date.now() + 86400000);
    } catch {
      // Keep the external preview available if cache persistence alone fails.
    }
    return output;
  } catch {
    throw Object.assign(
      new Error("A consulta externa não respondeu. Tente novamente ou preencha os dados manualmente."),
      { status: 502 },
    );
  }
}
export async function lookupVehicle(
  db: DB,
  tenant: string,
  rawPlate: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  source: string;
  vehicle: Record<string, unknown> | null;
  message: string;
}> {
  const plate = normalizePlate(rawPlate);
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate))
    throw new Error("Informe uma placa válida.");
  const local = await db
    .prepare(
      "SELECT id,customer_id,plate,brand,model,year,model_year,fuel,color,km,chassis,active,fipe_code,fipe_model,fipe_year_id,service_model_id,service_porte_id,service_link_mode FROM vehicles WHERE tenant_id=? AND plate=?",
    )
    .get(tenant, plate);
  if (local)
    return {
      source: "local",
      vehicle: local,
      message: "Veículo encontrado no cadastro desta oficina.",
    };
  return lookupVehicleExternal(db, tenant, plate, fetcher);
}
