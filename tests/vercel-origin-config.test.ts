import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Vercel does not override configured application origins", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const key of ["APP_ORIGIN", "APP_ORIGINS", "PUBLIC_ORIGIN"]) {
    assert.equal(Object.hasOwn(config.env ?? {}, key), false, `${key} must come from the deployment environment`);
  }
});
