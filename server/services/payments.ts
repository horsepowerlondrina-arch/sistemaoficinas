import { resolveCardPayments } from "./cardMachines.js";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { calculatePaymentPlan, type PaymentInput, type MixedPaymentInput } from "../domain/payments.js";
import { calculateDiscountAmount } from "../domain/orders.js";
import { id, scoped, audit, invalidateOrderShares } from "./workshop.js";
import { cashAccount, cashToday, recordCash } from "./cashControl.js";
import { nextBankingDay } from "../../shared/bankingDays.js";
export function requireAdmin(ctx: Context) {
  if (ctx.role !== "owner")
    throw Object.assign(new Error("Esta ação é exclusiva do administrador."), {
      status: 403,
    });
}
export type ReceiptDiscountInput = { mode: "money" | "percent"; value: number };

async function receiptDiscountState(
  db: DB,
  ctx: Context,
  record: string,
  input: ReceiptDiscountInput,
) {
  const receivable = await scoped(db, "receivables", ctx.tenantId, record);
  const order = await scoped(db, "orders", ctx.tenantId, String(receivable.order_id));
  if (order.status !== "completed")
    throw new Error("O desconto só pode ser ajustado na tela de recebimento de uma OS finalizada.");
  const row = await db
    .prepare("SELECT COALESCE(SUM(quantity * price), 0) subtotal FROM order_items WHERE tenant_id=? AND order_id=?")
    .get(ctx.tenantId, order.id);
  const subtotal = Number(row?.subtotal || 0);
  if (!Number.isSafeInteger(subtotal) || subtotal !== Number(order.total) + Number(order.discount || 0))
    throw new Error("Os itens e o total da OS estão inconsistentes. Revise o atendimento antes de aplicar o desconto.");
  const discount = calculateDiscountAmount(subtotal, input.mode, input.value);
  return {
    receivable,
    order,
    subtotal,
    discount,
    total: subtotal - discount,
  };
}

export async function previewReceivableDiscount(
  db: DB,
  ctx: Context,
  record: string,
  input: ReceiptDiscountInput,
) {
  requireAdmin(ctx);
  const state = await receiptDiscountState(db, ctx, record, input);
  return { subtotal: state.subtotal, discount: state.discount, total: state.total };
}

async function persistReceivableDiscount(
  db: DB,
  ctx: Context,
  record: string,
  input: ReceiptDiscountInput,
) {
    const state = await receiptDiscountState(db, ctx, record, input);
    const { receivable, order, subtotal, discount, total } = state;
    const previousDiscount = Number(order.discount || 0);
    if (discount === previousDiscount && total === Number(order.total))
      return { changed: false, subtotal, discount, total };

    const paidInstallment = await db
      .prepare("SELECT 1 yes FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='paid' LIMIT 1")
      .get(ctx.tenantId, record);
    const cashEntry = await db
      .prepare("SELECT 1 yes FROM cash_entries WHERE tenant_id=? AND receivable_id=? LIMIT 1")
      .get(ctx.tenantId, record);
    if (receivable.status === "paid" || paidInstallment || cashEntry)
      throw new Error("O desconto não pode ser alterado após um recebimento confirmado. Os valores já recebidos foram preservados.");

    const hadPaymentPlan = !!Number(receivable.plan_configured || 0) || !!(await db
      .prepare("SELECT 1 yes FROM payment_installments WHERE tenant_id=? AND receivable_id=? LIMIT 1")
      .get(ctx.tenantId, record));
    if (hadPaymentPlan) {
      await db
        .prepare("DELETE FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open'")
        .run(ctx.tenantId, record);
    }
    await db
      .prepare("UPDATE orders SET discount=?,total=? WHERE tenant_id=? AND id=?")
      .run(discount, total, ctx.tenantId, order.id);
    await db
      .prepare("UPDATE receivables SET amount=?,status='open',paid_at=NULL,plan_configured=0,installment_count=1,card_fee_bps=0,interest_bps=0,gross_total=?,fee_total=0,net_total=?,method='',card_sale_on='' WHERE tenant_id=? AND id=?")
      .run(total, total, total, ctx.tenantId, record);
    if (discount !== previousDiscount || total !== Number(order.total))
      await invalidateOrderShares(db, ctx, String(order.id));
    await audit(db, ctx, "payment.discount_updated", String(order.id), {
      mode: input.mode,
      value: input.value,
      previous_discount: previousDiscount,
      discount,
      previous_total: Number(order.total),
      total,
      payment_plan_reset: hadPaymentPlan,
    });
    return { changed: true, subtotal, discount, total, payment_plan_reset: hadPaymentPlan };
}

