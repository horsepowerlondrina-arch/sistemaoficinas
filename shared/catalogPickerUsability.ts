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

export function shouldAutoSelectCatalogVehicle(match: {
  status?: string;
  model?: unknown;
}): boolean {
  return match.status === "matched" && !!match.model;
}

export function serviceDropdownStateAfterAdd(): {
  open: false;
  activeIndex: -1;
} {
  return { open: false, activeIndex: -1 };
}

export function calculateCatalogDropdownPlacement(
  rect: { left: number; top: number; right: number; bottom: number; width: number },
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; maxHeight: number } {
  const gap = 4;
  const edge = 12;
  const controlsHeight = 52;
  const below = Math.max(0, viewport.height - rect.bottom - edge);
  const above = Math.max(0, rect.top - edge);
  const openBelow = below >= 150 || below >= above;
  const available = openBelow ? below : above;
  const maxHeight = Math.max(80, Math.min(320, available - controlsHeight));
  const totalHeight = maxHeight + controlsHeight;
  const top = openBelow
    ? rect.bottom + gap
    : Math.max(8, rect.top - totalHeight - gap);
  const width = Math.max(0, Math.min(rect.width, viewport.width - 16));
  const left = Math.max(8, Math.min(rect.left, viewport.width - width - 8));
  return { left, top, width, maxHeight };
}
