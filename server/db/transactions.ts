import { AsyncLocalStorage } from "node:async_hooks";
export type Row = Record<string, any>;
export type MaybePromise<T> = T | Promise<T>;
export interface DB {
  hasUserAccessSchema?():Promise<boolean>;
  recordAccessAttempt?(key:string):Promise<boolean>;
  setRequestIdentity?(tenantId: string | null, userId?: string | null, publicShareHash?: string | null): Promise<void>;
  withRequestContext?<T>(
    settings: Record<string, string>,
    callback: () => Promise<T>,
    shouldCommit?: () => boolean,
  ): Promise<T>;
  withTenantRead?<T>(tenant: string, callback: () => Promise<T>): Promise<T>;
  withTenantServiceRead?<T>(tenant: string, callback: () => Promise<T>): Promise<T>;
  getTenantAccessState?(tenant: string): Promise<string>;
  getTenantModuleAccess?(tenant: string): Promise<Record<string, boolean>>;
  getTenantCatalogIncluded?(tenant: string): Promise<boolean>;
  getTenantPlanSummary?(tenant: string): Promise<{plan_code:string|null;status:string|null;trial_ends_at:string|null}|null>;
  lockTenantMutations?(tenant: string): Promise<void>;
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
