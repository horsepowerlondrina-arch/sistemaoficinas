import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
import { createLocalDatabase } from "./db/local.js";
import { createApp } from "./app.js";
// SQLite remains available only to legacy unit tests/tools, never this entry point.
const db = await createLocalDatabase();
const server = createApp(db).listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
  console.log("Horse Power local (PostgreSQL) disponível em http://127.0.0.1:3001"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => { void db.close().then(() => process.exit(0)); }));
