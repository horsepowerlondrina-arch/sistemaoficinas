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
  setWorkshopServiceActive,
  listWorkshopServiceCategories,
  saveWorkshopServiceCategory,
  setWorkshopServiceCategoryActive,
  saveLaborRates,
  identifyVehicleModel,
  previewVehicleCatalogReview,
} from "../server/services/repairCatalog";
import { audit, saveOrder, listOrders, previewVehicleCatalogBackfill, applyVehicleCatalogBackfill } from "../server/services/workshop";
import { servicePrice, serviceMinutes } from "../shared/servicePricing";
import { shouldLoadRepairServiceSearch, shouldShowVehicleCatalog, shouldShowWorkshopServices } from "../shared/repairCatalogVisibility";

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

test("serviço próprio simples não exige porte nem tempo, pesquisa sem acento e mantém custo opcional", async () => {
  const f = fixture();
  try {
    const id = await saveWorkshopService(f.db, ctx, {
      service_type: "private",
      name: "Higienização de ar-condicionado",
      description: "Limpeza completa do sistema.",
      price: 7200,
    });
    const stored = f.db.prepare("SELECT * FROM workshop_services WHERE tenant_id=? AND id=?").get("a", id)!;
    assert.equal(stored.commercial_category_id, null);
    assert.equal(stored.minutes, 0);
    assert.equal(stored.price, 7200);
    assert.equal(stored.cost_known, 0);
    assert.equal(stored.service_type, "private");
    assert.equal(stored.description, "Limpeza completa do sistema.");
    assert.equal((await listWorkshopServices(f.db, ctx, { q: "higienizacao" })).items[0].id, id);
    assert.equal((await listWorkshopServices(f.db, { ...ctx, tenantId: "b" }, { status: "all" })).items.length, 0);
    await assert.rejects(saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "  HIGIENIZACAO   DE AR-CONDICIONADO ", price: 7200,
    }), /Já existe um serviço/);
    const otherTenant = await saveWorkshopService(f.db, { ...ctx, tenantId: "b" }, {
      service_type: "private", name: "Higienização de ar-condicionado", price: 7200,
    });
    assert.ok(otherTenant);
    const preview = await resolveService(f.db, ctx, { workshop_service_id: id });
    assert.equal(preview.price, 7200);
    assert.equal(preview.minutes, 0);
    assert.equal(preview.cost_known, false);
    assert.equal((await resolveService(f.db, ctx, { workshop_service_id: id, manual_price: 8000 })).price, 8000);
    await setWorkshopServiceActive(f.db, ctx, id, false);
    assert.equal((await listWorkshopServices(f.db, ctx, {})).items.length, 0);
    assert.equal((await listWorkshopServices(f.db, ctx, { status: "inactive" })).items[0].id, id);
    await setWorkshopServiceActive(f.db, ctx, id, true);
    assert.equal((await listWorkshopServices(f.db, ctx, {})).items[0].id, id);
  } finally {
    f.db.close();
  }
});
test("referências e categorias próprias são únicas por oficina, pesquisáveis e preservam vínculos ao inativar", async () => {
  const f = fixture();
  try {
    const category = await saveWorkshopServiceCategory(f.db, ctx, { name: "Elétrica Automotiva" });
    const service = await saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "Reparo de alternador", reference: "hp-001", category_id: category, price: 15500, cost: 0,
    });
    const stored = f.db.prepare("SELECT reference,category_id,cost,cost_known FROM workshop_services WHERE tenant_id=? AND id=?").get("a", service)!;
    assert.equal(stored.reference, "HP-001");
    assert.equal(stored.category_id, category);
    assert.equal(stored.cost, 0);
    assert.equal(stored.cost_known, 1);
    assert.equal((await listWorkshopServices(f.db, ctx, { q: "eletrica" })).items[0].id, service);
    assert.equal((await listWorkshopServices(f.db, ctx, { q: "hp-001" })).items[0].id, service);
    assert.equal((await listWorkshopServices(f.db, ctx, { private_category_id: category })).items[0].id, service);
    await assert.rejects(saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "Outro serviço", reference: " hp-001 ", price: 1000,
    }), /referência/);
    const sameReferenceOtherOffice = await saveWorkshopService(f.db, { ...ctx, tenantId: "b" }, {
      service_type: "private", name: "Outro serviço", reference: "hp-001", price: 1000,
    });
    assert.ok(sameReferenceOtherOffice);
    await assert.rejects(saveWorkshopServiceCategory(f.db, ctx, { name: "ELETRICA   AUTOMOTIVA" }), /categoria/);
    await assert.rejects(saveWorkshopService(f.db, { ...ctx, tenantId: "b" }, {
      service_type: "private", name: "Serviço isolado", category_id: category, price: 1000,
    }), /Categoria não encontrada/);
    await saveWorkshopServiceCategory(f.db, ctx, { name: "Elétrica Premium" }, category);
    assert.equal(f.db.prepare("SELECT category_id FROM workshop_services WHERE id=?").get(service)!.category_id, category);
    await setWorkshopServiceCategoryActive(f.db, ctx, category, false);
    assert.equal(f.db.prepare("SELECT category_id FROM workshop_services WHERE id=?").get(service)!.category_id, category);
    assert.equal((await listWorkshopServiceCategories(f.db, ctx, { status: "inactive" })).items[0].id, category);
    await assert.rejects(saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "Novo serviço", category_id: category, price: 1000,
    }), /categoria inativa/);
    await setWorkshopServiceCategoryActive(f.db, ctx, category, true);
    assert.equal((await listWorkshopServiceCategories(f.db, ctx, { q: "eletrica premium" })).items[0].id, category);
    assert.equal((await listWorkshopServices(f.db, { ...ctx, tenantId: "b" }, { status: "all", q: "hp-001" })).items[0].id, sameReferenceOtherOffice);
  } finally { f.db.close(); }
});
test("snapshot de serviço próprio mantém nome, descrição, preço configurado e custo após edição do cadastro", async () => {
  const f = fixture();
  try {
    const service = await saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "Limpeza de bicos", description: "Original", price: 6400, cost: 1200,
    });
    const orderId = await saveOrder(f.db, ctx, {
      status: "quote", customer_id: "c", vehicle_id: "v", entered_on: "2026-10-25", due_on: "2026-10-25",
      km: 0, discount: 0, notes: "", problem: "",
      items: [{ id: randomUUID(), workshop_service_id: service, manual_price: 7000, price: 7000, quantity: 1 }],
    });
    const before = (await listOrders(f.db, "a")).find((o) => o.id === orderId)!.items[0];
    assert.equal(before.service_details.name, "Limpeza de bicos");
    assert.equal(before.service_details.description, "Original");
    assert.equal(before.service_details.fixed_price, 6400);
    assert.equal(before.service_details.cost_known, true);
    await saveWorkshopService(f.db, ctx, {
      service_type: "private", name: "Limpeza avançada", description: "Atualizada", price: 9900,
    }, service);
    const after = (await listOrders(f.db, "a")).find((o) => o.id === orderId)!.items[0];
    assert.equal(after.service_details.name, before.service_details.name);
    assert.equal(after.service_details.description, before.service_details.description);
    assert.equal(after.service_details.fixed_price, before.service_details.fixed_price);
    assert.equal(after.price, 7000);
    assert.equal(after.service_details.porte_id, null);
    assert.equal(after.service_details.commercial_category_id, null);
    await saveOrder(f.db, ctx, {
      status: "quote", customer_id: "c", vehicle_id: "v",
      entered_on: "2026-10-25", due_on: "2026-10-26", km: 0,
      discount: 0, notes: "", problem: "", items: [after],
    }, orderId);
    const updated = (await listOrders(f.db, "a")).find((o) => o.id === orderId)!;
    assert.equal(updated.due_on, "2026-10-26");
    assert.equal(updated.items[0].id, after.id);
    assert.equal(updated.items[0].service_details.commercial_category_id, null);
  } finally {
    f.db.close();
  }
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
    const unique = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Modelo 2", year: 2020, service_model_id: null });
    assert.equal(unique.status, "matched");
    assert.equal(unique.model?.id, f.other);
    const emptyLink = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Modelo 2", service_model_id: "" });
    assert.equal(emptyLink.status, "matched");
    const fipeConflict = await identifyVehicleModel(f.db, ctx, { brand: "Marca", model: "Modelo 2", fipe_code: "999999-9", service_model_id: null });
    assert.equal(fipeConflict.status, "needs_confirmation");
    assert.equal(fipeConflict.model, null);
    assert.equal(fipeConflict.candidates[0]?.id, f.other);
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

