export type StockThreshold = {
  stock: number;
  minimum_stock: number;
  stock_verified?: number | null;
};

export function needsReplenishment(product: StockThreshold): boolean {
  return product.minimum_stock > 0 &&
    product.stock_verified !== 0 &&
    product.stock <= product.minimum_stock;
}
