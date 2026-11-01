import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
import {
  defaultRules,
  getPartsPricing,
  savePartsPricing,
  partsPricingSchema,
} from "../server/services/partsPricing";
import {
  catalogSalePrice,
  normalizePricingRules,
  salePrice,
  thirdPartySalePrice,
} from "../shared/pricing";
import {
  resolveService,
  saveWorkshopService,
} from "../server/services/repairCatalog";
import { defaultWorkshopModules } from "../shared/workshopModules";
const ctx = { tenantId: "a", userId: "u", role: "owner" };
const rules = [
  { from: 0, up_to: 10000, markup_bps: 2000, minimum_profit: 500 },
  { from: 10001, up_to: null, markup_bps: 4000, minimum_profit: 0 },
];
const service_rules = [
  { from: 0, up_to: 10000, markup_bps: 5000, minimum_profit: 0 },
  { from: 10001, up_to: null, markup_bps: 1000, minimum_profit: 0 },
];
const policy = {
  mode: "legacy" as const,
  rate_bps: 2500,
  rules,
  service_rules,
};
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','Fictícia A'),('b','Fictícia B'); INSERT INTO users VALUES('u','Admin','a@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO catalog(id,tenant_id,kind,name,sku,cost,price) VALUES('p','a','product','Peça fictícia','FIC',1000,2000); INSERT INTO orders(id,tenant_id,number,kind,status,entered_on,due_on,km,total) VALUES('o','a',1,'quote','quote','2026-11-01','2026-11-01',0,2000); INSERT INTO order_items(id,tenant_id,order_id,catalog_id,kind,name,quantity,cost,price) VALUES('i','a','o','p','product','Peça fictícia',1,1000,2000)",
  );
  return db;
}
test("OPS-003: limites inclusivos, tabelas independentes, ganho mínimo e modos preservados", () => {
  assert.equal(salePrice(10000, policy), 12000);
  assert.equal(salePrice(10001, policy), 14001);
  assert.equal(salePrice(0, policy), 500);
  assert.equal(thirdPartySalePrice(10000, policy), 15000);
  assert.equal(thirdPartySalePrice(10001, policy), 11001);
  assert.equal(catalogSalePrice("product", 9900, 100, policy), 12000);
  assert.equal(catalogSalePrice("service", 10000, 10000, policy), 15000);
  assert.equal(salePrice(10000, { ...policy, mode: "markup" }), 12500);
  assert.equal(salePrice(10000, { ...policy, mode: "margin" }), 13333);
  assert.equal(thirdPartySalePrice(10000, policy), 15000);
  assert.throws(
    () => salePrice(10001, { ...policy, rules: [rules[0]] }),
    /fora das faixas/,
  );
  assert.throws(
    () => thirdPartySalePrice(10001, { service_rules: [service_rules[0]] }),
    /fora das faixas/,
  );
  assert.equal(normalizePricingRules(defaultRules)[1].from, 2001);
  for (const invalid of [
    [],
    [{ ...rules[0], from: 1 }, rules[1]],
    [rules[0], { ...rules[1], from: 10000 }],
    [rules[0], { ...rules[1], from: 10002 }],
    [{ ...rules[0], up_to: null }, rules[1]],
    [{ ...rules[0], up_to: -1 }],
    [{ ...rules[0], markup_bps: 100001 }],
    [{ ...rules[0], from: 0.1 }],
  ])
    assert.equal(
      partsPricingSchema.safeParse({ ...policy, rules: invalid }).success,
      false,
    );
  assert.equal(
    partsPricingSchema.safeParse({
      ...policy,
      service_rules: [{ ...service_rules[0], minimum_profit: 1 }],
    }).success,
    false,
  );
});
test("OPS-003: leitura legada sem escrita, persistência e histórico preservado", async () => {
  const db = fixture();
  try {
    db.prepare("UPDATE tenants SET parts_pricing_rules=? WHERE id='a'").run(
      JSON.stringify(defaultRules),
    );
    const before = db.prepare("SELECT * FROM tenants WHERE id='a'").get();
    const legacy = await getPartsPricing(db, "a");
    assert.equal(legacy.service_markup_bps, 3000);
    assert.deepEqual(
      db.prepare("SELECT * FROM tenants WHERE id='a'").get(),
      before,
    );
    const history = db.prepare("SELECT * FROM order_items").all(),
      catalog = db.prepare("SELECT * FROM catalog").all();
    await savePartsPricing(db, ctx, policy);
    assert.deepEqual(
      (await getPartsPricing(db, "a")).service_rules,
      service_rules,
    );
    assert.equal((await getPartsPricing(db, "b")).service_rules, undefined);
    await savePartsPricing(db, ctx, { rate_bps: 4500 });
    assert.deepEqual((await getPartsPricing(db, "a")).rules, rules);
    assert.deepEqual(
      (await getPartsPricing(db, "a")).service_rules,
      service_rules,
    );
    await savePartsPricing(db, ctx, {
      rules: defaultRules,
      service_markup_bps: 9000,
    });
    assert.deepEqual(
      (await getPartsPricing(db, "a")).service_rules,
      service_rules,
    );
    await assert.rejects(
      savePartsPricing(db, ctx, { service_rules: [service_rules[1]] }),
      /lacuna/,
    );
    assert.deepEqual(db.prepare("SELECT * FROM order_items").all(), history);
    assert.deepEqual(db.prepare("SELECT * FROM catalog").all(), catalog);
    const own = await saveWorkshopService(db, ctx, {
      service_type: "private",
      name: "Serviço próprio fictício",
      price: 4321,
      cost: 1000,
    });
    assert.equal(
      (await resolveService(db, ctx, { workshop_service_id: own })).price,
      4321,
    );
  } finally {
    db.close();
  }
});
test("OPS-003 API: permissões, oficina autenticada e simuladores sem gravação", async () => {
  const db = fixture();
  let modules = { ...defaultWorkshopModules };
  Object.assign(db, { getTenantModuleAccess: async () => modules });
  for (const [token, user] of [
    ["owner", "u"],
    ["operator", "m"],
  ])
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(token),
      user,
      "a",
      Date.now() + 60000,
    );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as any).port + "/api";
  const call = (path: string, body: unknown, token = "owner", method = "PUT") =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: "hp_session=" + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await call("/parts-pricing", policy, "operator")).status,
      403,
    );
    modules = { ...modules, settings: false };
    assert.equal((await call("/parts-pricing", policy)).status, 403);
    modules = { ...modules, settings: true };
    assert.equal(
      (await call("/parts-pricing", { ...policy, tenant_id: "b" })).status,
      200,
    );
    assert.deepEqual((await getPartsPricing(db, "a")).rules, rules);
    assert.equal((await getPartsPricing(db, "b")).service_rules, undefined);
    const stored = db
      .prepare("SELECT parts_pricing_rules FROM tenants WHERE id='a'")
      .get();
    const product = await call(
      "/parts-pricing/preview",
      { cost: 10000 },
      "owner",
      "POST",
    );
    assert.equal((await product.json()).price, 12000);
    const service = await call(
      "/parts-pricing/preview",
      { cost: 10000, kind: "service" },
      "owner",
      "POST",
    );
    assert.equal((await service.json()).price, 15000);
    assert.equal(
      (
        await call("/parts-pricing", {
          ...policy,
          service_rules: [{ ...service_rules[0], from: 3 }],
        })
      ).status,
      400,
    );
    assert.deepEqual(
      db.prepare("SELECT parts_pricing_rules FROM tenants WHERE id='a'").get(),
      stored,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