test("OS com veículo antigo sem vínculo preserva cadastro até associação explícita", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand=?,model=?,fipe_code='' WHERE tenant_id=? AND id=?").run("Marca", "Modelo 2", "a", "v");
    const orderId = await saveOrder(f.db, ctx, { status: "quote", customer_id: "c", vehicle_id: "v", entered_on: "2026-10-25", due_on: "2026-10-25", km: 0, discount: 0, notes: "", problem: "", items: [] });
    assert.ok(orderId);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, "");
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

test("vehicleOnly não exibe gestão nem resultados de serviços particulares", () => {
  assert.equal(shouldShowWorkshopServices("manual", true), false);
  assert.equal(shouldShowVehicleCatalog("manual", true, false), false);
  assert.equal(shouldShowVehicleCatalog("manual", true, true), true);
  assert.equal(shouldShowWorkshopServices("manual", false), true);
  assert.equal(shouldShowVehicleCatalog("catalog", false, true), true);
});

test("importação longa sem FIPE sugere versões da mesma família sem vínculo automático ambíguo", async () => {
  const f = fixture();
  try {
    const chevrolet = randomUUID();
    const corsa14 = randomUUID();
    const corsa16 = randomUUID();
    f.db.prepare("INSERT INTO service_catalog.brands VALUES(?,?)").run(chevrolet, "Chevrolet");
    f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)").run(corsa14, chevrolet, "Corsa GL 1.4 EFi", "", f.porte, randomUUID(), "[]", 1);
    f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)").run(corsa16, chevrolet, "Corsa GL 1.6 MPFi", "", f.porte, randomUUID(), "[]", 1);
    const result = await identifyVehicleModel(f.db, ctx, {
      brand: "GM - Chevrolet",
      model: "Corsa GL 1.6 MPFI / 1.4 EFI 2p e 4p",
      year: 1998,
      fipe_code: "",
    });
    assert.equal(result.status, "needs_confirmation");
    assert.equal(result.model, null);
    assert.deepEqual(new Set(result.candidates.map((candidate) => candidate.id)), new Set([corsa14, corsa16]));
    const selectorSuggestions = await searchModels(f.db, ctx, {
      brand_id: chevrolet,
      q: "Corsa GL 1.6 MPFI / 1.4 EFI 2p e 4p",
    });
    assert.deepEqual(new Set(selectorSuggestions.items.map((candidate) => candidate.id)), new Set([corsa14, corsa16]));
    const single = await identifyVehicleModel(f.db, ctx, {
      brand: "Chevrolet",
      model: "Corsa GL 1.4 EFI",
      year: 1998,
    });
    assert.equal(single.status, "matched");
    assert.equal(single.model?.id, corsa14);
    const conflict = await identifyVehicleModel(f.db, ctx, {
      brand: "Chevrolet",
      model: "Corsa GL 1.4 EFI",
      fipe_model: "Corsa GL 1.6 MPFI",
    });
    assert.equal(conflict.status, "needs_confirmation");
    const celta = randomUUID();
    f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)").run(celta, chevrolet, "Celta 1.0", "555555-5", f.porte, randomUUID(), "[]", 1);
    const fipeOnly = await identifyVehicleModel(f.db, ctx, {
      brand: "Chevrolet",
      model: "",
      fipe_code: "555555-5",
    });
    assert.equal(fipeOnly.status, "matched");
    assert.equal(fipeOnly.model?.id, celta);
  } finally { f.db.close(); }
});

