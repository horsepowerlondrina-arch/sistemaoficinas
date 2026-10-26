import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readPorteCounts, sourceSha256 } from "../scripts/catalog-import";
import { estimateCatalogImportPeak, matchesCategoryCounts } from "../scripts/catalog-import";

test("CAT-008 treats an absent zero-count category as zero", () => {
  const expected = {
    compacto: 2161,
    medio: 2794,
    premium: 2579,
    pesado: 0,
  };
  const groupedCounts = { compacto: 2161, medio: 2794, premium: 2579 };

  assert.equal(matchesCategoryCounts(groupedCounts, expected), true);
  assert.equal(
    matchesCategoryCounts({ ...groupedCounts, pesado: 1 }, expected),
    false,
  );
  assert.equal(
    matchesCategoryCounts(
      { compacto: 2161, medio: 2794, premium: 2578 },
      expected,
    ),
    false,
  );
});

test("fonte convertida exige quatro nomes únicos e vínculo direto em cada modelo", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE classifications(id TEXT,name TEXT); CREATE TABLE models(id TEXT,classification_id TEXT); INSERT INTO classifications VALUES('1','Compacto'),('2','Médio'),('3','Premium'),('4','Pesado'); INSERT INTO models VALUES('a','1'),('b','2'),('c','3');");
    assert.deepEqual(readPorteCounts(db), { compacto: 1, medio: 1, premium: 1, pesado: 0 });
    db.exec("UPDATE models SET classification_id='missing' WHERE id='a'");
    assert.throws(() => readPorteCounts(db), /sem porte/);
    db.exec("UPDATE models SET classification_id='1' WHERE id='a'; UPDATE classifications SET name='SUV Médio' WHERE id='2'");
    assert.throws(() => readPorteCounts(db), /inválido/);
    db.exec("UPDATE classifications SET name='Compacto' WHERE id='2'");
    assert.throws(() => readPorteCounts(db), /duplicado/);
    db.exec("INSERT INTO classifications VALUES('5','Legado')");
    assert.throws(() => readPorteCounts(db), /quatro portes/);
  } finally { db.close(); }
  assert.throws(() => sourceSha256({}), /SHA256/);
  assert.equal(sourceSha256({ CATALOG_SOURCE_SHA256: "A".repeat(64) }), "a".repeat(64));
});

test("CAT-008 estimates a single catalog copy within the storage budget", () => {
  const sourceBytes = 294_141_952;
  const projected = estimateCatalogImportPeak(20_000_000, sourceBytes);
  assert.equal(projected, 431_798_733);
  assert.ok(projected < 450 * 1024 * 1024);
  assert.ok(
    estimateCatalogImportPeak(100_000_000, sourceBytes) >
      450 * 1024 * 1024,
  );
});

