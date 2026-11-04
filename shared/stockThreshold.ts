export type StockThreshold = {
  stock?: number | null;
  minimum_stock?: number | null;
  stock_verified?: number | null;
};

export function needsReplenishment(product: StockThreshold): boolean {
  const minimum = Number(product.minimum_stock ?? 0);
  const stock = Number(product.stock ?? 0);
  return minimum > 0 &&
    product.stock_verified !== 0 &&
    stock <= minimum;
}