export async function updateReceivableDiscount(
  db: DB,
  ctx: Context,
  record: string,
  input: ReceiptDiscountInput,
) {
  requireAdmin(ctx);
  return transaction(db, () => persistReceivableDiscount(db, ctx, record, input));
}

export async function configurePlan(
  db: DB,
  ctx: Context,
  record: string,
  input: PaymentInput | MixedPaymentInput,
  discount?: ReceiptDiscountInput,
) {
  requireAdmin(ctx);
  return await transaction(db, async () => {
    if (discount) await persistReceivableDiscount(db, ctx, record, discount);
    const r = await scoped(db, "receivables", ctx.tenantId, record);
    if (
      r.status === "paid" ||
      (await db
        .prepare(
          "SELECT 1 FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='paid'",
        )
        .get(ctx.tenantId, record))
    )
      throw new Error("O plano não pode mudar após um recebimento.");
    const plan = calculatePaymentPlan(r.amount, await resolveCardPayments(db, ctx, input));
    const credit = plan.plans.find(p=>p.method==='Cartão de crédito');
    const saleOn = credit ? credit.input.sale_on || cashToday() : '';
    const method = plan.plans.length>1 ? 'Misto' : plan.plans[0].method;
    const single = plan.plans[0].input;
    if (saleOn) {
      nextBankingDay(saleOn);
      if (saleOn > cashToday())
        throw new Error("A data da venda não pode ser futura.");
    }
    await db
      .prepare(
        "DELETE FROM payment_installments WHERE tenant_id=? AND receivable_id=?",
      )
      .run(ctx.tenantId, record);
    for (const part of plan.installments)
      await db
        .prepare(
          "INSERT INTO payment_installments(id,tenant_id,receivable_id,sequence,due_on,principal,interest,gross,fee,net,method,machine_id,machine_name,machine_operator,card_fee_bps,pass_card_fee,installment_count,interest_bps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          ctx.tenantId,
          record,
          part.sequence,
          part.due_on,
          part.principal,
          part.interest,
          part.gross,
          part.fee,
          part.net,
          part.method,
          part.machine_id || null,
          part.machine_name || "",
          part.machine_operator || "",
          part.card_fee_bps,
          Number(part.pass_card_fee),
          part.installment_count,
          part.interest_bps,
        );
    await db
      .prepare(
        "UPDATE receivables SET plan_configured=1,installment_count=?,card_fee_bps=?,interest_bps=?,gross_total=?,fee_total=?,net_total=?,method=?,due_on=?,card_sale_on=? WHERE tenant_id=? AND id=?",
      )
      .run(
        plan.installments.length,
        plan.plans.length>1 ? 0 : single.card_fee_bps,
        plan.plans.length>1 ? 0 : single.interest_bps,
        plan.gross,
        plan.fee,
        plan.net,
        method,
        plan.plans.map(p=>p.method==='Cartão de crédito' ? nextBankingDay(saleOn) : p.input.first_due_on).sort()[0],
        saleOn,
        ctx.tenantId,
        record,
      );
    await audit(db, ctx, "payment.plan_configured", record);
    return plan;
  });
}
export async function settleInstallment(
  db: DB,
  ctx: Context,
  record: string,
  accountId?: string,
) {
  requireAdmin(ctx);
  return await transaction(db, async () => {
    const part = await scoped(db, "payment_installments", ctx.tenantId, record);
    if (part.method === "Cartão de crédito")
      return settleCredit(db, ctx, String(part.receivable_id), accountId);
    if (part.status !== "open")
      throw new Error("Esta parcela já foi recebida.");
    const now = new Date().toISOString();
    const day = cashToday(),
      account = await cashAccount(db, ctx, accountId, day);
    await db
      .prepare(
        "UPDATE payment_installments SET status='paid',paid_at=? WHERE tenant_id=? AND id=?",
      )
      .run(now, ctx.tenantId, record);
    await db
      .prepare(
        "INSERT INTO cash_entries(id,tenant_id,receivable_id,installment_id,amount,gross_amount,fee_amount,method) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id(),
        ctx.tenantId,
        part.receivable_id,
        record,
        part.net,
        part.gross,
        part.fee,
        part.method,
      );
    const pending = (await db
      .prepare(
        "SELECT COUNT(*) n FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open'",
      )
      .get(ctx.tenantId, part.receivable_id))!.n;
    await db
      .prepare(
        "UPDATE receivables SET status=?,paid_at=? WHERE tenant_id=? AND id=?",
      )
      .run(
        pending ? "open" : "paid",
        pending ? null : now,
        ctx.tenantId,
        part.receivable_id,
      );
    if (pending)
    {
      const receivable = await scoped(db,"receivables",ctx.tenantId,String(part.receivable_id));
      await db
        .prepare(
          "UPDATE receivables SET due_on=(SELECT MIN(CASE WHEN method='Cartão de crédito' THEN ? ELSE due_on END) FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open') WHERE tenant_id=? AND id=?",
        )
        .run(
          nextBankingDay(String(receivable.card_sale_on || cashToday())),
          ctx.tenantId,
          part.receivable_id,
          ctx.tenantId,
          part.receivable_id,
        );
    }
    const order = await db
      .prepare(
        "SELECT o.number FROM orders o JOIN receivables r ON r.order_id=o.id AND r.tenant_id=o.tenant_id WHERE r.tenant_id=? AND r.id=?",
      )
      .get(ctx.tenantId, part.receivable_id);
    await recordCash(db, ctx, account, {
      day,
      amount: part.net,
      gross_amount: part.gross,
      fee_amount: part.fee,
      description:
        "Recebimento OS #" + order?.number + " · parcela " + part.sequence,
      method: part.method,
      origin: "receipt",
      source_id: record,
    });
    await audit(db, ctx, "payment.installment_paid", record);
  });
}

