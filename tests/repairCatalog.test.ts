import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../server/db/database";
import {
  serviceInfo,
  searchBrands,
  searchModels,
  searchRepairServices,
  resolveService,
  saveWorkshopService,
  listWorkshopServices,
  saveLaborRates,
  identifyVehicleModel,
} from "../server/services/repairCatalog";
import { saveOrder, listOrders, previewVehicleCatalogBackfill, applyVehicleCatalogBackfill } from "../server/services/workshop";
import { servicePrice, serviceMinutes } from "../shared/servicePricing";

const ctx = { tenantId: "a", userId: "u", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Teste','test@example.com','disabled'); INSERT INTO customers(id,tenant_id,name) VALUES('c','a','Cliente'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','c','ABC1D23','Marca','Modelo',2020);",
  );
  const porte = randomUUID();
  const portes = { compacto: porte, medio: randomUUID(), premium: randomUUID(), pesado: randomUUID() };
  const category = "compacto";
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
  for (const [key,name] of [["compacto","Compacto"],["medio","Médio"],["premium","Premium"],["pesado","Pesado"]] as const)
    db.prepare("INSERT INTO service_catalog.classifications VALUES(?,?)").run(portes[key], name);
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
  db.prepare("INSERT INTO labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES(?,?,?)").run("a", category, 12000);
  return { db, porte, portes, brand, model, other, override, service };
}
test("FIPE ambígua retorna modelos distintos, mantendo tempos por base e diferenças específicas", async () => {
  const f = fixture();
  try {
    const models = await searchModels(f.db, ctx, { brand_id: f.brand, fipe: "123456-7" });
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
      searchModels(f.db, { ...ctx, tenantId: "b" }, { brand_id: f.brand }),
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
test("autocomplete do catálogo ignora acentos, restringe modelos à marca e pagina", async () => {
  const f = fixture();
  try {
    const secondBrand = randomUUID();
    f.db.prepare("INSERT INTO service_catalog.brands VALUES(?,?)").run(secondBrand, "Árvore Motores");
    const secondModel = randomUUID();
    f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)").run(secondModel, secondBrand, "SUV Elétrico 2.0", "999999-9", f.porte, null, "[]", 1);
    const brands = await searchBrands(f.db, ctx, { q: "arvore" });
    assert.deepEqual(brands.items.map((row: any) => row.id), [secondBrand]);
    assert.equal(Number((brands.items[0] as any).vehicle_count), 1);
    const preferred = await searchModels(f.db, ctx, { brand_id: f.brand, fipe: "123456-7", preferred: "Modelo 2", year: "2020" });
    assert.equal(preferred.items[0].id, f.other);
    const firstBrands = await searchBrands(f.db, ctx, {});
    assert.ok(firstBrands.items.length > 0);
    const fipeCandidates = await searchModels(f.db, ctx, { brand_id: f.brand, q: "sem correspondência", fipe: "123456-7" });
    assert.equal(fipeCandidates.items.length, 3);
    assert.ok(fipeCandidates.items.every((row: any) => row.brand_id === f.brand));
    assert.equal((await searchModels(f.db, ctx, { brand_id: secondBrand, q: "eletrico" })).items[0].id, secondModel);
    for (let index = 0; index < 28; index++) {
      f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), f.brand, "Modelo adicional " + index, "", f.porte, null, "[]", 0);
    }
    const firstPage = await searchModels(f.db, ctx, { brand_id: f.brand });
    const nextPage = await searchModels(f.db, ctx, { brand_id: f.brand, offset: 30 });
    assert.equal(firstPage.items.length, 30); assert.equal(firstPage.has_more, true);
    assert.equal(nextPage.items.length, 1); assert.equal(nextPage.has_more, false);
    await assert.rejects(searchBrands(f.db, { ...ctx, tenantId: "b" }, { q: "arvore" }), /não está liberado/);
  } finally { f.db.close(); }
});
test("limpar o vínculo do modelo preserva o snapshot existente da OS", async () => {
  const f = fixture();
  try {
    const selection = { repair_service_id: f.service, repair_model_id: f.model };
    const input = { status: 'quote', customer_id: 'c', vehicle_id: 'v', service_model_id: f.model, entered_on: '2026-10-25', due_on: '2026-10-25', km: 0, discount: 0, notes: '', problem: '', items: [{ ...selection, id: randomUUID(), price: 12000, quantity: 1 }] };
    const id = await saveOrder(f.db, ctx, input);
    const before = (await listOrders(f.db, 'a')).find((o) => o.id === id)!;
    await saveOrder(f.db, ctx, { ...input, service_model_id: null, items: before.items }, id);
    const after = (await listOrders(f.db, 'a')).find((o) => o.id === id)!;
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE id='v'").get()!.service_model_id, '');
    assert.deepEqual(after.items, before.items);
  } finally { f.db.close(); }
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
    f.db.prepare("UPDATE service_catalog.classifications SET name='Nome histórico alterado'").run();
    f.db.prepare("UPDATE labor_commercial_rates SET hourly_rate=99900").run();
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
test("quatro tarifas são isoladas por oficina e a categoria manual fica no snapshot", async () => {
  const f = fixture();
  try {
    await saveLaborRates(f.db, ctx, [
      { category_id: "compacto", hourly_rate: 12000 },
      { category_id: "medio", hourly_rate: 15000 },
      { category_id: "premium", hourly_rate: 18000 },
      { category_id: "pesado", hourly_rate: 22000 },
    ]);
    await saveLaborRates(f.db, { ...ctx, tenantId: "b" }, [
      { category_id: "compacto", hourly_rate: 8000 },
    ]);
    const a = await serviceInfo(f.db, ctx);
    const b = await serviceInfo(f.db, { ...ctx, tenantId: "b" });
    assert.deepEqual(a.categories.map((row: any) => row.id), ["compacto", "medio", "premium", "pesado"]);
    assert.equal(a.categories.find((row: any) => row.id === "premium")!.hourly_rate, 18000);
    assert.equal(b.categories.find((row: any) => row.id === "compacto")!.hourly_rate, 8000);
    assert.equal(b.categories.find((row: any) => row.id === "premium")!.hourly_rate, 0);
    const priced = await resolveService(f.db, ctx, {
      repair_service_id: f.service,
      repair_model_id: f.model,
      commercial_category_id: "premium",
    });
    assert.equal(priced.price, 18000);
    assert.equal(priced.commercial_category_id, "premium");
    assert.equal(priced.category_override, true);
    const snapshot = JSON.parse(priced.service_snapshot);
    assert.equal(snapshot.hourly_rate, 18000);
    assert.equal(snapshot.technical_classification, "Compacto");
    await saveLaborRates(f.db, ctx, [{ category_id: "premium", hourly_rate: 30000 }]);
    const preserved = await resolveService(f.db, ctx, {
      repair_service_id: f.service,
      repair_model_id: f.model,
      commercial_category_id: "premium",
    }, { service_snapshot: JSON.stringify(snapshot) });
    assert.equal(preserved.price, 18000);
    assert.equal(JSON.parse(preserved.service_snapshot).hourly_rate, 18000);
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
      commercial_category_id: "compacto",
      pricing_mode: "price",
      minutes: 0,
      price: 6000,
      cost: 999,
    });
    assert.equal((await listWorkshopServices(f.db, ctx, { category_id: "compacto" })).items.length, 1);
    assert.equal((await listWorkshopServices(f.db, ctx, { category_id: "medio" })).items.length, 0);
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
      commercial_category_id: "compacto",
    });
    assert.equal(preview.minutes, 30);
    assert.equal(preview.cost, 0);
    assert.equal(preview.price, 6000);
    assert.equal((await resolveService(f.db, ctx, {
      workshop_service_id: manual, porte_id: f.portes.medio,
    })).price,6000);
    assert.equal(f.db.prepare("SELECT porte_id FROM workshop_services WHERE id=?").get(manual)!.porte_id,null);
    assert.equal(
      (await serviceInfo(f.db, ctx)).categories.find((p) => p.id === "compacto")!
        .hourly_rate,
      12000,
    );
    await saveLaborRates(f.db, ctx, [
      { category_id: "compacto", hourly_rate: 15000 },
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

test("os quatro portes do próprio modelo escolhem as quatro tarifas sem tabela auxiliar", async () => {
  const f = fixture();
  try {
    const rates = { compacto: 12000, medio: 15000, premium: 18000, pesado: 22000 };
    await saveLaborRates(f.db, ctx, Object.entries(rates).map(([category_id, hourly_rate]) => ({ category_id, hourly_rate })));
    for (const id of Object.keys(rates) as (keyof typeof rates)[]) {
      f.db.prepare("UPDATE service_catalog.models SET classification_id=? WHERE id=?").run(f.portes[id], f.model);
      const models = await searchModels(f.db, ctx, { brand_id: f.brand, fipe: "123456-7" });
      const model = models.items.find((m) => m.id === f.model)!;
      assert.equal(model.porte_id, f.portes[id]);
      assert.equal(model.commercial_category_id, id);
      assert.equal(model.porte_name, model.commercial_category_name);
      const priced = await resolveService(f.db, ctx, { repair_service_id: f.service, repair_model_id: f.model });
      assert.equal(priced.price, rates[id]);
      assert.equal(JSON.parse(priced.service_snapshot).classification_id, f.portes[id]);
    }
    f.db.prepare("UPDATE service_catalog.classifications SET name='SUV Médio' WHERE id=?").run(f.portes.pesado);
    await assert.rejects(resolveService(f.db, ctx, { repair_service_id: f.service, repair_model_id: f.model }), /quatro portes/);
  } finally { f.db.close(); }
});

test("serviço particular na OS usa sua tarifa apesar do porte legado em cache no veículo", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET service_model_id=?,service_porte_id=? WHERE id='v'").run(f.model, randomUUID());
    const manual = await saveWorkshopService(f.db, ctx, {
      name: "Serviço particular", execution: "internal", commercial_category_id: "compacto",
      pricing_mode: "time", minutes: 60, price: 12000, cost: 0,
    });
    const id = await saveOrder(f.db, ctx, {
      status: "quote", customer_id: "c", vehicle_id: "v", service_model_id: f.model,
      entered_on: "2026-10-25", due_on: "2026-10-25", km: 0, discount: 0, notes: "", problem: "",
      items: [{ id: randomUUID(), workshop_service_id: manual, commercial_category_id: "compacto", price: 12000, quantity: 1 }],
    });
    const order = (await listOrders(f.db, "a")).find((o) => o.id === id)!;
    assert.equal(order.items[0].service_details.hourly_rate, 12000);
    assert.equal(order.items[0].price, 12000);
  } finally { f.db.close(); }
});


test("identificação automática só vincula marca e modelo únicos e preserva vínculo incompatível para revisão", async () => {
  const f = fixture();
  try {
    const unique = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Modelo 2", year: 2020 });
    assert.equal(unique.status, "matched");
    assert.equal(unique.model?.id, f.other);
    const ambiguous = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Modelo", fipe_code: "123456-7" });
    assert.equal(ambiguous.status, "needs_confirmation");
    assert.equal(ambiguous.model, null);
    const wrongBrand = await identifyVehicleModel(f.db, ctx, { brand: "Outra", model: "Modelo 2" });
    assert.equal(wrongBrand.status, "not_identified");
    const stale = await identifyVehicleModel(f.db, ctx, { brand: "Outra", model: "Modelo 1", service_model_id: f.model });
    assert.equal(stale.status, "mismatch");
    assert.equal(stale.model?.id, f.model);
    const changed = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Versão diferente", service_model_id: f.model });
    assert.equal(changed.status, "mismatch");
    const denied = await identifyVehicleModel(f.db, { ...ctx, tenantId: "b" }, { brand: "Marca", model: "Modelo 2" });
    assert.equal(denied.status, "unavailable");
  } finally { f.db.close(); }
});

test("retroactive catalog preview is read-only and apply links only unique matches within one workshop", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand=?,model=?,fipe_code='' WHERE tenant_id=? AND id=?").run("Marca", "Modelo 2", "a", "v");
    f.db.prepare("INSERT INTO customers(id,tenant_id,name) VALUES('other-customer','b','Outro')").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('other-vehicle','b','other-customer','ABC1D24','Marca','Modelo 2',2020)").run();
    const preview = await previewVehicleCatalogBackfill(f.db, ctx, 10);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.scanned, 1);
    assert.equal(preview.counts.matched, 1);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, "");
    const applied = await applyVehicleCatalogBackfill(f.db, ctx, 10);
    assert.equal(applied.linked, 1);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, f.other);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='b' AND id='other-vehicle'").get()?.service_model_id, "");
  } finally { f.db.close(); }
});

