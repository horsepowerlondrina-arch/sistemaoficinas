export const PORTE_RATE_IDS = ["compacto", "medio", "premium", "pesado"] as const;
export type PorteRateId = (typeof PORTE_RATE_IDS)[number];
export const PORTE_NAMES: Readonly<Record<PorteRateId, string>> = {
  compacto: "Compacto", medio: "Médio", premium: "Premium", pesado: "Pesado",
};

// The catalog UUID identifies the classification; this key selects the tenant's tariff.
export function porteRateId(name: unknown): PorteRateId | undefined {
  return PORTE_RATE_IDS.find((id) => PORTE_NAMES[id] === name);
}
