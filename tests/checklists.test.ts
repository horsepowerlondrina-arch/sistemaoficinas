import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import {
  addChecklistPhoto,
  createChecklist,
  finalizeChecklist,
  getChecklist,
  getChecklistPhoto,
  listChecklists,
  removeChecklistPhoto,
  updateChecklist,
} from "../server/services/checklists";
import { readDocument } from "../server/services/documents";

const ctx = { userId: "u", tenantId: "t", role: "owner" };

function fixture() {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO tenants(id,name) VALUES(?,?)").run("t", "Horse Power");
  db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run(
    "u",
    "Responsável",
    "u@example.com",
    "unused",
  );
  db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run(
    "u",
    "t",
    "owner",
  );
  db.prepare(
    "INSERT INTO customers(id,tenant_id,name,phone) VALUES(?,?,?,?)",
  ).run("c", "t", "Cliente Teste", "43999999999");
  db.prepare(
    "INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,color,km) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run("v", "t", "c", "ABC1D23", "Honda", "Civic", 2022, "Prata", 12345);
  db.prepare(
    "INSERT INTO orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,entered_on,due_on,km,problem) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "o",
    "t",
    123,
    "order",
    "open",
    "c",
    "v",
    "2026-10-04",
    "2026-10-04",
    12500,
    "Ruído dianteiro",
  );
  return db;
}

test("checklist vincula OS/veículo, salva fotos e finaliza com assinatura", async () => {
  const db = fixture();
  try {
    const created = await createChecklist(db, ctx, {
      order_id: "o",
      plate: "ABC1D23",
      lookup_source: "local",
      customer_id: "c",
      customer_name: "Cliente Teste",
      phone: "43999999999",
      vehicle_data: {
        brand: "Honda",
        model: "Civic",
        year: 2022,
        color: "Prata",
        chassis: "",
      },
      km: 12500,
      fuel_level: 50,
      inspector: "Responsável",
    });
    let checklist = await getChecklist(db, ctx, created.id);
    assert.equal(checklist.plate, "ABC1D23");
    assert.equal(checklist.order_number, 123);
    assert.equal(checklist.complaint, "Ruído dianteiro");

    checklist = await updateChecklist(db, ctx, created.id, {
      km: 12600,
      fuel_level: 25,
      inspector: "Responsável",
      complaint: "Ruído dianteiro",
      conditions: { "Para-brisa e vidros": "ok" },
      accessories_notes: "",
      panel_lights: { ABS: true },
      panel_notes: "",
      objects_left: "Documento",
      functioning_notes: "Motor funcionando normalmente",
      damages: [{ x: 50, y: 20, type: "Risco", note: "Capô" }],
      damage_notes: "",
      signature_data: "data:image/png;base64,QUJDRA==",
      signature_absent_reason: "",
      customer_confirmed: true,
    });
    assert.equal(checklist.km, 12600);
    assert.equal(checklist.panel_lights.ABS, true);

    const photo = await addChecklistPhoto(
      db,
      ctx,
      created.id,
      "front",
      "image/jpeg",
      Buffer.alloc(200, 1),
    );
    const raw = await getChecklistPhoto(db, ctx, photo.id);
    assert.equal(raw.mime, "image/jpeg");
    assert.equal(Buffer.from(raw.image_data, "base64").length, 200);

    const completed = await finalizeChecklist(db, ctx, created.id);
    assert.equal(completed.status, "completed");
    assert.equal((await listChecklists(db, ctx)).length, 1);
    const issued=await readDocument(db,ctx,"checklist",created.id,1);
    assert.equal(issued.checklist.signature_data,"data:image/png;base64,QUJDRA==");
    assert.equal(issued.checklist.photos[0].image_url,"data:image/jpeg;base64,"+Buffer.alloc(200,1).toString("base64"));
    db.prepare("UPDATE checklist_photos SET image_data='changed' WHERE tenant_id='t' AND checklist_id=?").run(created.id);
    assert.notEqual((await readDocument(db,ctx,"checklist",created.id,1)).checklist.photos[0].image_url,"data:image/jpeg;base64,changed");
  } finally {
    db.close();
  }
});


test("placa já cadastrada reaproveita cliente e veículo e abre orçamento ao finalizar", async () => {
  const db = fixture();
  try {
    const created = await createChecklist(db, ctx, {
      plate: "ABC1D23",
      lookup_source: "local",
      customer_id: "c",
      customer_name: "Cliente Teste",
      phone: "43999999999",
      vehicle_data: {
        brand: "Honda",
        model: "Civic",
        year: 2022,
        color: "Prata",
        chassis: "",
      },
      km: 13000,
      fuel_level: 50,
      inspector: "Responsável",
    });
    await updateChecklist(db, ctx, created.id, {
      km: 13000,
      fuel_level: 50,
      inspector: "Responsável",
      complaint: "Revisão geral",
      conditions: {},
      accessories_notes: "",
      panel_lights: {},
      panel_notes: "",
      objects_left: "",
      functioning_notes: "",
      damages: [],
      damage_notes: "",
      signature_data: "",
      signature_absent_reason: "Cliente não estava presente",
      customer_confirmed: false,
    });
    const completed = await finalizeChecklist(db, ctx, created.id);
    assert.equal(completed.created_quote, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM customers WHERE tenant_id='t'").get()!.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM vehicles WHERE tenant_id='t'").get()!.n,
      1,
    );
    const quote = db
      .prepare("SELECT * FROM orders WHERE tenant_id=? AND id=?")
      .get("t", completed.redirect_order_id)!;
    assert.equal(quote.kind, "quote");
    assert.equal(quote.status, "quote");
    assert.equal(quote.customer_id, "c");
    assert.equal(quote.vehicle_id, "v");
    assert.equal(quote.problem, "Revisão geral");
  } finally {
    db.close();
  }
});