test("OS com veículo antigo sem vínculo identifica a versão única sem reconsultar a placa", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand=?,model=?,fipe_code='' WHERE tenant_id=? AND id=?").run("Marca", "Modelo 2", "a", "v");
    const orderId = await saveOrder(f.db, ctx, { status: "quote", customer_id: "c", vehicle_id: "v", entered_on: "2026-10-25", due_on: "2026-10-25", km: 0, discount: 0, notes: "", problem: "", items: [] });
    assert.ok(orderId);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, f.other);
    assert.equal(f.db.prepare("SELECT action FROM audit_events WHERE tenant_id='a' AND action='vehicles.catalog_link_backfill'").get(), undefined);
  } finally { f.db.close(); }
});

test("veículo criado junto à OS recebe vínculo único sem segunda consulta à placa", async () => {
  const f = fixture();
  try {
    const orderId = await saveOrder(f.db, ctx, { status: "open", customer_id: "c", vehicle_id: null, new_vehicle: { plate: "XYZ1A23", brand: "Marca", model: "Modelo 2", year: 2020, color: "", fipe_code: "", fipe_model: "", fipe_year_id: "" }, entered_on: "2026-10-25", due_on: "2026-10-25", km: 0, discount: 0, notes: "", problem: "", items: [] });
    assert.ok(orderId);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND plate='XYZ1A23'").get()?.service_model_id, f.other);
  } finally { f.db.close(); }
});
