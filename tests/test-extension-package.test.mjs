import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTestExtensionFiles, writeTestExtensionPackage, TEST_APP_ORIGIN } from "../scripts/package-test-extension.mjs";

test("INT-015 package is Sky-only, isolated from the commercial extension, and staging-only", () => {
  const files = buildTestExtensionFiles();
  const byName = new Map(files.map((entry) => [entry.name, entry.content]));
  const manifest = JSON.parse(byName.get("manifest.json"));
  assert.equal(manifest.name, "Sistema Oficinas — Teste INT-015");
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(manifest.host_permissions, [TEST_APP_ORIGIN + "/*"]);
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(manifest.content_scripts.map((script) => script.matches), [
    ["https://cliente.skypecas.com.br/*"],
    [TEST_APP_ORIGIN + "/*"],
  ]);
  assert.equal("key" in manifest, false);
  assert.match(byName.get("background.js"), /const appOrigins = new Set\(\["https:\/\/sistema-oficinas-homologacao\.vercel\.app"\]\)/);
  assert.doesNotMatch(byName.get("background.js"), /horse-power\.vercel\.app|oficinahorsepower\.com\.br/);
  assert.match(byName.get("sky.js"), /S\.O\. Teste • Enviar/);
  assert.match(byName.get("sky.js"), /so-test-sky-btn/);
  assert.doesNotMatch(files.map((entry) => entry.name + entry.content).join("\n"), /tempario|HP_OPEN_TEMPARIO/i);
});

test("INT-015 package is a readable ZIP with the install guide and extension manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "int-015-"));
  try {
    const zipPath = join(directory, "sistema-oficinas-test-extension.zip");
    writeTestExtensionPackage(zipPath);
    const zip = readFileSync(zipPath);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0);
    const offset = zip.readUInt32LE(end + 16);
    const files = [];
    let cursor = offset;
    while (zip.readUInt32LE(cursor) === 0x02014b50) {
      const nameLength = zip.readUInt16LE(cursor + 28);
      const extraLength = zip.readUInt16LE(cursor + 30);
      const commentLength = zip.readUInt16LE(cursor + 32);
      files.push(zip.toString("utf8", cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    assert.ok(files.includes("manifest.json"));
    assert.ok(files.includes("LEIA-ME.txt"));
    assert.ok(files.includes("sky.js"));
    assert.ok(files.includes("background.js"));
    assert.equal(files.some((name) => /tempario/i.test(name)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
