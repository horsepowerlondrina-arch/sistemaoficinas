import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate } from "./migrate.js";
export function createDatabase(
  path = process.env.DATABASE_PATH || resolve("data/horse-power.sqlite"),
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.function('translate',(value,from,to)=>{
    if(value===null||from===null||to===null)return null;
    const source=Array.from(String(from)),target=Array.from(String(to));
    return Array.from(String(value)).map(c=>{const i=source.indexOf(c);return i<0?c:(target[i]||'');}).join('');
  });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  migrate(db);
  return db;
}
export * from "./transactions.js";
