import test from "node:test";
import assert from "node:assert/strict";
import { migrationChecksum } from "../server/db/migrationChecksum";

test("migration checksum is stable across Windows and Unix line endings", () => {
  const sql = "CREATE TABLE sample (id integer);\nINSERT INTO sample VALUES (1);\n";
  assert.equal(
    migrationChecksum(sql.replace(/\n/g, "\r\n")),
    migrationChecksum(sql),
  );
  assert.equal(
    migrationChecksum(sql.replace(/\n/g, "\r")),
    migrationChecksum(sql),
  );
  assert.notEqual(
    migrationChecksum(sql),
    migrationChecksum(sql.replace("VALUES (1)", "VALUES (2)")),
  );
});
