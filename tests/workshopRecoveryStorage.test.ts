import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { configuredRecoveryStore, readRecoveryBackup, uploadRecoveryBackup, verifyRecoveredWorkshop, type RecoveryObjectStore } from "../server/services/workshopRecoveryStorage.js";
import { createTransferPayload, sealTransferPackage } from "../shared/transferPackage.js";

function memoryStore() {
  const objects = new Map<string, Buffer>();
  const store: RecoveryObjectStore = {
    async put(key, content) { if (objects.has(key)) throw new Error("Duplicado."); objects.set(key, Buffer.from(content)); },
    async get(key) { const value = objects.get(key); if (!value) throw new Error("Ausente."); return Buffer.from(value); },
    async remove(keys) { for (const key of keys) objects.delete(key); },
  };
  return { store, objects };
}

test("backup de várias partes é recuperável com conteúdo e hash idênticos", async () => {
  const { store, objects } = memoryStore();
  const tenant = randomUUID(), backup = randomUUID();
  const archive = Buffer.alloc(4_100_000, 42);
  const manifest = await uploadRecoveryBackup(store, tenant, backup, archive);
  assert.equal(manifest.chunks.length, 2);
  assert.deepEqual(await readRecoveryBackup(store, manifest), archive);
  assert.equal(objects.size, 2);
  assert.ok(manifest.chunks.every(part => part.key.startsWith(`${tenant}/${backup}/`)));
});

test("cópia corrompida impede recuperação e não pode autorizar exclusão", async () => {
  const { store, objects } = memoryStore();
  const manifest = await uploadRecoveryBackup(store, randomUUID(), randomUUID(), Buffer.from("pacote criptografado fictício"));
  objects.set(manifest.chunks[0].key, Buffer.from("pacote alterado"));
  await assert.rejects(readRecoveryBackup(store, manifest), /Integridade/);
});

test("falha de gravação ou leitura remove partes temporárias e interrompe o processo", async () => {
  const { store, objects } = memoryStore();
  const failing: RecoveryObjectStore = { ...store, async get() { throw new Error("Storage indisponível."); } };
  await assert.rejects(uploadRecoveryBackup(failing, randomUUID(), randomUUID(), Buffer.from("dados fictícios")));
  assert.equal(objects.size, 0);
});

test("identificadores inválidos são recusados antes de tocar no armazenamento", async () => {
  const { store, objects } = memoryStore();
  await assert.rejects(uploadRecoveryBackup(store, "outra-oficina", randomUUID(), Buffer.from("x")));
  assert.equal(objects.size, 0);
});

test("a cópia de recuperação aceita apenas o Storage da homologação com credencial de servidor", () => {
  const config = {
    CHECKLIST_STORAGE_ENABLED: "true",
    CHECKLIST_STORAGE_URL: "https://vnclahdnirqlcbamodqy.supabase.co/",
    CHECKLIST_STORAGE_SECRET: "segredo-ficticio",
  };
  assert.ok(configuredRecoveryStore(config));
  assert.throws(() => configuredRecoveryStore({ ...config, APP_ENV: "horse_power" }), /não configurado/);
  assert.throws(() => configuredRecoveryStore({ ...config, CHECKLIST_STORAGE_URL: "https://rvlovjpquozbrsszsxwe.supabase.co/" }), /não configurado/);
  assert.throws(() => configuredRecoveryStore({ ...config, CHECKLIST_STORAGE_SECRET: "" }), /não configurado/);
});

test("a restauração autenticada confere oficina e inventário do pacote", async () => {
  const { store } = memoryStore();
  const tenant = randomUUID();
  const passphrase = "frase ficticia longa para teste";
  const payload=createTransferPayload("sistemaoficinas", { id: tenant, name: "Oficina Fictícia" }, {
    tenant: { id: tenant, name: "Oficina Fictícia" }, users: [], memberships: [], customers: [{ id: randomUUID(), tenant_id: tenant, name: "Cliente Teste" }],
  });
  const tables={workshop_user_access:[],staff_accounts:[],order_assignments:[],discount_requests:[],support_tickets:[],support_messages:[],memberships:[],users:[]};
  const recovery={version:1,tenantId:tenant,tables,sha256:createHash('sha256').update(JSON.stringify(tables)).digest('hex')};
  const archive=sealTransferPackage(Object.assign(payload,{recovery}),passphrase);
  const manifest = await uploadRecoveryBackup(store, tenant, randomUUID(), archive);
  const restored = await readRecoveryBackup(store, manifest);
  assert.equal(verifyRecoveredWorkshop(manifest, restored, passphrase).entities.customers?.count, 1);
  await assert.rejects(async () => verifyRecoveredWorkshop({ ...manifest, tenantId: randomUUID() }, restored, passphrase), /outra oficina/);
  await assert.rejects(async () => verifyRecoveredWorkshop(manifest, restored, "frase diferente"), /frase|pacote|integridade/i);
});
