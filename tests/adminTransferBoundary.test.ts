import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("full .hptx transfer routes are no longer exposed by workshop operational API", () => {
  const source = readFileSync(new URL("../server/app.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /app\.(?:get|post)\(["']\/api\/data-transfer\//);
  assert.match(source, /platformAdminApp\)\s*app\.use\("\/api", platformAdminApp\)/);
});
test("workshop settings no longer expose the complete transfer tab", () => {
  const source = readFileSync(new URL("../src/pages/Management.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /components\/DataTransfer/);
  assert.doesNotMatch(source, /Transferência de dados/);
});

test("the local PostgreSQL migration allows the transfer permission without granting it to accounts", () => {
  const sql = readFileSync(new URL("../local-postgres/015-platform-admin-data-transfer.sql", import.meta.url), "utf8");
  assert.match(sql, /data-transfer:manage/);
  assert.doesNotMatch(sql, /UPDATE\s+platform_admin\.administrators/i);
});
