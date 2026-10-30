export interface FipeCandidate {
  codigoFipe: string | null;
  modelo: string | null;
  anoModelo: number | null;
  anoId: string | null;
  combustivel: string | null;
  confianca: "alta" | "media" | "baixa" | null;
  matchAno: boolean | null;
  matchCombustivel: boolean | null;
}
export const emptyFipe = { fipe_code: "", fipe_model: "", fipe_year_id: "", model_year: null, fuel: "" };
export function fipeFields(value: Record<string, any> | null | undefined) {
  return {
    fipe_code: String(value?.fipe_code || ""),
    fipe_model: String(value?.fipe_model || ""),
    fipe_year_id: String(value?.fipe_year_id || ""),
    model_year: Number(value?.model_year) || null,
    fuel: String(value?.fuel || ""),
  };
}
export function candidateFields(candidate?: FipeCandidate) {
  return candidate?.codigoFipe
    ? {
        fipe_code: candidate.codigoFipe,
        fipe_model: candidate.modelo || "",
        fipe_year_id: candidate.anoId || "",
        model_year: candidate.anoModelo || null,
        fuel: candidate.combustivel || "",
      }
    : { ...emptyFipe };
}
export function automaticFipe(candidates: FipeCandidate[], year?: number) {
  const only = candidates.length === 1 ? candidates[0] : undefined;
  return only?.confianca === "alta" &&
    only.matchAno === true &&
    only.matchCombustivel !== false &&
    only.anoModelo === year &&
    only.codigoFipe
    ? candidateFields(only)
    : { ...emptyFipe };
}
