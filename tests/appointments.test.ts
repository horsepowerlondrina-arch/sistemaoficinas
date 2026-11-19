import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database.js";
import { createAppointment, listAppointments, cancelAppointment } from "../server/services/appointments.js";
import { createChecklist } from "../server/services/checklists.js";

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
const hours = [{ day: weekday, closed: false, open: "08:00", close: "18:00", break_start: "12:00", break_end: "13:00" }];
const owner = { tenantId: "t", userId: "u", role: "owner", modules: { agenda: true } };
const input = { starts_at: `${day}T09:00`, ends_at: `${day}T11:00`, professional_id: "mechanic", plate: "ABC1D23", customer_name: "Cliente Temporário", phone: "43999999999", planned_services: "Revisão de freios" };

function fixture() {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO tenants(id,name,profile_data) VALUES(?,?,?)").run("t", "Oficina A", JSON.stringify({ business_hours: hours }));
  db.prepare("INSERT INTO tenants(id,name,profile_data) VALUES(?,?,?)").run("other", "Oficina B", JSON.stringify({ business_hours: hours }));
  db.prepare("INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)").run("u", "Responsável", "u@example.test", "fixture");
  db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run("u", "t", "owner");
  db.prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)").run("u", "other", "owner");
  db.prepare("INSERT INTO professionals(id,tenant_id,name) VALUES(?,?,?)").run("mechanic", "t", "Mecânico A");
  db.prepare("INSERT INTO professionals(id,tenant_id,name) VALUES(?,?,?)").run("second", "t", "Mecânico B");
  return db;
}

test("Agenda mantém cadastro provisório e isola oficinas", async () => {
  const db = fixture();
  const saved = await createAppointment(db, owner, input);
  const row = (await listAppointments(db, owner, day))[0];
  assert.equal(row.id, saved.id);
  assert.equal(row.ends_at, `${day}T11:00`);
  assert.equal(row.customer_id, null);
  assert.equal(db.prepare("SELECT count(*) AS total FROM customers WHERE tenant_id='t'").get()?.total, 0);
  assert.equal((await listAppointments(db, { ...owner, tenantId: "other" }, day)).length, 0);
  await assert.rejects(createAppointment(db, owner, { ...input, starts_at: `${day}T10:00` }), /já tem agendamento/);
  await assert.rejects(createAppointment(db, owner, { ...input, plate: "XYZ1A23" }), /já tem agendamento/);
  await createAppointment(db, owner, { ...input, plate: "XYZ1A23", professional_id: "second" });
  await createAppointment(db, owner, { ...input, starts_at: `${day}T11:30`, ends_at: `${day}T13:30` });
  await assert.rejects(createAppointment(db, owner, { ...input, starts_at: `${day}T12:30`, ends_at: `${day}T14:00` }), /início fora do intervalo/);
  await assert.rejects(createAppointment(db, owner, { ...input, starts_at: `${day}T11:30`, ends_at: `${day}T12:30` }), /final fora do intervalo/);
  await assert.rejects(createAppointment(db, { ...owner, modules: { agenda: false } }, input), /Profissional e Premium/);
  await cancelAppointment(db, owner, saved.id);
  await createAppointment(db, owner, input);
});

test("Checklist da chegada vincula agendamento somente da placa e do dia", async () => {
  const db = fixture();
  const saved = await createAppointment(db, owner, input);
  const checklist = {
    appointment_id: saved.id, plate: input.plate, lookup_source: "manual",
    customer_name: input.customer_name, phone: input.phone,
    vehicle_data: { brand: "Marca Fictícia", model: "Modelo Fictício", year: 2020, color: "", chassis: "" },
    inspector: "Responsável", km: 0, fuel_level: 50,
  };
  await assert.rejects(createChecklist(db, owner, { ...checklist, plate: "XYZ1A23" }), /placa prevista/);
  const created = await createChecklist(db, owner, checklist);
  assert.equal(db.prepare("SELECT status,checklist_id FROM appointments WHERE id=?").get(saved.id)?.checklist_id, created.id);
  await assert.rejects(createChecklist(db, owner, checklist), /dia agendado/);
});

test("Placa cadastrada reutiliza cliente, e horário fora do expediente é recusado", async () => {
  const db = fixture();
  db.prepare("INSERT INTO customers(id,tenant_id,name,phone) VALUES(?,?,?,?)").run("c", "t", "Cliente Cadastrado", "43988888888");
  db.prepare("INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year) VALUES(?,?,?,?,?,?,?)").run("v", "t", "c", input.plate, "Marca", "Modelo", 2021);
  const saved = await createAppointment(db, owner, { ...input, customer_name: "Nome digitado", phone: "000" });
  const row = db.prepare("SELECT customer_id,customer_name,phone FROM appointments WHERE id=?").get(saved.id);
  assert.equal(row?.customer_id, "c");
  assert.equal(row?.customer_name, "Cliente Cadastrado");
  assert.equal(row?.phone, "43988888888");
  await assert.rejects(createAppointment(db, owner, { ...input, starts_at: `${day}T17:30`, ends_at: `${day}T18:30` }), /horário de atendimento/);
});
