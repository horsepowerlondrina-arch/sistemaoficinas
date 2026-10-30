import { z } from "zod";
import { automaticFipe, type FipeCandidate } from "../../shared/vehicleFipe.js";
const candidateSchema = z.object({
  codigoFipe: z
    .string()
    .regex(/^\d{6}-\d$/)
    .nullable(),
  modelo: z.string().max(300).nullable(),
  anoModelo: z.number().int().nullable(),
  anoId: z.string().max(30).nullable(),
  combustivel: z.string().max(150).nullable(),
  confianca: z.enum(["alta", "media", "baixa"]).nullable(),
  matchAno: z.boolean().nullable(),
  matchCombustivel: z.boolean().nullable(),
});
export async function lookupFipeCandidates(
  plate: string,
  token: string,
  fetcher: typeof fetch,
) {
  try {
    const response = await fetcher(
      `https://api.fipeplaca.com.br/gateway/v1/placa/${plate}/fipe`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.status === 404)
      return { status: "not_found", candidates: [] as FipeCandidate[] };
    if (!response.ok)
      return { status: "unavailable", candidates: [] as FipeCandidate[] };
    const parsed = z
      .array(candidateSchema)
      .max(1000)
      .safeParse(await response.json());
    if (!parsed.success)
      return { status: "unavailable", candidates: [] as FipeCandidate[] };
    return {
      status: parsed.data.length ? "found" : "not_found",
      candidates: parsed.data,
    };
  } catch {
    return { status: "unavailable", candidates: [] as FipeCandidate[] };
  }
}
export function fipePlacaToken(tenant: string): string | null {
  const allowedTenants = new Set(
    (process.env.FIPEPLACA_ALLOWED_TENANT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedTenants.has(tenant)) return null;
  try {
    const entries = JSON.parse(process.env.FIPEPLACA_TOKENS_JSON || "{}");
    return typeof entries?.[tenant] === "string" && entries[tenant].trim()
      ? entries[tenant].trim()
      : null;
  } catch {
    return null;
  }
}
const vehicleSchema = z.object({
  marca: z.string().max(150).nullable(),
  modelo: z.string().max(150).nullable(),
  anoFabricacao: z.number().int().nullable(),
  anoModelo: z.number().int().nullable(),
  cor: z.string().max(80).nullable(),
});
export async function lookupFipePlaca(
  plate: string,
  token: string,
  fetcher: typeof fetch,
  includeFipe = false,
) {
  let response: Response;
  try {
    response = await fetcher(
      `https://api.fipeplaca.com.br/gateway/v1/placa/${plate}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw Object.assign(
      new Error(
        "A consulta FipePlaca não respondeu. Tente novamente ou preencha os dados manualmente.",
      ),
      { status: 502 },
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = body?.erro?.codigo;
    if (response.status === 404 && code === "PLACA_NAO_ENCONTRADA")
      return {
        source: "not_found",
        vehicle: null,
        message:
          "Placa não localizada. Confira a placa ou preencha os dados manualmente.",
      };
    const messages: Record<string, string> = {
      SEM_SALDO:
        "Saldo FipePlaca insuficiente. Recarregue a conta do provedor ou preencha os dados manualmente.",
      CHAVE_INVALIDA:
        "A chave FipePlaca precisa ser conferida pelo administrador.",
      ERRO_401:
        "O provedor bloqueou a conexão do servidor. Entre em contato com o suporte FipePlaca.",
      ERRO_403:
        "O provedor bloqueou a conexão do servidor. Entre em contato com o suporte FipePlaca.",
      FILA_CHEIA:
        "O provedor está ocupado. Aguarde um momento antes de tentar novamente.",
    };
    throw Object.assign(
      new Error(
        messages[code] ||
          "Consulta FipePlaca indisponível. Tente novamente ou preencha os dados manualmente.",
      ),
      { status: 502 },
    );
  }
  const result = vehicleSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!result.success)
    throw Object.assign(
      new Error(
        "O provedor retornou dados em formato inesperado. Preencha os dados manualmente.",
      ),
      { status: 502 },
    );
  const v = result.data,
    year = v.anoModelo ?? v.anoFabricacao;
  const fipe = includeFipe
    ? await lookupFipeCandidates(plate, token, fetcher)
    : null;
  const selection = fipe
    ? automaticFipe(fipe.candidates, year ?? undefined)
    : null;
  return {
    source: "external",
    vehicle: {
      plate,
      ...(v.marca ? { brand: v.marca } : {}),
      ...(v.modelo ? { model: v.modelo } : {}),
      ...(v.anoFabricacao !== null && v.anoFabricacao >= 1900 && v.anoFabricacao <= 2100 ? { year: v.anoFabricacao } : {}),
      ...(v.anoModelo !== null && v.anoModelo >= 1900 && v.anoModelo <= 2100 ? { model_year: v.anoModelo } : {}),
      ...(v.cor ? { color: v.cor } : {}),
      ...(selection || {}),
    },
    ...(fipe
      ? { fipe_candidates: fipe.candidates, fipe_status: fipe.status }
      : {}),
    message:
      "Dados consultados via FipePlaca. Confira antes de salvar." +
      (fipe?.status === "unavailable"
        ? " A busca FIPE não respondeu; os dados do veículo foram preservados."
        : fipe?.status === "not_found"
          ? " Não foi encontrada uma identificação FIPE."
          : fipe && !selection?.fipe_code
            ? " Confirme a versão na lista FIPE."
            : ""),
  };
}
