import test from "node:test";
import assert from "node:assert/strict";
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
