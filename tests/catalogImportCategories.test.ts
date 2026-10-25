import test from "node:test";
import assert from "node:assert/strict";
import { matchesCategoryCounts } from "../scripts/catalog-import";

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
