export type ServiceTab = "private" | "times";

export function serviceTabFromSearch(search: string): ServiceTab {
  return new URLSearchParams(search).get("aba") === "tempos" ? "times" : "private";
}

export function timesRedirectTarget(search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.set("aba", "tempos");
  return `/servicos?${params.toString()}${hash}`;
}

export function technicalLaborPrice(minutes: number, hourlyRateCents: number): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isSafeInteger(hourlyRateCents) || hourlyRateCents <= 0) return null;
  return Math.round(minutes * hourlyRateCents / 60);
}