test("prévia paginada do catálogo é somente leitura e restrita à oficina autenticada", async () => {
  const f = fixture();
  try {
    const before = f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id;
    const page = await previewVehicleCatalogReview(f.db, ctx, { limit: 1, offset: 0 });
    assert.equal(page.dry_run, true);
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.vehicle.id, "v");
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, before);
    const denied = await previewVehicleCatalogReview(f.db, { ...ctx, tenantId: "b" }, { limit: 1 });
    assert.equal(denied.total, 0);
    assert.equal(denied.items.length, 0);
  } finally { f.db.close(); }
});

test("vehicleOnly nunca dispara pesquisa de serviços ou exige categoria de cobrança", () => {
  assert.equal(shouldLoadRepairServiceSearch("manual", true, "", false), false);
  assert.equal(shouldLoadRepairServiceSearch("catalog", true, "modelo", true), false);
  assert.equal(shouldLoadRepairServiceSearch("catalog", false, "modelo", false), false);
  assert.equal(shouldLoadRepairServiceSearch("catalog", false, "modelo", true), true);
  assert.equal(shouldLoadRepairServiceSearch("manual", false, "", false), false);
  assert.equal(shouldLoadRepairServiceSearch("manual", false, "", true), true);
});


test("família FIPE truncada acima de 101 candidatos nunca gera vínculo automático", async () => {
  const f = fixture();
  try {
    const target = randomUUID();
    f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)")
      .run(target, f.brand, "Civic LXS 1.8", "004004-5", f.porte, randomUUID(), "[]", 1);
    for (let index = 0; index < 101; index++) {
      f.db.prepare("INSERT INTO service_catalog.models VALUES(?,?,?,?,?,?,?,?)")
        .run(randomUUID(), f.brand, `Modelo Importado ${index.toString().padStart(3, "0")}`, "004004-5", f.porte, randomUUID(), "[]", 1);
    }
    const result = await identifyVehicleModel(f.db, ctx, {
      brand: "Marca",
      model: "Civic LXS 1.8",
      fipe_code: "004004-5",
    });
    assert.equal(result.status, "needs_confirmation");
    assert.equal(result.model, null);
    assert.ok(result.candidates.some((candidate) => candidate.id === target));
  } finally { f.db.close(); }
});

