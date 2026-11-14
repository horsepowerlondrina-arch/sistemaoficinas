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

test("route permissions distinguish creation, administrative OS actions and financial policies", async () => {
  const { permissionForRequest } =
    await import("../server/auth/userAuthorization");
  assert.equal(permissionForRequest("/suppliers", "POST"), "catalog.create");
  assert.equal(permissionForRequest("/suppliers/id", "PUT"), "catalog.edit");
  assert.equal(
    permissionForRequest("/orders/id/status", "POST", { status: "cancelled" }),
    "orders.admin",
  );
  assert.equal(
    permissionForRequest("/orders/id/status", "POST", { status: "completed" }),
    "orders.finalize",
  );
  assert.equal(
    permissionForRequest("/card-machines", "GET"),
    "finance.receive",
  );
  assert.equal(
    permissionForRequest("/card-machines", "POST"),
    "finance.policies",
  );
  assert.equal(permissionForRequest("/unknown", "POST"), null);
});

test("navigation respects financial margins and separates technical consultation from product registration", async () => {
  const { canOpenPath } = await import("../src/lib/userAccess");
  const mechanic = {
    role: "operator",
    access: {
      permissions: effectivePermissions("mechanic"),
      orderScope: "assigned",
    },
  } as any;
  assert.equal(canOpenPath(mechanic, "/servicos"), true);
  assert.equal(canOpenPath(mechanic, "/catalogo"), false);
  const consult = {
    role: "operator",
    access: {
      permissions: effectivePermissions("advisor", { "finance.view": true }),
      orderScope: "all",
    },
  } as any;
  for (const path of [
    "/financeiro/pecas",
    "/financeiro/servicos",
    "/financeiro/ganhos",
    "/resultados",
  ])
    assert.equal(canOpenPath(consult, path), false, path);
  assert.equal(canOpenPath(consult, "/financeiro"), true);
});
