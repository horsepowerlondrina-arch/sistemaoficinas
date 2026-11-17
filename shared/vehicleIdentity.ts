export function vehicleDisplayModel(vehicle: unknown): string {
  const value = vehicle as { fipe_model?: unknown; model?: unknown } | null | undefined;
  return String(value?.fipe_model || value?.model || "").trim();
}

export function vehicleModelYear(vehicle: { model_year?: unknown; fipe_year_id?: unknown; year?: unknown } | null | undefined): number | null {
  const explicit = Number(vehicle?.model_year);
  if (Number.isInteger(explicit) && explicit >= 1900 && explicit <= 2100) return explicit;
  const fipe = String(vehicle?.fipe_year_id || "").match(/^(19\d{2}|20\d{2}|21\d{2})-/);
  return fipe ? Number(fipe[1]) : null;
}

export function lookupWouldReplace(current: Record<string, any>, incoming: Record<string, any>): boolean {
  return ["brand", "model", "year", "color", "chassis", "fipe_model", "fipe_code", "fipe_year_id", "model_year", "fuel"].some((field) =>
    incoming[field] !== undefined && incoming[field] !== null && incoming[field] !== "" &&
    current[field] !== undefined && current[field] !== null && current[field] !== "" &&
    String(incoming[field]) !== String(current[field]));
}

// Provider omissions must not clear manually entered data or a technical link.
export function mergeVehicleLookup(current: Record<string, any>, incoming: Record<string, any> | null): Record<string, any> {
  const next = { ...current };
  for (const field of ["plate", "brand", "model", "year", "color", "chassis", "fipe_model", "fipe_code", "fipe_year_id", "model_year", "fuel"]) {
    const value = incoming?.[field];
    if (value !== undefined && value !== null && value !== "") next[field] = value;
  }
  return next;
}
