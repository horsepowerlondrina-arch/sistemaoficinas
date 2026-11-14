import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  documentationOnly,
  shouldIgnore,
} from "../scripts/vercel-ignore-docs.mjs";
const require = createRequire(import.meta.url);
test("INF-010 git builds are paused without disabling manual consolidated publication", () => {
  const config = require("../vercel.json");
  assert.equal(config.git.deploymentEnabled, false);
  assert.equal(config.ignoreCommand, "node scripts/vercel-ignore-docs.mjs");
  assert.equal(config.buildCommand, "npm run build");
});
test("INF-010 skips only documentation and builds unknown or functional changes", () => {
  assert.equal(documentationOnly(["docs/report.md", "AGENTS.md"]), true);
  for (const paths of [
    [],
    ["docs/a.md", "server/app.ts"],
    ["package-lock.json"],
    ["vercel.json"],
    [".github/workflows/ci-postgres.yml"],
  ])
    assert.equal(documentationOnly(paths), false);
  assert.equal(shouldIgnore({}), false);
  assert.equal(
    shouldIgnore({ VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40) }, () => {
      throw new Error("shallow");
    }),
    false,
  );
  assert.equal(
    shouldIgnore(
      { VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40) },
      () => "docs/a.md\nREADME.md\n",
    ),
    true,
  );
});