test("auditoria permanece gravável durante a implantação antes da migração de metadados", async () => {
  const f = fixture();
  try {
    f.db.exec("ALTER TABLE audit_events DROP COLUMN metadata");
    const metadataSaved = await audit(f.db, ctx, "vehicles.external_lookup_updated", "v", {
      source: "fipeplaca",
      updated_fields: ["brand"],
    });
    assert.equal(metadataSaved, false);
    const event = f.db.prepare("SELECT action FROM audit_events WHERE tenant_id='a' AND entity_id='v'").get() as any;
    assert.equal(event.action, "vehicles.external_lookup_updated");
  } finally { f.db.close(); }
});

test("nova inclusão técnica exige revisar vínculo de veículo divergente", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET service_model_id=?,brand=?,model=? WHERE tenant_id='a' AND id='v'")
      .run(f.model, "Outra Marca", "Modelo incompatível");
    const input = {
      status: "quote",
      customer_id: "c",
      vehicle_id: "v",
      service_model_id: f.model,
      entered_on: "2026-10-25",
      due_on: "2026-10-25",
      km: 0,
      discount: 0,
      notes: "",
      problem: "",
      items: [{ id: randomUUID(), repair_service_id: f.service, repair_model_id: f.model, price: 12000, quantity: 1 }],
    };
    await assert.rejects(saveOrder(f.db, ctx, input), /divergem do vínculo técnico/);
    assert.equal(f.db.prepare("SELECT count(*) n FROM orders WHERE tenant_id='a'").get()!.n, 0);
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()!.service_model_id, f.model);
  } finally { f.db.close(); }
});

