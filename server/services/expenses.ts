import { type DB, transaction } from "../db/transactions.js";
import { type Context } from "../auth/session.js";
import { audit, id, scoped } from "./workshop.js";
import { requireAdmin } from "./payments.js";
import { cashAccount, recordCash } from "./cashControl.js";
export async function generateExpenses(db: DB, ctx: Context, month: string) {
  requireAdmin(ctx);
  return await transaction(db, async () => {
    let created = 0;
    const templates = await db
      .prepare(
        "SELECT * FROM expense_templates WHERE tenant_id=? AND active=1 AND deleted_at IS NULL",
      )
      .all(ctx.tenantId);
    for (const t of templates) {
      if (t.amount === null || Number(t.amount) <= 0) continue;
      if (!t.start_month)
        await db
          .prepare(
            "UPDATE expense_templates SET start_month=? WHERE id=? AND tenant_id=?",
          )
          .run(month, t.id, ctx.tenantId);
      const start = String(t.start_month || month);
      const diff =
        (Number(month.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
        Number(month.slice(5)) -
        Number(start.slice(5));
      if (
        diff < 0 ||
        (t.remaining_months !== null && diff >= Number(t.remaining_months))
      )
        continue;
      const last = new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5)),
        0,
      ).getDate();
      const due =
        month +
        "-" +
        String(Math.min(Number(t.due_day), last)).padStart(2, "0");
      const result = await db
        .prepare(
          "INSERT OR IGNORE INTO payables(id,tenant_id,template_id,description,category,amount,due_on,notes,supplier) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          ctx.tenantId,
          t.id,
          String(t.description) +
            (t.remaining_months
              ? ` · parcela ${diff + 1}/${t.remaining_months}`
              : ""),
          t.category,
          t.amount,
          due,
          t.source,
          t.supplier || "",
        );
      created += Number(result.changes);
    }
    await audit(db, ctx, "expenses.generated", month);
    return { created };
  });
}
export async function payExpense(
  db: DB,
  ctx: Context,
  record: string,
  paidOn: string,
  method: string,
  accountId?: string,
) {
  requireAdmin(ctx);
  return await transaction(db, async () => {
    const p = await scoped(db, "payables", ctx.tenantId, record);
    if (p.status !== "open") throw new Error("Esta conta não está em aberto.");
    const account = await cashAccount(db, ctx, accountId, paidOn);
    await db
      .prepare(
        "UPDATE payables SET status='paid',paid_on=?,method=? WHERE tenant_id=? AND id=?",
      )
      .run(paidOn, method, ctx.tenantId, record);
    await recordCash(db, ctx, account, {
      day: paidOn,
      amount: -p.amount,
      description: p.description,
      method,
      origin: "expense",
      source_id: record,
    });
    await audit(db, ctx, "expense.paid", record);
  });
}
