import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database";
import { saveOrder, transitionOrder } from "../server/services/workshop";
import { createApp } from "../server/app";
import { digest } from "../server/auth/session";
const ctx = { userId: "u", tenantId: "a", role: "owner" };
function fixture() {
  const db = createDatabase(":memory:");
  db.exec(
    "INSERT INTO tenants(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','Admin','admin@example.test','disabled'),('m','Operador','operator@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator'); INSERT INTO customers(id,tenant_id,name,phone) VALUES('existing','a','Maria da Silva','(43) 99999-1111'),('foreign','b','Cliente Novo','(43) 98888-2222'); INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES('v','a','existing','ABC1D23','Marca','Modelo',2020)",
  );
  return db;
}
const input = (extra: Record<string, any> = {}) => ({
  status: "quote",
  customer_id: "",
  vehicle_id: "",
  guest_name: "",
  guest_plate: "DEF4G56",
  guest_vehicle: "Veículo de exemplo",
  entered_on: "2026-10-13",
  due_on: "2026-10-14",
  km: 123,
  problem: "",
  notes: "",
  discount: 0,
  items: [],
  new_customer: { name: "Cliente Novo", phone: "(43) 98888-2222" },
  ...extra,
});
test("quotes persist complete vehicle data for new and existing clients and reuse the registration on approval", async () => {
  const db = fixture();
  try {
    for (const existing of [false, true]) {
      const v = {
        plate: existing ? "GHI7J89" : "DEF4G56",
        brand: "Chevrolet",
        model: "Onix LT",
        year: 2020,
        color: "Prata",
        chassis: "9BG12345678901234",
        km: 123,
      };
      const payload = input({
        new_vehicle: v,
        ...(existing
          ? { customer_id: "existing", new_customer: undefined }
          : {}),
      });
      const record = await saveOrder(db, ctx, payload);
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(record)!;
      const vehicle = db
        .prepare("SELECT * FROM vehicles WHERE id=?")
        .get(order.vehicle_id)!;
      for (const key of [
        "plate",
        "brand",
        "model",
        "year",
        "color",
        "chassis",
        "km",
      ])
        assert.equal(vehicle[key], (v as any)[key]);
      assert.equal(vehicle.customer_id, order.customer_id);
      if (existing) assert.equal(order.customer_id, "existing");
      await saveOrder(db, ctx, payload, record);
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) n FROM vehicles WHERE tenant_id='a' AND plate=?",
          )
          .get(v.plate)!.n,
        1,
      );
      await transitionOrder(db, ctx, record, "open", "2026-10-14");
      assert.equal(
        db.prepare("SELECT vehicle_id FROM orders WHERE id=?").get(record)!
          .vehicle_id,
        vehicle.id,
      );
    }
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM stock_movements").get()!.n,
      0,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 0);
  } finally {
    db.close();
  }
});
test("saving a quote creates and links its customer, isolates tenants and reuses name plus phone on retries", async () => {
  const db = fixture();
  try {
    const first = await saveOrder(db, ctx, input());
    const customer = db
      .prepare(
        "SELECT * FROM customers WHERE tenant_id='a' AND name='Cliente Novo'",
      )
      .get()!;
    assert.equal(customer.phone, "(43) 98888-2222");
    assert.notEqual(customer.id, "foreign");
    assert.equal(
      db.prepare("SELECT customer_id FROM orders WHERE id=?").get(first)!
        .customer_id,
      customer.id,
    );
    await saveOrder(
      db,
      ctx,
      input({
        new_customer: { name: " CLIENTE   NOVO ", phone: "+55 43 98888-2222" },
      }),
      first,
    );
    await Promise.all([
      saveOrder(db, ctx, input()),
      saveOrder(db, ctx, input()),
    ]);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM customers WHERE tenant_id='a' AND name='Cliente Novo'",
        )
        .get()!.n,
      1,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vehicles").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receivables").get()!.n, 0);
  } finally {
    db.close();
  }
});
test("new customer phone is mandatory and failed attendance rolls back customer and audit creation", async () => {
  const db = fixture();
  try {
    for (const phone of ["", "123", "telefone 43988882222"]) {
      await assert.rejects(
        saveOrder(
          db,
          ctx,
          input({ new_customer: { name: "Cliente Novo", phone } }),
        ),
        /telefone/,
      );
    }
    await assert.rejects(
      saveOrder(db, ctx, input({ status: "open", due_on: "2026-10-12", customer_id: "existing", vehicle_id: "v", new_customer: undefined })),
      /previsão/,
    );
    await assert.rejects(
      saveOrder(db, ctx, input({ vehicle_id: "v" })),
      /não pertence/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM customers").get()!.n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events").get()!.n, 0);
    await assert.rejects(saveOrder(db, { ...ctx, role: "operator" }, input()));
  } finally {
    db.close();
  }
});
test("a new OS saves customer vehicle and attendance atomically and refuses plates owned by another client", async () => {
  const db = fixture();
  try {
    const vehicle = {
      plate: "DEF4G56",
      brand: "Chevrolet",
      model: "Onix",
      year: 2020,
      color: "Prata",
      km: 123,
    };
    await assert.rejects(
      saveOrder(db, ctx, input({ status: "open" })),
      /cliente e o veículo/,
    );
    const record = await saveOrder(
      db,
      ctx,
      input({ status: "open", new_vehicle: vehicle }),
    );
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(record)!;
    const savedVehicle = db
      .prepare("SELECT * FROM vehicles WHERE id=?")
      .get(order.vehicle_id)!;
    assert.equal(savedVehicle.customer_id, order.customer_id);
    assert.equal(savedVehicle.km, 123);
    assert.equal(order.kind, "order");
    await saveOrder(
      db,
      ctx,
      input({ status: "open", new_vehicle: vehicle }),
      record,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM vehicles").get()!.n, 2);
    await assert.rejects(
      saveOrder(
        db,
        ctx,
        input({
          status: "open",
          new_customer: { name: "Outro Cliente", phone: "43977773333" },
          new_vehicle: { ...vehicle, plate: "ABC1D23" },
        }),
      ),
      /outro cliente/,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM customers WHERE name='Outro Cliente'")
        .get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});
test("order API accepts automatic customer/vehicle payloads and still requires owner role and valid phone", async () => {
  const db = fixture();
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("owner"),
    "u",
    "a",
    Date.now() + 60000,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    digest("operator"),
    "m",
    "a",
    Date.now() + 60000,
  );
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/orders`;
  const post = (body: any, cookie = "owner") =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `hp_session=${cookie}`,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post(input(), "operator")).status, 403);
    const invalid = await post(
      input({ new_customer: { name: "Cliente Novo", phone: "" } }),
    );
    assert.equal(invalid.status, 400);
    await invalid.text();
    const response = await post(
      input({
        status: "open",
        new_vehicle: {
          plate: "DEF4G56",
          brand: "Chevrolet",
          model: "Onix",
          year: 2020,
          km: 123,
        },
      }),
    );
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id)!;
    assert.ok(order.customer_id);
    assert.ok(order.vehicle_id);
    assert.equal(
      db
        .prepare("SELECT name FROM customers WHERE id=?")
        .get(order.customer_id)!.name,
      "Cliente Novo",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
