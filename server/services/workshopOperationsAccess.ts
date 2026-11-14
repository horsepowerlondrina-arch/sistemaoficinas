import {updateReceivableDiscount} from './payments';
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type DB } from "../db/database";
import type { Context } from "../auth/session";
import { audit, invalidateOrderShares, listOrders } from "./workshop";
import {
  assertOrderVisible,
  requirePermission,
  canDiscount,
  orderStateDigest,
  accessDenied,
} from "./userAccess";
import { calculateDiscountAmount } from "../domain/orders";

export async function staffDirectory(db: DB, ctx: Context) {
  requirePermission(ctx, "staff.view");
  return db
    .prepare(
      "SELECT p.*,s.user_id,COALESCE(s.productive,1) productive FROM professionals p LEFT JOIN staff_accounts s ON s.tenant_id=p.tenant_id AND s.professional_id=p.id WHERE p.tenant_id=? ORDER BY p.name",
    )
    .all(ctx.tenantId);
}
export async function saveStaff(
  db: DB,
  ctx: Context,
  id: string | null,
  raw: unknown,
) {
  requirePermission(ctx, "staff.manage");
  const input = z
    .object({
      name: z.string().trim().min(2).max(150),
      role: z.string().trim().min(2).max(150),
      active: z.boolean(),
      productive: z.boolean(),
      user_id: z.string().nullable(),
    })
    .strict()
    .parse(raw);
  return transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    if (
      id &&
      !(await db
        .prepare("SELECT 1 FROM professionals WHERE tenant_id=? AND id=?")
        .get(ctx.tenantId, id))
    )
      throw new Error("Funcionário não encontrado.");
    const linked=id?await db.prepare('SELECT user_id FROM staff_accounts WHERE tenant_id=? AND professional_id=?').get(ctx.tenantId,id):null;
    if(input.user_id!==(linked?.user_id||null))requirePermission(ctx,'users.manage');
    if(linked?.user_id&&input.user_id!==linked.user_id){for(const order of await db.prepare('SELECT order_id FROM order_assignments WHERE tenant_id=? AND professional_id=? AND removed_at IS NULL').all(ctx.tenantId,id))await invalidateOrderShares(db,ctx,order.order_id);}
    if (
      input.user_id &&
      !(await db
        .prepare("SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?")
        .get(ctx.tenantId, input.user_id))
    )
      throw new Error("Conta não vinculada à oficina.");
    const key = id || randomUUID();
    if (id)
      await db
        .prepare(
          "UPDATE professionals SET name=?,role=?,active=? WHERE tenant_id=? AND id=?",
        )
        .run(input.name, input.role, input.active ? 1 : 0, ctx.tenantId, key);
    else
      await db
        .prepare(
          "INSERT INTO professionals(id,tenant_id,name,role,active) VALUES(?,?,?,?,?)",
        )
        .run(key, ctx.tenantId, input.name, input.role, input.active ? 1 : 0);
    await db
      .prepare(
        "INSERT INTO staff_accounts(tenant_id,professional_id,user_id,productive) VALUES(?,?,?,?) ON CONFLICT(tenant_id,professional_id) DO UPDATE SET user_id=excluded.user_id,productive=excluded.productive",
      )
      .run(ctx.tenantId, key, input.user_id, input.productive ? 1 : 0);
    await audit(db, ctx, id ? "staff.updated" : "staff.created", key, {
      ...input,
    });
    return { id: key };
  });
}
export async function orderAssignments(db: DB, ctx: Context, order: string) {
  await assertOrderVisible(db, ctx, order);
  return db
    .prepare(
      "SELECT a.professional_id,p.name,a.assigned_at,a.removed_at FROM order_assignments a JOIN professionals p ON p.tenant_id=a.tenant_id AND p.id=a.professional_id WHERE a.tenant_id=? AND a.order_id=? ORDER BY p.name",
    )
    .all(ctx.tenantId, order);
}
export async function saveAssignments(
  db: DB,
  ctx: Context,
  order: string,
  raw: unknown,
) {
  requirePermission(ctx, "orders.assign");
  const ids = z.array(z.string().min(1)).max(100).parse(raw);
  if (new Set(ids).size !== ids.length)
    throw new Error("Funcionário duplicado.");
  return transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    await assertOrderVisible(db, ctx, order);
    const previous = await db.prepare('SELECT professional_id FROM order_assignments WHERE tenant_id=? AND order_id=? AND removed_at IS NULL').all(ctx.tenantId,order);
    for (const id of ids)
      if (!previous.some(p=>p.professional_id===id)&&(
        !(await db
          .prepare(
            "SELECT 1 FROM professionals p LEFT JOIN staff_accounts s ON s.tenant_id=p.tenant_id AND s.professional_id=p.id WHERE p.tenant_id=? AND p.id=? AND p.active=1 AND COALESCE(s.productive,1)=1",
          )
          .get(ctx.tenantId, id))
      ))
        throw new Error("Atribua somente profissionais produtivos ativos.");
    if(previous.length!==ids.length||previous.some(p=>!ids.includes(p.professional_id)))await invalidateOrderShares(db, ctx, order);
    for (const prior of previous)
      if (!ids.includes(prior.professional_id)) {
        await db
          .prepare(
            "UPDATE order_assignments SET removed_at=? WHERE tenant_id=? AND order_id=? AND professional_id=?",
          )
          .run(Date.now(), ctx.tenantId, order, prior.professional_id);
        await audit(db, ctx, "orders.assignment_removed", order, {
          professional_id: prior.professional_id,
        });
      }
    for (const id of ids)
      if (!previous.some((p) => p.professional_id === id)) {
        await db
          .prepare(
            "INSERT INTO order_assignments(tenant_id,order_id,professional_id,assigned_by,assigned_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,order_id,professional_id) DO UPDATE SET assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at,removed_at=NULL",
          )
          .run(ctx.tenantId, order, id, ctx.userId, Date.now());
        await audit(db, ctx, "orders.assignment_added", order, {
          professional_id: id,
        });
      }

    return { ok: true };
  });
}
async function discountState(db: DB, ctx: Context, id: string) {
  await assertOrderVisible(db, ctx, id);
  const order = (await listOrders(db, ctx.tenantId)).find((o) => o.id === id)!;
  if (!["quote", "open", "working", "ready", "completed"].includes(order.status))
    throw new Error("Esta situação da OS não permite solicitar desconto.");
  const subtotal = order.items.reduce(
    (sum: number, i: any) => sum + Number(i.price) * Number(i.quantity),
    0,
  );
  let receivable:any=null,editable=true;
  if(order.status==='completed'){
    requirePermission(ctx,'finance.edit');
    receivable=await db.prepare('SELECT * FROM receivables WHERE tenant_id=? AND order_id=?').get(ctx.tenantId,id);
    const paid=receivable?await db.prepare("SELECT 1 FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='paid' LIMIT 1").get(ctx.tenantId,receivable.id):null;
    const cash=receivable?await db.prepare('SELECT 1 FROM cash_entries WHERE tenant_id=? AND receivable_id=? LIMIT 1').get(ctx.tenantId,receivable.id):null;
    editable=!!receivable&&receivable.status!=='paid'&&!paid&&!cash;
    order.payment_state=receivable?[receivable.id,receivable.status,receivable.amount,receivable.plan_configured,!!paid,!!cash]:null;
  }
  return { order, subtotal, receivable,editable,digest: orderStateDigest(order) };
}
export async function requestDiscount(
  db: DB,
  ctx: Context,
  id: string,
  raw: unknown,
) {
  requirePermission(ctx, "orders.discount");
  const input = z
    .object({
      mode: z.enum(["money", "percent"]),
      value: z.number().int().min(0),
      justification: z.string().trim().min(10).max(1000),
    })
    .strict()
    .parse(raw);
  return transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    const state = await discountState(db, ctx, id);
    if(!state.editable)throw new Error('Não é possível solicitar desconto após recebimento confirmado.');
    const discount = calculateDiscountAmount(
      state.subtotal,
      input.mode,
      input.value,
    );
    const key = randomUUID();
    await db
      .prepare(
        "INSERT INTO discount_requests(id,tenant_id,order_id,requester_id,subtotal,discount,state_digest,justification,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        ctx.tenantId,
        id,
        ctx.userId,
        state.subtotal,
        discount,
        state.digest,
        input.justification,
        Date.now(),
      );
    await audit(db, ctx, "discount.requested", id, {
      request_id: key,
      subtotal: state.subtotal,
      discount,
      justification: input.justification,
    });
    return { id: key };
  });
}
export async function listDiscountRequests(db: DB, ctx: Context) {
  requirePermission(ctx, "orders.discount");
  const rows = await db
    .prepare(
      "SELECT * FROM discount_requests WHERE tenant_id=? ORDER BY created_at DESC",
    )
    .all(ctx.tenantId);
  const result = [];
  for (const row of rows) {
    if (
      !ctx.access?.permissions["orders.approve"] &&
      row.requester_id !== ctx.userId
    )
      continue;
    try {
      await assertOrderVisible(db, ctx, row.order_id);
      result.push(row);
    } catch {}
  }
  return result;
}
export async function decideDiscount(
  db: DB,
  ctx: Context,
  id: string,
  raw: unknown,
) {
  requirePermission(ctx, "orders.approve");
  const input = z
    .object({
      approve: z.boolean(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict()
    .parse(raw);
  return transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    const request = await db
      .prepare("SELECT * FROM discount_requests WHERE tenant_id=? AND id=?")
      .get(ctx.tenantId, id);
    if (!request || request.status !== "pending")
      throw new Error("Solicitação não está pendente.");
    if (request.requester_id === ctx.userId)
      accessDenied("Você não pode aprovar sua própria solicitação.");
    const state = await discountState(db, ctx, request.order_id);
    let status = input.approve ? "approved" : "rejected";
    if (
      !state.editable || state.digest !== request.state_digest ||
      state.subtotal !== Number(request.subtotal)
    )
      status = "invalidated";
    if (status === "approved") {
      if (!canDiscount(ctx, state.subtotal, Number(request.discount)))
        accessDenied("Seu limite não permite aprovar este desconto.");
      if(state.receivable)await updateReceivableDiscount(db,{...ctx,action:"orders.discount"},state.receivable.id,{mode:"money",value:Number(request.discount)});
      else await db
        .prepare(
          "UPDATE orders SET discount=?,total=? WHERE tenant_id=? AND id=?",
        )
        .run(
          request.discount,
          state.subtotal - Number(request.discount),
          ctx.tenantId,
          request.order_id,
        );
      await invalidateOrderShares(db, ctx, request.order_id);
      await db
        .prepare(
          "UPDATE discount_requests SET status='invalidated' WHERE tenant_id=? AND order_id=? AND status='pending' AND id<>?",
        )
        .run(ctx.tenantId, request.order_id, id);
    }
    await db
      .prepare(
        "UPDATE discount_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE tenant_id=? AND id=?",
      )
      .run(status, ctx.userId, Date.now(), input.reason, ctx.tenantId, id);
    await audit(db, ctx, "discount." + status, request.order_id, {
      request_id: id,
      discount: request.discount,
      reason: input.reason,
    });
    return { status };
  });
}
