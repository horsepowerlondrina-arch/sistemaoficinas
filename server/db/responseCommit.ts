import type { NextFunction, Response } from "express";
import type { DB } from "./database.js";

// JSON/buffer responses must not advertise success before PostgreSQL commits.
export function respondAfterCommit(
  db: DB,
  settings: Record<string, string>,
  res: Response,
  next: NextFunction,
) {
  if (!db.withRequestContext) { next(); return; }
  const originalEnd = res.end;
  let pendingEnd: Parameters<Response["end"]> | undefined;
  let complete!: () => void;
  const finished = new Promise<void>(resolve => { complete = resolve; });
  const closed = () => complete();
  res.once("close", closed);
  res.end = function (this: Response, ...args: Parameters<Response["end"]>) {
    if (!pendingEnd) { pendingEnd = args; complete(); }
    return this;
  } as Response["end"];
  void db.withRequestContext(
    settings,
    async () => { next(); await finished; },
    () => !!pendingEnd && !res.destroyed && res.statusCode < 400,
  ).then(() => {
    res.end = originalEnd;
    res.removeListener("close", closed);
    if (pendingEnd && !res.destroyed) originalEnd.apply(res, pendingEnd);
  }).catch(() => {
    res.end = originalEnd;
    res.removeListener("close", closed);
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    // A failed commit must not deliver the success body or a new session cookie.
    res.removeHeader("Set-Cookie");
    res.removeHeader("Content-Length");
    next(Object.assign(new Error("Não foi possível concluir a operação. Tente novamente."), { status: 500 }));
  });
}
