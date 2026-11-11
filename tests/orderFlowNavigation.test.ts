import test from "node:test";
import assert from "node:assert/strict";
import {
  orderFilterStorageKey,
  readOrderFilterSearch,
  saveOrderFilterSearch,
  clearOrderFilterSession,
} from "../src/lib/orderFilterSession";
import { receiptIsCompleteAfterSettlement } from "../src/lib/receiptCompletion";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key(index: number) { return [...map.keys()][index] || null; },
    getItem(key: string) { return map.get(key) || null; },
    setItem(key: string, value: string) { map.set(key, value); },
    removeItem(key: string) { map.delete(key); },
  };
}

test("OS filters survive route changes per user and workshop until logout", () => {
  const storage = memoryStorage();
  const own = orderFilterStorageKey("workshop-a", "owner-a");
  const other = orderFilterStorageKey("workshop-b", "owner-a");
  saveOrderFilterSearch(storage, own, "status=ready,completed&basis=completion&from=2026-11-01&to=2026-11-10");
  assert.equal(readOrderFilterSearch(storage, own), "status=ready%2Ccompleted&basis=completion&from=2026-11-01&to=2026-11-10");
  assert.equal(readOrderFilterSearch(storage, other), "");
  saveOrderFilterSearch(storage, other, "status=quote");
  clearOrderFilterSession(storage);
  assert.equal(readOrderFilterSearch(storage, own), "");
  assert.equal(readOrderFilterSearch(storage, other), "");
});

test("receipt exit appears only after all payment portions are settled", () => {
  const parts = [
    { id: "pix", method: "Pix", status: "paid" },
    { id: "cash", method: "Dinheiro", status: "open" },
    { id: "credit", method: "Cartão de crédito", status: "open" },
  ];
  assert.equal(receiptIsCompleteAfterSettlement(parts, "cash", false), false);
  assert.equal(receiptIsCompleteAfterSettlement(parts, "credit", true), false);
  assert.equal(receiptIsCompleteAfterSettlement(parts.map((part) => part.id === "cash" ? { ...part, status: "paid" } : part), "credit", true), true);
  assert.equal(receiptIsCompleteAfterSettlement([{ id: "pix", method: "Pix", status: "open" }], "pix", false), true);
});
