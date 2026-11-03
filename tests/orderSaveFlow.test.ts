import test from "node:test";
import assert from "node:assert/strict";
import { saveOrderAndRefresh } from "../src/lib/orderSaveFlow";

test("confirmed OS save opens its record when the workspace refresh succeeds", async () => {
  const calls: string[] = [];
  const result = await saveOrderAndRefresh(
    async () => { calls.push("save"); return { id: "order-1" }; },
    async () => { calls.push("refresh"); },
  );
  assert.deepEqual(result, { id: "order-1", refreshed: true });
  assert.deepEqual(calls, ["save", "refresh"]);
});

test("a failed readback cannot turn a committed OS save into a save error", async () => {
  let writes = 0;
  const result = await saveOrderAndRefresh(
    async () => { writes += 1; return { id: "order-2" }; },
    async () => { throw new Error("Registro não encontrado nesta oficina."); },
  );
  assert.deepEqual(result, { id: "order-2", refreshed: false });
  assert.equal(writes, 1);
});

test("an actual OS write failure remains an error and does not refresh", async () => {
  let refreshed = false;
  await assert.rejects(
    saveOrderAndRefresh(
      async () => { throw new Error("Registro não encontrado nesta oficina."); },
      async () => { refreshed = true; },
    ),
    /Registro não encontrado nesta oficina/,
  );
  assert.equal(refreshed, false);
});
