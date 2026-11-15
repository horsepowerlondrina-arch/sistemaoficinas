import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readRecoveryBackup, uploadRecoveryBackup, type RecoveryObjectStore } from "../server/services/workshopRecoveryStorage.js";

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