test("revisão separa cadastro completo, incompleto, inconsistente e correspondência ambígua sem escrever", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand='Marca',model='Modelo 2',year=2020,fipe_code='' WHERE tenant_id='a' AND id='v'").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('incomplete','a','c','ABC1D24','','Modelo 2',2020)").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('invalid-plate','a','c','ABC123','Marca','Modelo 2',2020)").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,fipe_code) VALUES('ambiguous','a','c','ABC1D25','Marca','Modelo','2020','123456-7')").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,fipe_code) VALUES('fipe-conflict','a','c','ABC1D27','Marca','Modelo 2',2020,'999999-9')").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,service_model_id) VALUES('mismatched-link','a','c','ABC1D26','Outra','Modelo 1',2020,?)").run(f.model);

    const page = await previewVehicleCatalogReview(f.db, ctx, { limit: 50 });
    assert.equal(page.dry_run, true);
    const byId = new Map(page.items.map((item) => [String(item.vehicle.id), item]));
    assert.equal(byId.get("v")?.data_quality, "complete");
    assert.equal(byId.get("v")?.catalog_status, "matched");
    assert.equal(byId.get("incomplete")?.data_quality, "incomplete");
    assert.equal(byId.get("incomplete")?.catalog_status, "not_evaluated");
    assert.equal(byId.get("invalid-plate")?.data_quality, "inconsistent");
    assert.equal(byId.get("ambiguous")?.data_quality, "complete");
    assert.equal(byId.get("ambiguous")?.catalog_status, "ambiguous");
    assert.equal(byId.get("fipe-conflict")?.data_quality, "inconsistent");
    assert.equal(byId.get("fipe-conflict")?.catalog_status, "inconsistent");
    assert.equal(byId.get("mismatched-link")?.data_quality, "inconsistent");
    assert.equal(byId.get("mismatched-link")?.catalog_status, "inconsistent");
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE tenant_id='a' AND id='v'").get()?.service_model_id, "");
    assert.equal(f.db.prepare("SELECT count(*) n FROM orders WHERE tenant_id='a'").get()!.n, 0);
  } finally { f.db.close(); }
});

test("prévia tolera ano zero, inválido, ausente e campos legados longos sem alterar veículos ou OS", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand='Marca',model='Modelo 2',year=2020,fipe_code='' WHERE tenant_id='a' AND id='v'").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('year-zero','a','c','ABC1D24','Marca','Modelo 2',0)").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('year-old','a','c','ABC1D25','Marca','Modelo 2',1899)").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('year-missing','a','c','ABC1D26','Marca','Modelo 2',0)").run();
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('long-model','a','c','ABC1D27','Marca',?,2020)").run("Modelo ".padEnd(301, "x"));
    f.db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,fipe_model) VALUES('long-fipe-model','a','c','ABC1D28','Marca','Modelo 2',2020,?)").run("Modelo ".padEnd(301, "x"));

    const originalVehicles = f.db.prepare("SELECT id,plate,brand,model,year,fipe_code,fipe_model,service_model_id FROM vehicles WHERE tenant_id='a' ORDER BY id").all();
    const reviewDb = new Proxy(f.db, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!sql.includes("SELECT v.*,c.name customer_name")) return statement;
            return {
              all: async (...params: Parameters<typeof statement.all>) => {
                const rows = await statement.all(...params);
                return rows.map((row) => {
                  if (row.id !== "year-missing") return row;
                  const { year: _legacyYear, ...withoutYear } = row;
                  return withoutYear;
                });
              },
            } as unknown as ReturnType<typeof target.prepare>;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const page = await previewVehicleCatalogReview(reviewDb, ctx, { limit: 50 });
    assert.equal(page.dry_run, true);
    assert.equal(page.total, 6);
    assert.deepEqual(
      f.db.prepare("SELECT id,plate,brand,model,year,fipe_code,fipe_model,service_model_id FROM vehicles WHERE tenant_id='a' ORDER BY id").all(),
      originalVehicles,
    );
    const byId = new Map(page.items.map((item) => [String(item.vehicle.id), item]));
    assert.equal(byId.get("v")?.data_quality, "complete");
    assert.equal(byId.get("v")?.catalog_status, "matched");
    assert.equal(byId.get("year-zero")?.data_quality, "incomplete");
    assert.equal(byId.get("year-zero")?.catalog_status, "not_evaluated");
    assert.equal(byId.get("year-old")?.data_quality, "inconsistent");
    assert.equal(byId.get("year-missing")?.data_quality, "incomplete");
    assert.equal(byId.get("long-model")?.data_quality, "inconsistent");
    assert.equal(byId.get("long-fipe-model")?.data_quality, "inconsistent");
    assert.equal(f.db.prepare("SELECT year FROM vehicles WHERE tenant_id='a' AND id='year-zero'").get()?.year, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM orders WHERE tenant_id='a'").get()!.n, 0);
  } finally { f.db.close(); }
});

