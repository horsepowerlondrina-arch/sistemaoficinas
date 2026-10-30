import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("docs/mapeamento-visual");
const catalog = JSON.parse(readFileSync(resolve(root, "catalog.json"), "utf8"));

test("biblioteca visual mantém IDs únicos e imagens correspondentes às capturas", () => {
  const ids = new Set<string>();
  for (const module of catalog.modules) assert.ok(module.id && module.name && module.description);
  for (const entry of catalog.entries) {
    assert.ok(!ids.has(entry.id), "ID duplicado: " + entry.id);
    ids.add(entry.id);
    assert.ok(catalog.modules.some((module: any) => module.id === entry.module), "Módulo ausente: " + entry.id);
    assert.ok(["capturada", "pendente", "bloqueada", "não aplicável"].includes(entry.status));
    if (entry.status === "capturada") {
      assert.ok(entry.image && entry.updatedAt, "Metadados de captura ausentes: " + entry.id);
      const path = resolve(entry.image);
      assert.ok(path.startsWith(resolve(root, "capturas")), "Imagem fora da biblioteca: " + entry.id);
      assert.ok(existsSync(path), "PNG ausente: " + entry.id);
      assert.equal(readFileSync(path).subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Arquivo não é PNG: " + entry.id);
    } else assert.ok(entry.reason, "Pendência sem justificativa: " + entry.id);
  }
  for (const flow of catalog.flows) for (const entryId of flow.entryIds) assert.ok(ids.has(entryId), "Interação ausente em " + flow.id + ": " + entryId);
});

test("índice, checklist e catálogo são coerentes e gerados", () => {
  const result = execFileSync(process.execPath, ["scripts/update-visual-library.mjs", "--check"], { encoding: "utf8" });
  assert.match(result, /Biblioteca íntegra/);
  for (const path of ["README.md", "INDEX.md", "CHECKLIST.md"]) assert.ok(existsSync(resolve(root, path)));
});
