import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import {
  serviceInfo,
  searchModels,
  searchRepairServices,
  resolveService,
  saveWorkshopService,
  listWorkshopServices,
  saveLaborRates,
} from "../server/services/repairCatalog";
import { saveOrder, listOrders } from "../server/services/workshop";
import { servicePrice, serviceMinutes } from "../shared/servicePricing";

const ctx = { tenantId: "a", userId: "u", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Teste','test@example.com','disabled'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Marca','Modelo',2020);",
  );
  const porte = String(
    db.prepare("SELECT id FROM labor_portes ORDER BY name LIMIT 1").get()!.id,
  );
  const brand = randomUUID(),
    model = randomUUID(),
    other = randomUUID(),
    override = randomUUID(),
    base = randomUUID(),
    otherBase = randomUUID(),
    service = randomUUID();
  db.exec(`ATTACH DATABASE ':memory:' AS service_catalog;
 CREATE TABLE service_catalog.tenant_access(tenant_id TEXT,enabled INTEGER,valid_until TEXT);
 CREATE TABLE service_catalog.releases(version TEXT,status TEXT,imported_at TEXT);
 CREATE TABLE service_catalog.brands(id TEXT,name TEXT);
 CREATE TABLE service_catalog.classifications(id TEXT,name TEXT);
 CREATE TABLE service_catalog.models(id TEXT,brand_id TEXT,name TEXT,fipe_code TEXT,classification_id TEXT,base_id TEXT,excluded_service_ids TEXT,service_count INTEGER);
 CREATE TABLE service_catalog.repair_times(id TEXT,base_id TEXT,model_id TEXT,service_id TEXT,service_name TEXT,minutes REAL,time_identifier TEXT);
 CREATE VIEW service_catalog.model_services AS SELECT m.id model_id,t.service_id,t.service_name,t.minutes,t.time_identifier,t.id repair_time_id FROM models m JOIN repair_times t ON t.base_id=m.base_id WHERE NOT EXISTS(SELECT 1 FROM json_each(m.excluded_service_ids) e WHERE e.value=t.service_id) AND NOT EXISTS(SELECT 1 FROM repair_times x WHERE x.model_id=m.id AND x.service_id=t.service_id) UNION ALL SELECT model_id,service_id,service_name,minutes,time_identifier,id FROM repair_times WHERE model_id IS NOT NULL;
 INSERT INTO service_catalog.tenant_access VALUES('a',1,NULL),('b',0,NULL);
 INSERT INTO service_catalog.releases VALUES('1.2','active','2026-10-19');`);
  db.prepare("INSERT INTO service_catalog.brands VALUES(?,?)").run(
    brand,
    "Marca",
  );
  db.prepare("INSERT INTO service_catalog.classifications VALUES(?,?)").run(
    porte,
    "Porte",
  );
  for (const [key, name, keyBase] of [
    [model, "Modelo 1", base],
    [other, "Modelo 2", otherBase],
    [override, "Modelo 3", base],
  ])
    db.prepare(
      "INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)",
    ).run(key, brand, name, "123456-7", porte, keyBase, "[]", 1);
  for (const [keyBase, keyModel, time] of [
    [base, null, 60],
    [otherBase, null, 120],
    [null, override, 180],
  ])
    db.prepare(
      "INSERT INTO service_catalog.repair_times VALUES(?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      keyBase,
      keyModel,
      service,
      "Troca de Óleo",
      time,
      "tempo",
    );
  db.prepare("INSERT INTO labor_rates VALUES(?,?,?)").run("a", porte, 12000);
  return { db, porte, model, other, override, service };
}
test("FIPE ambígua retorna modelos distintos, mantendo tempos por base e diferenças específicas", async () => {
  const f = fixture();
  try {
    const models = await searchModels(f.db, ctx, { fipe: "123456-7" });
    assert.equal(models.items.length, 3);
    for (const [model, time] of [
      [f.model, 60],
      [f.other, 120],
      [f.override, 180],
    ] as const) {
      const result = await searchRepairServices(f.db, ctx, model, {q:'oleo'});
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].minutes, time);
    }
    await assert.rejects(
      searchModels(f.db, { ...ctx, tenantId: "b" }, {}),
      /não está liberado/,
    );
    f.db
      .prepare(
        "UPDATE service_catalog.tenant_access SET valid_until='2000-01-01' WHERE tenant_id='a'",
      )
      .run();
    await assert.rejects(
      searchRepairServices(f.db, ctx, f.model, {}),
      /não está liberado/,
    );
  } finally {
    f.db.close();
  }
});
test("OS preserva snapshots após mudança de tarifa, catálogo e assinatura; nova inclusão não burla acesso", async () => {
  const f = fixture();
  try {
    const selection = {
      repair_service_id: f.service,
      repair_model_id: f.model,
    };
    const preview = await resolveService(f.db, ctx, selection);
    assert.equal(preview.price, 12000);
    const input = {
      status: "quote",
      customer_id: "c",
      vehicle_id: "v",
      service_model_id: f.model,
      entered_on: "2026-10-19",
      due_on: "2026-10-19",
      km: 0,
      discount: 0,
      notes: "",
      problem: "",
      items: [{ ...selection, id: randomUUID(), price: 10000, quantity: 1 }],
    };
    const id = await saveOrder(f.db, ctx, input);
    assert.equal(
      f.db.prepare("SELECT service_model_id FROM vehicles WHERE id='v'").get()!
        .service_model_id,
      f.model,
    );
    const before = (await listOrders(f.db, "a")).find((o) => o.id === id)!;
    f.db.prepare("UPDATE service_catalog.repair_times SET minutes=999").run();
    f.db.prepare("UPDATE labor_rates SET hourly_rate=99900").run();
    f.db.prepare("UPDATE service_catalog.tenant_access SET enabled=0").run();
    await saveOrder(
      f.db,
      ctx,
      { ...input, items: before.items, notes: "Só observação" },
      id,
    );
    const after = (await listOrders(f.db, "a")).find((o) => o.id === id)!;
    assert.deepEqual(after.items, before.items);
    assert.equal(after.items[0].service_details.hourly_rate, 12000);
    assert.equal(after.items[0].price, 10000);
    await assert.rejects(
      saveOrder(f.db, ctx, { ...input, items: before.items }),
      /não está liberado/,
    );
    const third = {
      ...before.items[0],
      service_execution: "outsourced",
      service_cost: 10000,
      price: 13000,
    };
    await saveOrder(f.db, ctx, { ...input, items: [third] }, id);
    const item = (await listOrders(f.db, "a")).find((o) => o.id === id)!
      .items[0];
    assert.equal(item.cost, 10000);
    assert.equal(item.service_details.markup_bps, 3000);
    assert.equal(item.service_details.minutes, 60);
    assert.equal(f.db.prepare("SELECT count(*) n FROM catalog").get()!.n, 0);
  } finally {
    f.db.close();
  }
});
test("serviços particulares têm isolamento e porte; tempo/preço são calculados; custos de terceiros não viram estoque", async () => {
  const f = fixture();
  try {
    const manual = await saveWorkshopService(f.db, ctx, {
      name: "Serviço privado",
      execution: "internal",
      porte_id: f.porte,
      pricing_mode: "price",
      minutes: 0,
      price: 6000,
      cost: 999,
    });
    assert.equal(
      (await listWorkshopServices(f.db, { ...ctx, tenantId: "b" }, {})).items
        .length,
      0,
    );
    await assert.rejects(
      resolveService(
        f.db,
        { ...ctx, tenantId: "b" },
        { workshop_service_id: manual, porte_id: f.porte },
      ),
      /nesta oficina/,
    );
    const preview = await resolveService(f.db, ctx, {
      workshop_service_id: manual,
      porte_id: f.porte,
    });
    assert.equal(preview.minutes, 30);
    assert.equal(preview.cost, 0);
    assert.equal(preview.price, 6000);
    await assert.rejects(
      resolveService(f.db, ctx, {
        workshop_service_id: manual,
        porte_id: randomUUID(),
      }),
      /outro porte/,
    );
    assert.equal(
      (await serviceInfo(f.db, ctx)).portes.find((p) => p.id === f.porte)!
        .hourly_rate,
      12000,
    );
    await saveLaborRates(f.db, ctx, [
      { porte_id: f.porte, hourly_rate: 15000 },
    ]);
    assert.equal(servicePrice(30, 15000), 7500);
    assert.equal(serviceMinutes(7500, 15000), 30);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM stock_movements").get()!.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("tempo zero exige complemento e um serviço não pode ser aplicado a um modelo incompatível", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE service_catalog.repair_times SET minutes=0").run();
    await assert.rejects(
      resolveService(f.db, ctx, {
        repair_service_id: f.service,
        repair_model_id: f.model,
      }),
      /tempo/,
    );
    assert.equal(
      (
        await resolveService(f.db, ctx, {
          repair_service_id: f.service,
          repair_model_id: f.model,
          manual_price: 6000,
        })
      ).minutes,
      30,
    );
    await assert.rejects(
      resolveService(f.db, ctx, {
        repair_service_id: randomUUID(),
        repair_model_id: f.model,
      }),
      /não se aplica/,
    );
  } finally {
    f.db.close();
  }
});
