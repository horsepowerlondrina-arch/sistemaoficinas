import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "../server/db/postgres";
import { createApp } from "../server/app";
import { assertDevelopmentIsolation } from "../server/developmentIsolation";
import { hashPassword } from "../server/auth/session";
process.loadEnvFile(".env.local");
assertDevelopmentIsolation(process.env);
const db = createPostgresDatabase(),
  userId = randomUUID(),
  password = randomUUID(),
  email = `${userId}@example.invalid`,
  tag = `Teste integração ${userId}`;
let orderId = "",
  customerId = "",
  vehicleId = "",
  porte = "",
  previousRate: number | undefined;
const privateIds: string[] = [];
const server = createApp(db).listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
let cookie = "";
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert([200, 201].includes(response.status), JSON.stringify(value));
  return value;
}
try {
  await db
    .prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)")
    .run(userId, "Validação temporária", email, hashPassword(password));
  await db
    .prepare(
      "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,'hp-centro','owner')",
    )
    .run(userId);
  const login = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const config = await request("/repair-services/config");
  assert(config.enabled);
  assert.equal(config.portes.length, 14);
  const models = await request("/repair-services/models?q=Uno");
  const model = models.items.find(
    (m: any) => m.service_count > 0 && m.porte_id,
  );
  assert(model);
  porte = model.porte_id;
  previousRate = (
    await db
      .prepare(
        "SELECT hourly_rate FROM labor_rates WHERE tenant_id='hp-centro' AND porte_id=?",
      )
      .get(porte)
  )?.hourly_rate;
  await request("/repair-services/rates", "PUT", {
    rates: [{ porte_id: porte, hourly_rate: 12000 }],
  });
  const services = await request(
    `/repair-services/models/${model.id}/services`,
  );
  const service = services.items.find((s: any) => s.minutes > 0);
  assert(service);
  const selection = {
    repair_model_id: model.id,
    repair_service_id: service.service_id,
  };
  const preview = await request("/repair-services/preview", "POST", selection);
  assert.equal(preview.price, Math.round((service.minutes * 12000) / 60));
  const date = new Date().toISOString().slice(0, 10);
  const plate = `ZZZ${Math.floor(Math.random() * 10)}Z${Math.floor(10 + Math.random() * 90)}`;
  const input: any = {
    status: "quote",
    entered_on: date,
    due_on: date,
    km: 0,
    problem: tag,
    notes: "",
    discount: 0,
    service_model_id: model.id,
    new_customer: { name: tag, phone: "43999990000" },
    new_vehicle: {
      plate,
      brand: model.brand,
      model: model.name,
      year: 2020,
      km: 0,
    },
    items: [{ ...selection, quantity: 1, price: preview.price + 37 }],
  };
  orderId = (await request("/orders", "POST", input)).id;
  let workspace = await request("/workspace");
  let order = workspace.orders.find((o: any) => o.id === orderId);
  assert(order);
  customerId = order.customer_id;
  vehicleId = order.vehicle_id;
  assert.equal(
    workspace.vehicles.find((v: any) => v.id === vehicleId).service_model_id,
    model.id,
  );
  assert.equal(order.items[0].service_details.minutes, service.minutes);
  assert.equal(order.items[0].service_details.hourly_rate, 12000);
  assert.equal(order.items[0].price, preview.price + 37);
  const record = await request("/workshop-services", "POST", {
    name: tag,
    execution: "outsourced",
    porte_id: porte,
    minutes: 0,
    price: 0,
    cost: 10000,
    pricing_mode: "price",
  });
  privateIds.push(record.id);
  const manualSelection = { workshop_service_id: record.id, porte_id: porte };
  const manual = await request(
    "/repair-services/preview",
    "POST",
    manualSelection,
  );
  assert.equal(
    manual.price,
    Math.round((10000 * (10000 + config.service_markup_bps)) / 10000),
  );
  await request(`/orders/${orderId}`, "PUT", {
    ...order,
    service_model_id: model.id,
    items: [
      ...order.items,
      { ...manualSelection, quantity: 1, price: manual.price },
    ],
  });
  workspace = await request("/workspace");
  order = workspace.orders.find((o: any) => o.id === orderId);
  assert.equal(order.items.length, 2);
  assert.equal(
    order.items.find((i: any) => i.workshop_service_id === record.id).cost,
    10000,
  );
  const before = JSON.stringify(order.items);
  await request("/repair-services/rates", "PUT", {
    rates: [{ porte_id: porte, hourly_rate: 18000 }],
  });
  await request(`/orders/${orderId}`, "PUT", {
    ...order,
    service_model_id: model.id,
    notes: "Observação de teste",
  });
  workspace = await request("/workspace");
  order = workspace.orders.find((o: any) => o.id === orderId);
  assert.equal(JSON.stringify(order.items), before);
  await request("/repair-services/rates", "PUT", {
    rates: [{ porte_id: porte, hourly_rate: 12000 }],
  });
  assert.equal(
    (await db
      .prepare(
        "SELECT count(*) n FROM stock_movements WHERE tenant_id='hp-centro' AND order_id=?",
      )
      .get(orderId))!.n,
    0,
  );
  console.log(
    JSON.stringify({
      apiIntegration: true,
      models: true,
      modelServices: true,
      calculation: true,
      manualThirdParty: true,
      vehicleAssociation: true,
      snapshots: true,
      noStockMovement: true,
    }),
  );
} finally {
  const pending = await db
    .prepare(
      "SELECT id,customer_id,vehicle_id FROM orders WHERE tenant_id='hp-centro' AND problem=?",
    )
    .get(tag);
  if (pending) {
    orderId = pending.id;
    customerId = pending.customer_id;
    vehicleId = pending.vehicle_id;
  }
  if (orderId) {
    await db
      .prepare(
        "DELETE FROM order_items WHERE tenant_id='hp-centro' AND order_id=?",
      )
      .run(orderId);
    await db
      .prepare("DELETE FROM orders WHERE tenant_id='hp-centro' AND id=?")
      .run(orderId);
  }
  if (vehicleId)
    await db
      .prepare("DELETE FROM vehicles WHERE tenant_id='hp-centro' AND id=?")
      .run(vehicleId);
  if (customerId)
    await db
      .prepare("DELETE FROM customers WHERE tenant_id='hp-centro' AND id=?")
      .run(customerId);
  for (const key of privateIds)
    await db
      .prepare(
        "DELETE FROM workshop_services WHERE tenant_id='hp-centro' AND id=?",
      )
      .run(key);
  if (porte && previousRate !== undefined)
    await db
      .prepare(
        "UPDATE labor_rates SET hourly_rate=? WHERE tenant_id='hp-centro' AND porte_id=?",
      )
      .run(previousRate, porte);
  else if (porte)
    await db
      .prepare(
        "DELETE FROM labor_rates WHERE tenant_id='hp-centro' AND porte_id=?",
      )
      .run(porte);
  await db.prepare("DELETE FROM audit_events WHERE user_id=?").run(userId);
  await db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  await db.prepare("DELETE FROM memberships WHERE user_id=?").run(userId);
  await db.prepare("DELETE FROM users WHERE id=?").run(userId);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
}
