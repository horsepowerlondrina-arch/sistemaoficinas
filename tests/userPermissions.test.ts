import test from "node:test";
import assert from "node:assert/strict";
import {
  discountAllowed,
  effectivePermissions,
  profileDefaults,
  permissionKeys,
} from "../shared/userPermissions";
test("individual overrides never mutate another employee or the profile", () => {
  const a = effectivePermissions("mechanic", { "orders.prices": true });
  const b = effectivePermissions("mechanic");
  assert.equal(a["orders.prices"], true);
  assert.equal(b["orders.prices"], false);
  assert.equal(profileDefaults("mechanic")["orders.prices"], false);
  assert.equal(
    effectivePermissions("mechanic", { "users.manage": true })["users.manage"],
    false,
  );
});
test("plan availability and permission dependencies cannot be bypassed", () => {
  for (const profile of [
    "master",
    "manager",
    "advisor",
    "mechanic",
    "finance",
  ] as const) {
    const p = effectivePermissions(
      profile,
      {},
      { finance: false, technical_catalog: false },
    );
    assert.equal(p["finance.receive"], false);
    assert.equal(p["finance.profit"], false);
    assert.equal(p["technical.rates"], false);
  }
  const p = effectivePermissions("manager", { "orders.view": false });
  for (const key of [
    "orders.edit",
    "orders.items",
    "orders.status",
    "orders.finalize",
    "orders.discount",
    "orders.approve",
  ] as const)
    assert.equal(p[key], false, key);
  assert.throws(() =>
    effectivePermissions("mechanic", { unrecognized: true } as any),
  );
  assert.equal(permissionKeys.length, new Set(permissionKeys).size);
});
test("discount limits apply to the entire discount and both monetary ceilings", () => {
  assert.equal(discountAllowed(10000, 1000, 1000, null), true);
  assert.equal(discountAllowed(10000, 1001, 1000, null), false);
  assert.equal(discountAllowed(10000, 900, 1000, 800), false);
  assert.equal(discountAllowed(999, 100, 1000, null), false);
  assert.equal(discountAllowed(10000, -1, 1000, null), false);
  assert.equal(discountAllowed(10000, 10001, 10000, null), false);
  assert.equal(
    discountAllowed(
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      10000,
      null,
    ),
    true,
  );
});
