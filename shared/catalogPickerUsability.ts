export function initialCatalogOptionIndex(count: number): number {
  return count > 0 ? 0 : -1;
}

export function nextCatalogOptionIndex(
  current: number,
  count: number,
  direction: -1 | 1,
): number {
  if (count <= 0) return -1;
  if (current < 0) return 0;
  return Math.max(0, Math.min(count - 1, current + direction));
}

export function canAddRepairServiceImmediately(input: {
  execution: string;
  cost: number;
  minutes: number;
  hourlyRate: number;
  price: number;
  pricingMode: string;
  hasCategory: boolean;
}): boolean {
  if (!input.hasCategory) return false;
  if (input.execution === "outsourced") return input.cost > 0;
  if (input.pricingMode === "price") return input.price > 0;
  return input.minutes > 0 && input.hourlyRate > 0;
}
