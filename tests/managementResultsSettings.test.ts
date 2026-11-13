import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../server/db/database.js";
import { createApp } from "../server/app.js";
import { digest } from "../server/auth/session.js";
import { getManagementResultsSettings, saveManagementResultsSettings } from "../server/services/managementResultsSettings.js";
import { saveWorkshopProfile } from "../server/services/workshopProfile.js";
import { defaultManagementResultsSettings } from "../shared/managementResultsSettings.js";
import { moduleForApiRequest, uiModuleForPath } from "../shared/workshopModules.js";

const owner = { tenantId: "a", userId: "u", role: "owner", modules: { orders: true, finance: true } };
test("configuração de Resultados fica isolada por oficina, auditada e preserva o perfil", async () => {
  const db = createDatabase(":memory:");
  try {
    db.exec("INSERT INTO tenants(id,name,profile_data) VALUES('a','A','{\"default_notes\":\"Preservar\"}'),('b','B','{}'); INSERT INTO users VALUES('u','Admin','u@example.test','disabled')");
    assert.deepEqual(await getManagementResultsSettings(db, owner), { ...defaultManagementResultsSettings, configured: false });
    const changed = { ...defaultManagementResultsSettings, hourly_rate: 18000, weekly_capacity: 60, yellow_hours: 36, green_hours: 48 };
    await saveManagementResultsSettings(db, owner, changed);
    assert.deepEqual(await getManagementResultsSettings(db, owner), { ...changed, configured: true });
    assert.deepEqual(await getManagementResultsSettings(db, { ...owner, tenantId: "b" }), { ...defaultManagementResultsSettings, configured: false });
    const profile = JSON.parse(String(db.prepare("SELECT profile_data FROM tenants WHERE id='a'").get()!.profile_data));
    assert.equal(profile.default_notes, "Preservar");
    await saveWorkshopProfile(db, owner, { name: "A atualizada" });
    assert.deepEqual(await getManagementResultsSettings(db, owner), { ...changed, configured: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE tenant_id='a' AND action='management_results.settings_updated'").get()!.n, 1);
    await assert.rejects(saveManagementResultsSettings(db, { ...owner, role: "operator" }, changed), /administrador/);
    await assert.rejects(saveManagementResultsSettings(db, owner, { ...changed, yellow_hours: 55, green_hours: 48 }), /amarelo/);
    assert.deepEqual(await getManagementResultsSettings(db, owner), { ...changed, configured: true });
  } finally { db.close(); }
});

test("Resultados pertence a Gestão e exige Financeiro e OS habilitados", () => {
  assert.equal(uiModuleForPath("/resultados"), "finance");
  assert.deepEqual(moduleForApiRequest("/management-results/settings", "GET"), ["finance", "orders"]);
});

test("API de configuração de Resultados exige sessão e administrador", async () => {
  const db = createDatabase(":memory:");
  db.exec("INSERT INTO tenants(id,name) VALUES('a','A'); INSERT INTO users VALUES('u','Admin','u@example.test','disabled'),('m','Operador','m@example.test','disabled'); INSERT INTO memberships VALUES('u','a','owner'),('m','a','operator')");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("owner-results"), "u", "a", Date.now() + 60000);
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(digest("operator-results"), "m", "a", Date.now() + 60000);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/management-results/settings`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Cookie: "hp_session=operator-results" } })).status, 403);
    assert.equal((await fetch(url, { headers: { Cookie: "hp_session=owner-results" } })).status, 200);
    const response = await fetch(url, { method: "PUT", headers: { Cookie: "hp_session=owner-results", "Content-Type": "application/json" }, body: JSON.stringify({ ...defaultManagementResultsSettings, yellow_hours: 70, green_hours: 60 }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await getManagementResultsSettings(db, owner), { ...defaultManagementResultsSettings, configured: false });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