test("CAD-005: associação manual independente da FIPE é preservada e ausência explícita não vincula", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE vehicles SET brand='Outra marca',fipe_model='Versão FIPE',service_model_id=?,service_link_mode='manual' WHERE id='v'").run(f.model);
    const row = f.db.prepare("SELECT * FROM vehicles WHERE id='v'").get()!;
    const match = await identifyVehicleModel(f.db, ctx, row);
    assert.equal(match.status, "linked");
    assert.equal(match.model?.id, f.model);
    const preview = await previewVehicleCatalogReview(f.db, ctx, {});
    assert.equal(preview.items[0].catalog_status, "linked");
    await saveOrder(f.db, ctx, { status: "quote", customer_id: "c", new_vehicle: { plate: "CAD0A05", brand: "Marca", model: "Modelo 2", year: 2020, service_model_id: null }, entered_on: "2026-10-30", due_on: "2026-10-30", km: 0, discount: 0, notes: "", problem: "", items: [] });
    assert.equal(f.db.prepare("SELECT service_model_id FROM vehicles WHERE plate='CAD0A05'").get()?.service_model_id, "");
  } finally { f.db.close(); }
});



test('OPS-003: novo terceiro usa a faixa vigente e snapshot mantém taxa após mudança da tabela',async()=>{
 const f=fixture();
 try {
  const {savePartsPricing}=await import('../server/services/partsPricing');
  const service_rules=[{from:0,up_to:10000,markup_bps:5000,minimum_profit:0},{from:10001,up_to:null,markup_bps:1000,minimum_profit:0}];
  await savePartsPricing(f.db,ctx,{service_rules});
  const selection={repair_service_id:f.service,repair_model_id:f.model,service_execution:'outsourced' as const,service_cost:10000};
  const first=await resolveService(f.db,ctx,selection);
  assert.equal(first.price,15000);
  assert.equal(JSON.parse(first.service_snapshot).markup_bps,5000);
  await savePartsPricing(f.db,ctx,{service_rules:[{from:0,up_to:null,markup_bps:9000,minimum_profit:0}]});
  const preserved=await resolveService(f.db,ctx,selection,{service_snapshot:first.service_snapshot});
  assert.equal(preserved.price,15000);
  assert.equal(JSON.parse(preserved.service_snapshot).markup_bps,5000);
  assert.equal((await resolveService(f.db,ctx,selection)).price,19000);
  assert.equal((await resolveService(f.db,ctx,{repair_service_id:f.service,repair_model_id:f.model})).price,12000);
 }finally{f.db.close();}
});