export async function settleCredit(
  db: DB,
  ctx: Context,
  record: string,
  accountId?: string,
  saleOn?: string,
) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    const receivable = await scoped(db, "receivables", ctx.tenantId, record);
    if (
      !["Cartão de crédito", "Misto"].includes(receivable.method) ||
      !receivable.plan_configured
    )
      throw new Error(
        "Configure o pagamento no cartão de crédito antes de receber.",
      );
    const parts = await db
      .prepare(
        "SELECT * FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND method='Cartão de crédito' AND status='open' ORDER BY sequence",
      )
      .all(ctx.tenantId, record);
    if (!parts.length || receivable.status === "paid")
      throw new Error("Este cartão já foi recebido.");
    const sale = String(receivable.card_sale_on || saleOn || cashToday());
    const day = nextBankingDay(sale);
    if (sale > cashToday())
      throw new Error("A data da venda não pode ser futura.");
    const account = await cashAccount(db, ctx, accountId, day, true);
    const totals = parts.reduce(
      (v, p) => ({
        net: v.net + Number(p.net),
        gross: v.gross + Number(p.gross),
        fee: v.fee + Number(p.fee),
      }),
      { net: 0, gross: 0, fee: 0 },
    );
    const paidAt = day + "T12:00:00-03:00";
    await db
      .prepare(
        "UPDATE payment_installments SET status='paid',paid_at=? WHERE tenant_id=? AND receivable_id=? AND method='Cartão de crédito' AND status='open'",
      )
      .run(paidAt, ctx.tenantId, record);
    // One settlement represents the remaining card total; the installments remain visible.
    const first = String(parts[0].id);
    await db
      .prepare(
        "INSERT INTO cash_entries(id,tenant_id,receivable_id,installment_id,amount,gross_amount,fee_amount,method,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id(),
        ctx.tenantId,
        record,
        first,
        totals.net,
        totals.gross,
        totals.fee,
        "Cartão de crédito",
        paidAt,
      );
    const pending = await db.prepare("SELECT MIN(due_on) due_on,COUNT(*) n FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open'").get(ctx.tenantId,record);
    await db
      .prepare(
        "UPDATE receivables SET status=?,paid_at=?,due_on=?,card_sale_on=? WHERE tenant_id=? AND id=?",
      )
      .run(pending!.n ? 'open' : 'paid', pending!.n ? null : paidAt, pending!.n ? pending!.due_on : day, sale, ctx.tenantId, record);
    const order = await db
      .prepare("SELECT number FROM orders WHERE tenant_id=? AND id=?")
      .get(ctx.tenantId, receivable.order_id);
    await recordCash(db, ctx, account, {
      day,
      amount: totals.net,
      gross_amount: totals.gross,
      fee_amount: totals.fee,
      description:
        "Recebimento OS #" +
        order?.number +
        " · cartão de crédito (" +
        parts.length +
        " parcelas)",
      method: "Cartão de crédito",
      origin: "receipt",
      source_id: first,
    });
    await audit(db, ctx, "payment.credit_received", record);
    return { ok: true, settlement_on: day, net: totals.net };
  });
}

