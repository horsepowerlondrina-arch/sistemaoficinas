import { fipePlacaToken, lookupFipePlaca } from "./fipePlaca.js";
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
export function providerToken(tenant: string) {
  const current = fipePlacaToken(tenant);
  if (current) return current;
  try {
    const entries = JSON.parse(process.env.PLACA_FIPE_TOKENS_JSON || "{}");
    return typeof entries[tenant] === "string" ? entries[tenant] : null;
  } catch {
    return null;
  }
}
const responseSchema = z.object({
  codigo: z.number(),
  informacoes_veiculo: z
    .object({
      marca: z.string().max(150),
      modelo: z.string().max(150),
      ano: z.union([z.string(), z.number()]).optional(),
      ano_modelo: z.union([z.string(), z.number()]).optional(),
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
  const token = providerToken(tenant);
  if (!token)
    return {
      source: "unavailable",
      vehicle: null,
      message: "A consulta externa não está ativada para esta oficina.",
    };
  if (fipePlacaToken(tenant))
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
        year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
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
      "SELECT id,customer_id,plate,brand,model,year,color,km,chassis,active,fipe_code,fipe_model,fipe_year_id,service_model_id,service_porte_id FROM vehicles WHERE tenant_id=? AND plate=?",
    )
    .get(tenant, plate);
  if (local)
    return {
      source: "local",
      vehicle: local,
      message: "Veículo encontrado no cadastro desta oficina.",
    };
  const token = providerToken(tenant);
  if (!token)
    return {
      source: "unavailable",
      vehicle: null,
      message:
        "Placa não cadastrada. A consulta externa ainda não foi ativada para esta oficina; preencha os dados manualmente.",
    };
  const currentToken = fipePlacaToken(tenant);
  if (currentToken)
    return cachedFipeLookup(db, tenant, plate, currentToken, fetcher);
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
        message:
          "Placa não localizada pelo provedor. Confira a placa ou preencha os dados.",
      };
    const v = result.informacoes_veiculo;
    const year = Number(v.ano_modelo || v.ano);
    return {
      source: "external",
      vehicle: {
        plate,
        brand: v.marca,
        model: v.modelo,
        year:
          Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
        color: v.cor || "",
      },
      message: "Dados consultados via Placa FIPE. Confira antes de salvar.",
    };
  } catch {
    throw Object.assign(
      new Error(
        "A consulta externa não respondeu. Tente novamente ou preencha os dados manualmente.",
      ),
      { status: 502 },
    );
  }
}
