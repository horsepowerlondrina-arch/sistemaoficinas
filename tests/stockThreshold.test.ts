import test from "node:test";
import assert from "node:assert/strict";
import { needsReplenishment } from "../shared/stockThreshold";

test("estoque mínimo zero representa produto sob demanda sem alerta", () => {
  assert.equal(needsReplenishment({ stock: 0, minimum_stock: 0, stock_verified: 1 }), false);
  assert.equal(needsReplenishment({ stock: -1, minimum_stock: 0, stock_verified: 1 }), false);
});

test("produtos mantidos em estoque alertam ao atingir o mínimo confirmado", () => {
  assert.equal(needsReplenishment({ stock: 1, minimum_stock: 1, stock_verified: 1 }), true);
  assert.equal(needsReplenishment({ stock: 0, minimum_stock: 2, stock_verified: 1 }), true);
  assert.equal(needsReplenishment({ stock: 3, minimum_stock: 2, stock_verified: 1 }), false);
  assert.equal(needsReplenishment({ stock: 0, minimum_stock: 2, stock_verified: 0 }), false);
});