test("placa nova cadastra cliente e veículo somente ao finalizar e abre orçamento", async () => {
  const db = fixture();
  try {
    const created = await createChecklist(db, ctx, {
      plate: "DEF4G56",
      lookup_source: "external",
      customer_id: null,
      customer_name: "Novo Cliente",
      phone: "43988887777",
      vehicle_data: {
        brand: "Toyota",
        model: "Corolla",
        year: 2024,
        color: "Branco",
        chassis: "",
      },
      km: 2500,
      fuel_level: 75,
      inspector: "Responsável",
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM customers WHERE tenant_id='t'").get()!.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM vehicles WHERE tenant_id='t'").get()!.n,
      1,
    );
    await updateChecklist(db, ctx, created.id, {
      km: 2500,
      fuel_level: 75,
      inspector: "Responsável",
      complaint: "Barulho ao frear",
      conditions: {},
      accessories_notes: "",
      panel_lights: {},
      panel_notes: "",
      objects_left: "",
      functioning_notes: "",
      damages: [],
      damage_notes: "",
      signature_data: "",
      signature_absent_reason: "Cliente autorizou sem assinatura",
      customer_confirmed: false,
    });
    const completed = await finalizeChecklist(db, ctx, created.id);
    assert.equal(completed.created_quote, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM customers WHERE tenant_id='t'").get()!.n,
      2,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM vehicles WHERE tenant_id='t'").get()!.n,
      2,
    );
    const vehicle = db
      .prepare("SELECT * FROM vehicles WHERE tenant_id=? AND plate=?")
      .get("t", "DEF4G56")!;
    const customer = db
      .prepare("SELECT * FROM customers WHERE tenant_id=? AND id=?")
      .get("t", vehicle.customer_id)!;
    assert.equal(customer.name, "Novo Cliente");
    const quote = db
      .prepare("SELECT * FROM orders WHERE tenant_id=? AND id=?")
      .get("t", completed.redirect_order_id)!;
    assert.equal(quote.kind, "quote");
    assert.equal(quote.vehicle_id, vehicle.id);
    assert.equal(quote.customer_id, customer.id);
    assert.equal(quote.problem, "Barulho ao frear");
  } finally {
    db.close();
  }
});

test("foto pode ser removida enquanto checklist está em rascunho", async () => {
  const db = fixture();
  try {
    const created = await createChecklist(db, ctx, {
      plate: "ABC1D23",
      lookup_source: "local",
      customer_id: "c",
      customer_name: "Cliente Teste",
      phone: "43999999999",
      vehicle_data: {
        brand: "Honda",
        model: "Civic",
        year: 2022,
        color: "Prata",
        chassis: "",
      },
      km: 12345,
      fuel_level: 75,
      inspector: "Responsável",
    });
    const photo = await addChecklistPhoto(
      db,
      ctx,
      created.id,
      "rear",
      "image/jpeg",
      Buffer.alloc(200, 2),
    );
    await removeChecklistPhoto(db, ctx, created.id, photo.id);
    assert.equal((await getChecklist(db, ctx, created.id)).photos.length, 0);
  } finally {
    db.close();
  }
});
