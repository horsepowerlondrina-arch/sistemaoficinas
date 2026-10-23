import { createHash } from "node:crypto";

/** Hash migration SQL with platform-independent line endings. */
export function migrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(sql.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}
