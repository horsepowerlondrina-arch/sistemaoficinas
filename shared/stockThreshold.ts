export function needsReplenishment(product: Record<string, unknown>): boolean {
  const minimum = Number(product.minimum_stock ?? 0);
  const stock = Number(product.stock ?? 0);
  return minimum > 0 &&
    product.stock_verified !== 0 &&
    stock <= minimum;
}
