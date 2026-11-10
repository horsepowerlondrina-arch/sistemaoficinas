import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { scoped, id, audit, type Row } from "./workshop.js";
export function cashToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return part("year") + "-" + part("month") + "-" + part("day");
}
export async function cashAccount(
  db: DB,
  ctx: Context,
  accountId: string | undefined,
  day: string,
  scheduled = false,
  allowNoActiveAccount = false,
) {
  if (!accountId) {
    const existing = await db
      .prepare(allowNoActiveAccount
        ? "SELECT COUNT(*) n FROM cash_accounts WHERE tenant_id=? AND active=1"
        : "SELECT COUNT(*) n FROM cash_accounts WHERE tenant_id=?")
      .get(ctx.tenantId);
    if (Number(existing?.n))
      throw new Error(
        "Selecione a conta bancária ou o caixa físico deste movimento.",
      );
    return null;
  }
  const account = await scoped(db, "cash_accounts", ctx.tenantId, accountId);
  if (!account.active)
    throw new Error("Esta conta está pausada. Escolha uma conta ativa.");
  if (day < account.opening_on || (!scheduled && day > cashToday()))
    throw new Error(
      "A data deve estar entre o início do controle da conta e hoje.",
    );
  return account;
}
export async function recordCash(
  db: DB,
  ctx: Context,
  account: Row | null,
  movement: Row,
) {
  if (!account) return;
  await db
    .prepare(
      "INSERT INTO cash_movements(id,tenant_id,account_id,day,amount,gross_amount,fee_amount,description,method,origin,source_id,source_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id(),
      ctx.tenantId,
      account.id,
      movement.day,
      movement.amount,
      movement.gross_amount || 0,
      movement.fee_amount || 0,
      movement.description,
      movement.method || "",
      movement.origin,
      movement.source_id,
      movement.source_payload || "",
    );
}
export async function cashControl(db: DB, ctx: Context) {
  requireAdmin(ctx);
  const accounts = await db
    .prepare(
      "SELECT a.*,a.opening_balance+COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.day<=?),0) balance,COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.tenant_id=a.tenant_id AND m.account_id=a.id AND m.day>?),0) pending_receipts FROM cash_accounts a WHERE a.tenant_id=? ORDER BY a.kind,a.name",
    )
    .all(cashToday(), cashToday(), ctx.tenantId);
  const movements = await db
    .prepare(
      "SELECT m.*,a.name account_name FROM cash_movements m JOIN cash_accounts a ON a.id=m.account_id AND a.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.day,m.created_at,m.id",
    )
    .all(ctx.tenantId);
  const legacy = await db
    .prepare(
      "SELECT COUNT(*) n FROM cash_entries c WHERE c.tenant_id=? AND NOT EXISTS(SELECT 1 FROM cash_movements m WHERE m.tenant_id=c.tenant_id AND m.origin='receipt' AND m.source_id=c.installment_id)",
    )
    .get(ctx.tenantId);
  const legacyExpenses = await db
    .prepare(
      "SELECT COUNT(*) n FROM payables p WHERE p.tenant_id=? AND p.status='paid' AND NOT EXISTS(SELECT 1 FROM cash_movements m WHERE m.tenant_id=p.tenant_id AND m.origin='expense' AND m.source_id=p.id)",
    )
    .get(ctx.tenantId);
  return {
    accounts,
    movements,
    legacy_count: Number(legacy?.n || 0) + Number(legacyExpenses?.n || 0),
  };
}
export async function saveCashAccount(
  db: DB,
  ctx: Context,
  v: Row,
  record?: string,
) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    if (v.opening_on > cashToday())
      throw new Error("O início do controle não pode ser futuro.");
    if (!record && v.request_id) {
      const repeated = await db
        .prepare("SELECT * FROM cash_accounts WHERE tenant_id=? AND id=?")
        .get(ctx.tenantId, v.request_id);
      if (repeated) {
        if (
          !["name", "kind", "opening_balance", "opening_on", "active"].every(
            (key) => repeated[key] === v[key],
          )
        )
          throw new Error(
            "Este pedido já cadastrou outra conta. Confira o caixa antes de repetir.",
          );
        return { id: repeated.id };
      }
    }
    const old = record
      ? await scoped(db, "cash_accounts", ctx.tenantId, record)
      : null;
    if (
      old &&
      (old.opening_balance !== v.opening_balance ||
        old.opening_on !== v.opening_on) &&
      (await db
        .prepare(
          "SELECT 1 FROM cash_movements WHERE tenant_id=? AND account_id=?",
        )
        .get(ctx.tenantId, record))
    )
      throw new Error(
        "Esta conta já tem movimentos. Use Ajustar saldo para registrar uma correção no histórico.",
      );
    const accountId = record || v.request_id || id();
    if (old)
      await db
        .prepare(
          "UPDATE cash_accounts SET name=?,kind=?,opening_balance=?,opening_on=?,active=? WHERE tenant_id=? AND id=?",
        )
        .run(
          v.name,
          v.kind,
          v.opening_balance,
          v.opening_on,
          v.active,
          ctx.tenantId,
          accountId,
        );
    else
      await db
        .prepare(
          "INSERT INTO cash_accounts(id,tenant_id,name,kind,opening_balance,opening_on,active) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          accountId,
          ctx.tenantId,
          v.name,
          v.kind,
          v.opening_balance,
          v.opening_on,
          v.active,
        );
    await audit(
      db,
      ctx,
      old ? "cash_account.updated" : "cash_account.created",
      accountId,
    );
    return { id: accountId };
  });
}
export async function adjustCash(db: DB, ctx: Context, v: Row) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    const payload = JSON.stringify({
      account_id: v.account_id,
      target_balance: v.target_balance,
      reason: v.reason,
    });
    const prior = await db
      .prepare(
        "SELECT * FROM cash_movements WHERE tenant_id=? AND origin='adjustment' AND source_id=?",
      )
      .get(ctx.tenantId, v.request_id);
    if (prior) {
      if (prior.source_payload !== payload)
        throw new Error("Este pedido já foi usado para outro ajuste.");
      return { id: prior.id };
    }
    const day = cashToday(),
      account = await cashAccount(db, ctx, v.account_id, day);
    if (!account) throw new Error("Selecione a conta para ajustar.");
    const total = await db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) total FROM cash_movements WHERE tenant_id=? AND account_id=? AND day<=?",
      )
      .get(ctx.tenantId, account.id, day);
    const amount =
      v.target_balance -
      Number(account.opening_balance) -
      Number(total?.total || 0);
    if (!amount)
      throw new Error("O saldo informado já é igual ao saldo atual.");
    await recordCash(db, ctx, account, {
      day,
      amount,
      origin: "adjustment",
      source_id: v.request_id,
      source_payload: payload,
      description: "Ajuste de saldo: " + v.reason,
      method: "Ajuste",
    });
    await audit(db, ctx, "cash.adjusted", v.request_id);
    return { ok: true };
  });
}
