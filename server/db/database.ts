import { AsyncLocalStorage } from "node:async_hooks";
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
export type Row = Record<string, any>;
export type MaybePromise<T> = T | Promise<T>;
export interface DB {
  withTenantRead?<T>(tenant: string, callback: () => Promise<T>): Promise<T>;
  getTenantAccessState?(tenant: string): Promise<string>;
  prepare(sql: string): {
    get(...values: any[]): MaybePromise<Row | undefined>;
    all(...values: any[]): MaybePromise<Row[]>;
    run(...values: any[]): MaybePromise<{ changes: number | bigint }>;
  };
  exec(sql: string): MaybePromise<void>;
}
export interface TransactionalDB extends DB {
  transaction<T>(callback: () => Promise<T>): Promise<T>;
}
const localTransactions = new AsyncLocalStorage<DB>();
const localQueues = new WeakMap<DB, Promise<void>>();
export async function transaction<T>(
  db: DB,
  callback: () => T | Promise<T>,
): Promise<T> {
  if ("transaction" in db)
    return (db as TransactionalDB).transaction(async () => callback());
  if (localTransactions.getStore() === db) return callback();
  const previous = localQueues.get(db) || Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  localQueues.set(
    db,
    previous.then(() => pending),
  );
  await previous;
  try {
    await db.exec("BEGIN IMMEDIATE");
    try {
      const result = await localTransactions.run(db, callback);
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    release();
  }
}
