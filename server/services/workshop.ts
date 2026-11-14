import {requirePermission,assertOrderVisible,canDiscount} from './userAccess';
import { productLabel } from "../../shared/productIdentity.js";
import { basicOrderReceiptMethods, type BasicOrderReceiptMethod } from "../../shared/basicOrderReceipt.js";
import { resolveService, identifyVehicleModel, confirmVehicleModel, catalogAccessState } from './repairCatalog.js';
import {
  normalizeCustomerName,
  customerPhoneDigits,
  validNewCustomerPhone,
} from "../../shared/customerIdentity.js";
import { randomUUID } from "node:crypto";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { assertTransition, totalOf, type Status } from "../domain/orders.js";
import {
  configurePlan,
  configureBasicOrderPlan,
  settleInstallment,
  settleCredit,
  requireAdmin,
} from "./payments.js";
import { cashToday } from "./cashControl.js";
export const id = () => randomUUID();
async function hasOwnerTransfer(db: DB, tenant: string, vehicle: string, customer: string) {
  const transfers = await db.prepare("SELECT action FROM audit_events WHERE tenant_id=? AND entity_id=? AND action LIKE 'vehicles.owner_changed:%'").all(tenant,vehicle);
  return transfers.some(row => String(row.action).startsWith(`vehicles.owner_changed:${customer}:`));
}
export type Row = Record<string, any>;
export async function scoped(
  db: DB,
  table: string,
  tenant: string,
  record: string,
): Promise<Row> {
  const row = await db
    .prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND id=?`)
    .get(tenant, record);
  if (!row)
    throw Object.assign(new Error("Registro não encontrado nesta oficina."), {
      status: 404,
    });
  return row;
}
export async function audit(
  db: DB,
  ctx: Context,
  action: string,
  entity: string,
  metadata: Record<string, unknown> = {},
) {
  const values = [id(), ctx.tenantId, ctx.userId, action, entity];
  await db.exec("SAVEPOINT audit_metadata_compat");
  try {
    await db
      .prepare(
        "INSERT INTO audit_events(id,tenant_id,user_id,action,entity_id,metadata) VALUES(?,?,?,?,?,?)",
      )
      .run(...values, JSON.stringify(metadata));
    await db.exec("RELEASE SAVEPOINT audit_metadata_compat");
    return true;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT audit_metadata_compat");
    await db.exec("RELEASE SAVEPOINT audit_metadata_compat");
    const code = String((error as { code?: unknown })?.code || "");
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const missingMetadataColumn =
      (code === "42703" && /metadata/.test(message)) ||
      /(?:no such column: metadata|audit_events.*metadata|metadata.*audit_events|has no column named metadata)/.test(message);
    if (!missingMetadataColumn) throw error;
    await db
      .prepare(
        "INSERT INTO audit_events(id,tenant_id,user_id,action,entity_id) VALUES(?,?,?,?,?)",
      )
      .run(...values);
    return false;
  }
}

export async function previewVehicleCatalogBackfill(db: DB, ctx: Context, limit = 250, cursor = "") {
  requireAdmin(ctx);
  const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
  const total = Number((await db.prepare("SELECT COUNT(*) n FROM vehicles WHERE tenant_id=? AND COALESCE(service_model_id,'')=''").get(ctx.tenantId))?.n || 0);
  const rows = await db.prepare("SELECT * FROM vehicles WHERE tenant_id=? AND COALESCE(service_model_id,'')='' AND id>? ORDER BY id LIMIT ?").all(ctx.tenantId, cursor, bounded);
  const counts = { linked: 0, matched: 0, needs_confirmation: 0, not_identified: 0, unavailable: 0, mismatch: 0 };
  const results = [];
  for (const vehicle of rows) {
    const match = await identifyVehicleModel(db, ctx, vehicle);
    counts[match.status] = (counts as any)[match.status] + 1;
    results.push({ vehicle_id: vehicle.id, plate: vehicle.plate, brand: vehicle.brand, vehicle_model: vehicle.model, status: match.status, matched_model: match.model, candidates: match.candidates });
  }
  const last = rows.length ? String(rows[rows.length - 1].id) : cursor;
  const more = !!(last && await db.prepare("SELECT 1 yes FROM vehicles WHERE tenant_id=? AND COALESCE(service_model_id,'')='' AND id>? LIMIT 1").get(ctx.tenantId, last));
  return { dry_run: true, scanned: rows.length, total_unlinked: total, next_cursor: more ? last : null, has_more: more, counts, results };
}

export async function applyVehicleCatalogBackfill(db: DB, ctx: Context, limit = 50, cursor = "") {
  requireAdmin(ctx);
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
  return transaction(db, async () => {
    const rows = await db.prepare("SELECT * FROM vehicles WHERE tenant_id=? AND COALESCE(service_model_id,'')='' AND id>? ORDER BY id LIMIT ?").all(ctx.tenantId, cursor, bounded);
    let linked = 0, ambiguous = 0, unidentified = 0;
    for (const vehicle of rows) {
      const match = await identifyVehicleModel(db, ctx, vehicle);
      if (match.status === "matched" && match.model) {
        const result = await db.prepare("UPDATE vehicles SET service_model_id=?,service_porte_id=? WHERE tenant_id=? AND id=? AND COALESCE(service_model_id,'')=''").run(match.model.id, match.model.porte_id || "", ctx.tenantId, vehicle.id);
        if (result.changes) { linked++; await audit(db, ctx, "vehicles.catalog_link_backfill", String(vehicle.id)); }
      } else if (match.status === "needs_confirmation") ambiguous++;
      else unidentified++;
    }
    const last = rows.length ? String(rows[rows.length - 1].id) : cursor;
    const more = !!(last && await db.prepare("SELECT 1 yes FROM vehicles WHERE tenant_id=? AND COALESCE(service_model_id,'')='' AND id>? LIMIT 1").get(ctx.tenantId, last));
    return { dry_run: false, scanned: rows.length, linked, ambiguous, unidentified, next_cursor: more ? last : null, has_more: more };
  });
}

export async function invalidateOrderShares(
  db: DB,
  ctx: Context,
  orderId: string,
) {
  const result = await db
    .prepare(
      "UPDATE public_shares SET revoked=1 WHERE tenant_id=? AND order_id=? AND revoked=0",
    )
    .run(ctx.tenantId, orderId);
  const revoked = Number(result.changes);
  if (revoked > 0) {
    await audit(db, ctx, "order.share_links_revoked", orderId);
  }
  return revoked;
}
export function hydrateOrderItem(item: Row): Row {
  if (!item.service_snapshot) return item;
  const snapshot = JSON.parse(item.service_snapshot);
  return {
    ...item,
    repair_service_id: snapshot.service_id,
    repair_model_id: snapshot.model_id,
    workshop_service_id: snapshot.workshop_service_id,
    porte_id: snapshot.porte_id,
    commercial_category_id: snapshot.commercial_category_id,
    service_execution: snapshot.execution,
    service_cost: snapshot.cost,
    service_minutes: snapshot.minutes,
    duration_seconds: snapshot.minutes * 60,
    service_details: snapshot,
  };
}
export async function listOrders(db: DB, tenant: string): Promise<Row[]> {
  const rows = await db
    .prepare(
      `SELECT o.*,COALESCE(c.name,NULLIF(o.guest_name,''),'Cliente não informado') customer_name,
 COALESCE(v.plate,o.guest_plate) plate,COALESCE(v.brand,'') brand,COALESCE(NULLIF(v.fipe_model,''),v.model,o.guest_vehicle) model,
 r.id receivable_id,r.status payment_status,r.method payment_method,r.paid_at payment_paid_at,
 CASE WHEN o.status='completed' AND r.status='open' THEN 'awaiting_payment' ELSE o.status END display_status
 FROM orders o LEFT JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id
 LEFT JOIN vehicles v ON v.id=o.vehicle_id AND v.tenant_id=o.tenant_id
 LEFT JOIN receivables r ON r.order_id=o.id AND r.tenant_id=o.tenant_id
 WHERE o.tenant_id=? ORDER BY o.number DESC`,
    )
    .all(tenant);
  const items = await db
    .prepare(
      "SELECT i.*,p.name professional_name,e.duration_seconds,e.source capture_source,e.vehicle_label FROM order_items i LEFT JOIN professionals p ON p.id=i.professional_id AND p.tenant_id=i.tenant_id LEFT JOIN external_captures e ON e.item_id=i.id AND e.tenant_id=i.tenant_id WHERE i.tenant_id=?",
    )
    .all(tenant);
  const byOrder = new Map<string, Row[]>();
  for (const rawItem of items) {
    const item = hydrateOrderItem(rawItem);
    const group = byOrder.get(item.order_id) || [];
    group.push(item);
    byOrder.set(item.order_id, group);
  }
  return rows.map((o) => ({ ...o, due_on: o.status === "quote" ? "" : o.due_on, kind: "order", items: byOrder.get(o.id) || [] }));
}
async function resolveOrderIdentity(db: DB, ctx: Context, input: Row) {
  let customerId = input.customer_id || null;
  let vehicleId = input.vehicle_id || null;
  if (input.new_customer) {
    if (customerId)
      throw new Error(
        "Escolha um cliente cadastrado ou informe um novo cliente.",
      );
    const name = String(input.new_customer.name || "")
      .trim()
      .replace(/\s+/g, " ");
    const phone = String(input.new_customer.phone || "").trim();
    if (name.length < 2 || name.length > 150)
      throw new Error(
        "Informe o nome completo do novo cliente (até 150 caracteres).",
      );
    if (!validNewCustomerPhone(phone))
      throw new Error(
        "Informe o telefone com DDD para cadastrar o novo cliente.",
      );
    const matches = (
      await db
        .prepare("SELECT id,name,phone,active FROM customers WHERE tenant_id=?")
        .all(ctx.tenantId)
    ).filter(
      (c) =>
        normalizeCustomerName(c.name) === normalizeCustomerName(name) &&
        customerPhoneDigits(c.phone) === customerPhoneDigits(phone),
    );
    if (matches.length > 1)
      throw new Error(
        "Há mais de um cliente com esse nome e telefone. Selecione o cadastro na lista.",
      );
    if (matches.length) {
      if (!matches[0].active)
        throw new Error("Este cliente está inativo. Reative-o no cadastro.");
      customerId = matches[0].id;
    } else {
      customerId = id();
      await db
        .prepare(
          "INSERT INTO customers(id,tenant_id,name,phone) VALUES(?,?,?,?)",
        )
        .run(customerId, ctx.tenantId, name, phone);
      await audit(db, ctx, "customers.created", customerId);
    }
  }
  if (input.new_vehicle) {
    if (vehicleId || !customerId)
      throw new Error("Vincule o novo veículo a um cliente.");
    const customer = await scoped(db, "customers", ctx.tenantId, customerId);
    if (!customer.active) throw new Error("Escolha um cliente ativo.");
    const v = input.new_vehicle;
    const plate = String(v.plate || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (
      !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate) ||
      String(v.brand || "").trim().length < 2 ||
      String(v.model || "").trim().length < 2 ||
      !Number.isInteger(v.year) ||
      v.year < 1900 ||
      v.year > 2100
    )
      throw new Error(
        "Informe placa, marca, modelo e ano válidos para o novo veículo.",
      );
    const existing = await db
      .prepare("SELECT * FROM vehicles WHERE tenant_id=? AND plate=?")
      .get(ctx.tenantId, plate);
    if (existing) {
      if (existing.customer_id !== customerId || !existing.active)
        throw new Error(
          "Esta placa já pertence a outro cliente ou está inativa. Consulte a placa e selecione o cadastro correto.",
        );
      vehicleId = existing.id;
    } else {
      vehicleId = id();
      const explicitNone = Object.prototype.hasOwnProperty.call(v, "service_model_id") && !v.service_model_id;
      const selection = explicitNone ? null : v.service_model_id || input.service_model_id;
      const selectedModel = selection && await catalogAccessState(db, ctx) === "active" ? await confirmVehicleModel(db, ctx, v, selection) : null;
      const match = selectedModel || explicitNone ? null : await identifyVehicleModel(db, ctx, v);
      const model = selectedModel || (match?.status === "matched" ? match.model : null);
      await db
        .prepare(
          "INSERT INTO vehicles(id,tenant_id,customer_id,plate,brand,model,year,color,km,chassis,fipe_code,fipe_model,fipe_year_id,model_year,fuel,service_model_id,service_porte_id,service_link_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          vehicleId,
          ctx.tenantId,
          customerId,
          plate,
          v.brand.trim(),
          v.model.trim(),
          v.year,
          v.color || "",
          input.km,
          v.chassis || "",
          v.fipe_code || "",
          v.fipe_model || "",
          v.fipe_year_id || "",
          v.model_year || null,
          v.fuel || "",
          model?.id || "",
          model?.porte_id || "",
          selection ? "manual" : model ? "auto" : "none",
        );
      await audit(db, ctx, "vehicles.created", vehicleId);
      if (model) await audit(db, ctx, selection ? "vehicles.catalog_link_confirmed" : "vehicles.catalog_link_auto", vehicleId);
    }
  }
  return { customerId, vehicleId };
}
export async function saveOrder(
  db: DB,
  ctx: Context,
  input: Row,
  record?: string,
) {
  if(ctx.access)requirePermission(ctx,"orders.edit");else requireAdmin(ctx);
  return await transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    if(record&&ctx.access)await assertOrderVisible(db,ctx,record);
    const old = record
      ? await scoped(db, "orders", ctx.tenantId, record)
      : null;
    if (old && ["completed", "cancelled"].includes(old.status))
      throw new Error(
        "Ordens finalizadas ou canceladas não podem ser editadas.",
      );
    if(ctx.access&&(input.new_customer||input.new_vehicle))requirePermission(ctx,"customers.create");
    if(ctx.access&&old&&(input.customer_id!==old.customer_id||input.vehicle_id!==old.vehicle_id))requirePermission(ctx,"customers.view");
    const status = old?.status || input.status || "quote";
    // Legacy database discriminator is derived from status, never used for business rules.
    const kind = status === "quote" ? "quote" : "order";
    const { customerId, vehicleId } = await resolveOrderIdentity(
      db,
      ctx,
      input,
    );
    if (status !== "quote" && (!customerId || !vehicleId))
      throw new Error("Selecione o cliente e o veículo para a OS.");
    const customer = customerId
      ? await scoped(db, "customers", ctx.tenantId, customerId)
      : null;
    const vehicle = vehicleId
      ? await scoped(db, "vehicles", ctx.tenantId, vehicleId)
      : null;
    if ((customer && !customer.active) || (vehicle && !vehicle.active))
      throw new Error("Escolha cliente e veículo ativos.");
    if (vehicle && vehicle.customer_id !== customerId && !(old && old.customer_id === customerId && old.vehicle_id === vehicleId && await hasOwnerTransfer(db,ctx.tenantId,vehicle.id,String(customerId))))
      throw new Error("O veículo não pertence ao cliente selecionado.");
    const dueOn = status === "quote" ? old?.due_on || "" : input.due_on;
    if (status !== "quote" && !dueOn)
      throw new Error("Informe a previsão de entrega para a OS.");
    if (status !== "quote" && dueOn < input.entered_on)
      throw new Error("A previsão não pode ser anterior à entrada.");
    const previous = old
      ? await db
          .prepare("SELECT * FROM order_items WHERE tenant_id=? AND order_id=?")
          .all(ctx.tenantId, record!)
      : [];
    const changingVehicle = !!old?.vehicle_id && String(old.vehicle_id) !== String(vehicleId || "");
    if (changingVehicle) {
      if (!input.confirm_vehicle_change)
        throw new Error("Confirme a troca do veículo e a remoção dos itens deste atendimento.");
      if (input.items.length)
        throw new Error("Remova os itens do veículo anterior antes de confirmar a troca.");
      if (["completed", "cancelled"].includes(old.status) ||
          await db.prepare("SELECT 1 FROM stock_movements WHERE tenant_id=? AND order_id=? LIMIT 1").get(ctx.tenantId, old.id) ||
          await db.prepare("SELECT 1 FROM receivables WHERE tenant_id=? AND order_id=? LIMIT 1").get(ctx.tenantId, old.id))
        throw new Error("Este atendimento possui movimentações ou cobrança. A troca de veículo requer estorno seguro.");
    }
    const hasExplicitModel = Object.prototype.hasOwnProperty.call(input, "service_model_id");
    const addsCatalogServices = input.items.some((item: Row) =>
      item.repair_service_id && !previous.some((prior: Row) => prior.id === item.id && prior.service_snapshot),
    );
    const explicitlyChangedModel = hasExplicitModel && (input.service_model_id !== vehicle?.service_model_id || input.service_link_mode === "manual");
    if (vehicle?.service_model_id && addsCatalogServices && !explicitlyChangedModel) {
      const linkedMatch = await identifyVehicleModel(db, ctx, vehicle);
      if (linkedMatch.status === "mismatch")
        throw new Error("Os dados do veículo divergem do vínculo técnico. Revise e confirme novamente o modelo antes de incluir serviços.");
    }
    if (hasExplicitModel && vehicleId && (input.service_model_id !== vehicle?.service_model_id || input.service_link_mode === "manual")) {
      if (input.service_model_id) {
        if (await catalogAccessState(db, ctx) === "active") {
          const selectedModel = await confirmVehicleModel(db, ctx, vehicle || {}, input.service_model_id);
          await db.prepare('UPDATE vehicles SET service_model_id=?,service_porte_id=?,service_link_mode=? WHERE tenant_id=? AND id=?').run(input.service_model_id, selectedModel.porte_id || '', 'manual', ctx.tenantId, vehicleId);
          if (vehicle) { vehicle.service_model_id = input.service_model_id; vehicle.service_porte_id = selectedModel.porte_id || ''; }
          await audit(db, ctx, "vehicles.catalog_link_confirmed", vehicleId);
        }
      } else {
        await db.prepare("UPDATE vehicles SET service_model_id='',service_porte_id='',service_link_mode='none' WHERE tenant_id=? AND id=?").run(ctx.tenantId, vehicleId);
        if (vehicle) { vehicle.service_model_id = ''; vehicle.service_porte_id = ''; }
      }
    }
    const items = await Promise.all(
      input.items.map(async (item: Row) => {
        const priorService=previous.find(p=>p.id===item.id && p.service_snapshot);
        if(item.repair_service_id || item.workshop_service_id){
          if(item.repair_service_id && !priorService && item.repair_model_id!==(input.service_model_id||vehicle?.service_model_id))throw new Error('Confirme o modelo usado nos serviços deste veículo.');
          if(item.professional_id && !(await scoped(db,'professionals',ctx.tenantId,item.professional_id)).active)throw new Error('Profissional inativo.');
          const service=await resolveService(db,ctx,item,priorService);
          const details=JSON.parse(service.service_snapshot);details.charged_price=item.price;
          return {...item,catalog_id:null,snapshotId:priorService?.id||id(),kind:'service',name:service.name,cost:service.cost,professional_id:item.professional_id||null,service_snapshot:JSON.stringify(details)};
        }
        const catalog = await scoped(
          db,
          "catalog",
          ctx.tenantId,
          item.catalog_id,
        );
        const prior = previous.find(
          (p) => p.id === item.id && p.catalog_id === item.catalog_id,
        );
        if ((catalog.archived_at || !catalog.active) && !prior)
          throw new Error(
            "Este item não está disponível no catálogo. Importe pela extensão ou escolha um item ativo.",
          );
        if (
          item.professional_id &&
          !(
            await scoped(
              db,
              "professionals",
              ctx.tenantId,
              item.professional_id,
            )
          ).active
        )
          throw new Error("Profissional inativo.");
        if (
          item.cost_override !== undefined &&
          (!Number.isSafeInteger(item.cost_override) || item.cost_override < 0)
        )
          throw new Error("Informe um custo válido em centavos.");
        return {
          ...item,
          snapshotId: prior?.id || id(),
          kind: catalog.kind,
          name:
            item.refresh_catalog === true
              ? catalog.kind === "product"
                ? productLabel(catalog)
                : catalog.name
              : prior?.name ||
                (catalog.kind === "product"
                  ? productLabel(catalog)
                  : catalog.name),
          cost: item.cost_override ?? prior?.cost ?? catalog.cost,
          professional_id: item.professional_id || null,
        };
      }),
    );
    const subtotal=items.reduce((sum,item)=>sum+item.price*item.quantity,0);
    if(ctx.access){
      const prior=old?await db.prepare("SELECT * FROM order_items WHERE tenant_id=? AND order_id=?").all(ctx.tenantId,record):[];
      const sameItems=JSON.stringify(prior.map(i=>[i.catalog_id,i.quantity,i.price]).sort())===JSON.stringify(items.map(i=>[i.catalog_id,i.quantity,i.price]).sort());
      if(!sameItems)requirePermission(ctx,"orders.items");
      if(Number(input.discount)!==Number(old?.discount||0)&&!canDiscount(ctx,subtotal,Number(input.discount)))throw Object.assign(new Error("Desconto acima do seu limite. Solicite aprovação."),{status:403});
      if(old&&Number(old.discount||0)>0&&subtotal!==Number(old.total)+Number(old.discount)&&!canDiscount(ctx,subtotal,Number(input.discount)))throw Object.assign(new Error("O desconto deve ser revalidado após alterar os itens."),{status:403});
    }
    const total = totalOf(items, input.discount);
    const orderId = record || id();
    const changed =
      !!old &&
      (String(old.customer_id || "") !== String(customerId || "") ||
        String(old.vehicle_id || "") !== String(vehicleId || "") ||
        String(old.guest_name || "") !== String(input.guest_name || "") ||
        String(old.guest_plate || "") !== String(input.guest_plate || "") ||
        String(old.guest_vehicle || "") !== String(input.guest_vehicle || "") ||
        String(old.entered_on || "") !== String(input.entered_on || "") ||
        String(old.due_on || "") !== String(dueOn || "") ||
        Number(old.km || 0) !== Number(input.km || 0) ||
        String(old.problem || "") !== String(input.problem || "") ||
        String(old.notes || "") !== String(input.notes || "") ||
        Number(old.discount || 0) !== Number(input.discount || 0) ||
        Number(old.total || 0) !== total ||
        previous.length !== items.length ||
        items.some((item) => {
          const prior = previous.find((row) => row.id === item.snapshotId);
          return (
            !prior ||
            String(prior.catalog_id) !== String(item.catalog_id) ||
            String(prior.professional_id || "") !==
              String(item.professional_id || "") ||
            String(prior.kind) !== String(item.kind) ||
            String(prior.name) !== String(item.name) ||
            Number(prior.quantity) !== Number(item.quantity) ||
            Number(prior.price) !== Number(item.price) ||
            Number(prior.cost) !== Number(item.cost) ||
            String(prior.service_snapshot||'') !== String(item.service_snapshot||'')
          );
        }));
    const values = [
      customerId,
      vehicleId,
      input.guest_name || "",
      input.guest_plate || "",
      input.guest_vehicle || "",
      input.entered_on,
      dueOn,
      input.km,
      input.problem,
      input.notes,
      input.discount,
      total,
    ];
    if (old)
      await db
        .prepare(
          "UPDATE orders SET kind=?,customer_id=?,vehicle_id=?,guest_name=?,guest_plate=?,guest_vehicle=?,entered_on=?,due_on=?,km=?,problem=?,notes=?,discount=?,total=? WHERE tenant_id=? AND id=?",
        )
        .run(kind, ...values, ctx.tenantId, orderId);
    else {
      const number = Number(
        (await db
          .prepare(
            "SELECT COALESCE(MAX(number),1000)+1 number FROM orders WHERE tenant_id=?",
          )
          .get(ctx.tenantId))!.number,
      );
      await db
        .prepare(
          "INSERT INTO orders(id,tenant_id,number,kind,status,customer_id,vehicle_id,guest_name,guest_plate,guest_vehicle,entered_on,due_on,km,problem,notes,discount,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          orderId,
          ctx.tenantId,
          number,
          kind,
          status,
          ...values,
        );
    }
    await db
      .prepare("DELETE FROM order_items WHERE tenant_id=? AND order_id=?")
      .run(ctx.tenantId, orderId);
    for (const item of items)
      await db
        .prepare("INSERT INTO order_items(id,tenant_id,order_id,catalog_id,professional_id,kind,name,quantity,price,cost,service_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          item.snapshotId,
          ctx.tenantId,
          orderId,
          item.catalog_id,
          item.professional_id,
          item.kind,
          item.name,
          item.quantity,
          item.price,
          item.cost,
          item.service_snapshot || '',
        );
    if (changed){await invalidateOrderShares(db, ctx, orderId);await db.prepare("UPDATE discount_requests SET status='invalidated' WHERE tenant_id=? AND order_id=? AND status='pending'").run(ctx.tenantId,orderId);}
    if (changingVehicle) {
      const archived = await audit(db, ctx, `order.vehicle_changed:${String(old.vehicle_id || "")}:${String(vehicleId || "")}:items_removed:${previous.length}`, orderId,
        { previous_order: old, previous_items: previous, vehicle_id: vehicleId });
      if (!archived) throw new Error("Atualize a estrutura de auditoria antes de trocar o veículo. Nenhuma alteração foi salva.");
    }
    await audit(
      db,
      ctx,
      old ? "order.updated" : "order.created",
      orderId,
    );
    return orderId;
  });
}
async function reverseCompletedOrder(db: DB, ctx: Context, order: Row, reversalReason?: string) {
  const receivable = await db
    .prepare("SELECT * FROM receivables WHERE tenant_id=? AND order_id=?")
    .get(ctx.tenantId, order.id);
  if (receivable) {
    const paidInstallment = await db
      .prepare(
        "SELECT 1 paid FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='paid' LIMIT 1",
      )
      .get(ctx.tenantId, receivable.id);
    const cashEntry = await db
      .prepare(
        "SELECT 1 paid FROM cash_entries WHERE tenant_id=? AND receivable_id=? LIMIT 1",
      )
      .get(ctx.tenantId, receivable.id);
    if (receivable.status === "paid" || paidInstallment || cashEntry) {
      const basic = ctx.role === "owner" && ctx.modules?.orders !== false && ctx.modules?.finance === false;
      if (!basic) throw new Error(
        "Esta OS já possui recebimento confirmado. Corrija ou estorne o financeiro antes de reabrir a OS.",
      );
      const reason = reversalReason?.trim() || "";
      if (reason.length < 10 || reason.length > 500)
        throw new Error("Informe o motivo do estorno com 10 a 500 caracteres antes de reabrir a OS.");
      const parts = await db.prepare("SELECT * FROM payment_installments WHERE tenant_id=? AND receivable_id=?").all(ctx.tenantId, receivable.id);
      const entries = await db.prepare("SELECT * FROM cash_entries WHERE tenant_id=? AND receivable_id=?").all(ctx.tenantId, receivable.id);
      const registered = await db.prepare("SELECT 1 FROM audit_events WHERE tenant_id=? AND entity_id=? AND action='order.basic_receipt_registered' LIMIT 1").get(ctx.tenantId, order.id);
      const part = parts[0], entry = entries[0];
      if (!registered || parts.length !== 1 || entries.length !== 1 || part.status !== "paid" ||
          entry.installment_id !== part.id || Number(part.gross) !== Number(receivable.amount) ||
          Number(part.fee) !== 0 || Number(part.interest) !== 0 ||
          Number(entry.amount) !== Number(part.net) || entry.method !== part.method ||
          !basicOrderReceiptMethods.includes(part.method))
        throw new Error("Este recebimento exige correção pelo Financeiro antes de reabrir a OS.");
      const movements = await db.prepare("SELECT * FROM cash_movements WHERE tenant_id=? AND origin='receipt' AND source_id=?").all(ctx.tenantId, part.id);
      if (movements.length > 1 || (movements.length === 1 && Number(movements[0].amount) !== Number(entry.amount)))
        throw new Error("O lançamento do caixa está inconsistente. Corrija-o antes de reabrir a OS.");
      const originalMovement = movements[0] || null;
      const reversalId = originalMovement ? id() : null;
      const archived = await audit(db, ctx, "order.basic_receipt_reversed", String(order.id), {
        reason, receivable, installment: part, cash_entry: entry,
        cash_movement: originalMovement, reversal_movement_id: reversalId,
      });
      if (!archived) throw new Error("A auditoria detalhada está indisponível. Nenhum recebimento foi estornado.");
      if (originalMovement) await db.prepare(
        "INSERT INTO cash_movements(id,tenant_id,account_id,day,amount,gross_amount,fee_amount,description,method,origin,source_id,source_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(reversalId, ctx.tenantId, originalMovement.account_id, cashToday(),
        -Number(originalMovement.amount), -Number(originalMovement.gross_amount), -Number(originalMovement.fee_amount),
        `Estorno de recebimento OS #${order.number}`, originalMovement.method, "adjustment",
        `basic-reversal:${part.id}`, JSON.stringify({ reason, original_movement_id: originalMovement.id, order_id: order.id }));
      await db.prepare("DELETE FROM cash_entries WHERE tenant_id=? AND id=?").run(ctx.tenantId, entry.id);
    }
    await db
      .prepare(
        "DELETE FROM payment_installments WHERE tenant_id=? AND receivable_id=?",
      )
      .run(ctx.tenantId, receivable.id);
    await db
      .prepare("DELETE FROM receivables WHERE tenant_id=? AND id=?")
      .run(ctx.tenantId, receivable.id);
  }

  const movements = await db
    .prepare(
      "SELECT id,catalog_id,quantity FROM stock_movements WHERE tenant_id=? AND order_id=? AND quantity<0",
    )
    .all(ctx.tenantId, order.id);
  for (const movement of movements)
    await db
      .prepare("UPDATE catalog SET stock=stock+? WHERE tenant_id=? AND id=?")
      .run(-Number(movement.quantity), ctx.tenantId, movement.catalog_id);
  await db
    .prepare(
      "DELETE FROM stock_movements WHERE tenant_id=? AND order_id=? AND quantity<0",
    )
    .run(ctx.tenantId, order.id);
}

export async function transitionOrder(
  db: DB,
  ctx: Context,
  record: string,
  status: Status,
  dueOn?: string,
  reversalReason?: string,
) {
  return await transaction(db, async () => {
    const warnings: string[] = [];
    const order = await scoped(db, "orders", ctx.tenantId, record);
    if (order.status === status)
      throw new Error("O atendimento já está nesta situação.");
    if(ctx.access){await assertOrderVisible(db,ctx,record);requirePermission(ctx,status==="cancelled"?"orders.admin":status==="completed"?"orders.finalize":order.status==="completed"?"orders.reopen":"orders.status");if(order.status==="quote"&&status==="open")requirePermission(ctx,"orders.edit");}
    else if (ctx.role !== "owner") {
      if (
        !["working", "ready"].includes(status) ||
        !["open", "working", "ready"].includes(order.status)
      )
        throw Object.assign(
          new Error("O mecânico pode iniciar ou marcar o serviço como pronto."),
          { status: 403 },
        );
      assertTransition(order.status, status);
    }

    if (!["quote", "cancelled"].includes(status)) {
      if (!order.customer_id || !order.vehicle_id)
        throw new Error(
          "Vincule cliente e veículo antes de aprovar a OS.",
        );
      const customer = await scoped(
          db,
          "customers",
          ctx.tenantId,
          order.customer_id,
        ),
        vehicle = await scoped(db, "vehicles", ctx.tenantId, order.vehicle_id);
      if (
        !customer.active ||
        !vehicle.active ||
        (vehicle.customer_id !== customer.id && !await hasOwnerTransfer(db,ctx.tenantId,vehicle.id,customer.id))
      )
        throw new Error(
          "Confira o cliente e o veículo antes de alterar a situação.",
        );
    }

    if (order.status === "quote" && !["quote", "cancelled"].includes(status)) {
      if (!dueOn) throw new Error("Informe a previsão de entrega ao aprovar a OS.");
      if (dueOn < order.entered_on)
        throw new Error("A previsão não pode ser anterior à entrada.");
      await db.prepare("UPDATE orders SET due_on=? WHERE tenant_id=? AND id=?")
        .run(dueOn, ctx.tenantId, record);
      order.due_on = dueOn;
    }

    if (order.status === "completed" && status !== "completed")
      await reverseCompletedOrder(db, ctx, order, reversalReason);

    if (status === "completed") {
      const items = (await db
        .prepare("SELECT * FROM order_items WHERE tenant_id=? AND order_id=?")
        .all(ctx.tenantId, record)) as Row[];
      if (!items.length)
        throw new Error(
          "Adicione pelo menos um produto ou serviço para finalizar.",
        );
      const products = new Map<string, { name: string; quantity: number }>();
      for (const item of items.filter((i) => i.kind === "product")) {
        const current = products.get(item.catalog_id);
        products.set(item.catalog_id, {
          name: current?.name || item.name,
          quantity: (current?.quantity || 0) + Number(item.quantity),
        });
      }
      for (const [catalogId, item] of products) {
        const catalog = await scoped(db, "catalog", ctx.tenantId, catalogId);
        if (Number(catalog.stock) < item.quantity) {
          warnings.push(
            `Estoque insuficiente para ${item.name}: necessário ${item.quantity}, disponível ${catalog.stock}. A OS foi finalizada sem baixar esta peça do estoque.`,
          );
          continue;
        }
        await db
          .prepare(
            "UPDATE catalog SET stock=stock-? WHERE tenant_id=? AND id=?",
          )
          .run(item.quantity, ctx.tenantId, catalogId);
        await db
          .prepare(
            "INSERT INTO stock_movements(id,tenant_id,catalog_id,order_id,quantity,reason,user_id) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            ctx.tenantId,
            catalogId,
            record,
            -item.quantity,
            `OS #${order.number}`,
            ctx.userId,
          );
      }
      if (order.total > 0)
        await db
          .prepare(
            "INSERT INTO receivables(id,tenant_id,order_id,customer_id,description,amount,due_on,gross_total,net_total) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            ctx.tenantId,
            record,
            order.customer_id,
            `OS #${order.number}`,
            order.total,
            order.due_on,
            order.total,
            order.total,
          );
    }

    // Keep the old nullable-customer database constraint compatible; status is authoritative.
    const kind = status === "quote" || (status === "cancelled" && (!order.customer_id || !order.vehicle_id)) ? "quote" : "order";
    await db
      .prepare(
        "UPDATE orders SET status=?,kind=?,completed_on=? WHERE tenant_id=? AND id=?",
      )
      .run(
        status,
        kind,
        status === "completed" ? new Date().toISOString() : null,
        ctx.tenantId,
        record,
      );
    await invalidateOrderShares(db, ctx, record);
    await audit(
      db,
      ctx,
      order.status === "completed" && status !== "completed"
        ? `order.reopened.${status}`
        : `order.${status}`,
      record,
    );
    return { warnings };
  });
}
export async function recordBasicOrderReceipt(
  db: DB,
  ctx: Context,
  orderId: string,
  method: BasicOrderReceiptMethod,
  accountId?: string,
) {
  requireAdmin(ctx);
  if (ctx.modules?.orders === false || ctx.modules?.finance !== false)
    throw Object.assign(new Error("Recebimento simples indisponível para esta oficina."), { status: 403 });
  return transaction(db, async () => {
    const order = await scoped(db, "orders", ctx.tenantId, orderId);
    if (order.status !== "completed" || Number(order.total) <= 0)
      throw new Error("Finalize uma OS com valor a receber antes de registrar o pagamento.");
    const receivable = await db
      .prepare("SELECT * FROM receivables WHERE tenant_id=? AND order_id=?")
      .get(ctx.tenantId, orderId);
    if (!receivable)
      throw Object.assign(new Error("Recebimento não encontrado nesta oficina."), { status: 404 });
    if (receivable.status !== "open")
      throw new Error("O recebimento desta OS já foi registrado.");
    const existingPlan = await db
      .prepare("SELECT 1 FROM payment_installments WHERE tenant_id=? AND receivable_id=? LIMIT 1")
      .get(ctx.tenantId, receivable.id);
    const existingCash = await db
      .prepare("SELECT 1 FROM cash_entries WHERE tenant_id=? AND receivable_id=? LIMIT 1")
      .get(ctx.tenantId, receivable.id);
    if (receivable.plan_configured || existingPlan || existingCash)
      throw new Error("Esta OS já possui condições ou pagamentos registrados. Use o Financeiro para concluir a cobrança.");
    await configureBasicOrderPlan(db, ctx, String(receivable.id), method);
    const installment = await db
      .prepare("SELECT id FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open' LIMIT 1")
      .get(ctx.tenantId, receivable.id);
    if (!installment) throw new Error("Não foi possível preparar o recebimento.");
    await settleInstallment(db, ctx, String(installment.id), accountId, true);
    await audit(db, ctx, "order.basic_receipt_registered", orderId, {
      method, amount: Number(receivable.amount), receivable_id: receivable.id,
    });
  });
}
export async function settle(
  db: DB,
  ctx: Context,
  record: string,
  method: string,
  accountId?: string,
) {
  requireAdmin(ctx);
  const r = await scoped(db, "receivables", ctx.tenantId, record);
  if (r.status !== "open") throw new Error("Esta conta já foi recebida.");
  if (!r.plan_configured)
    await configurePlan(db, ctx, record, {
      method,
      installments: 1,
      card_fee_bps: 0,
      interest_bps: 0,
      first_due_on: r.due_on,
    });
  const parts = await db
    .prepare(
      "SELECT id FROM payment_installments WHERE tenant_id=? AND receivable_id=? AND status='open'",
    )
    .all(ctx.tenantId, record);
  if (
    r.method === "Cartão de crédito" ||
    (!r.plan_configured && method === "Cartão de crédito")
  )
    return settleCredit(db, ctx, record, accountId);
  if (parts.length !== 1)
    throw new Error("Receba cada parcela na tela de pagamento.");
  await settleInstallment(db, ctx, String(parts[0].id), accountId);
}
export async function mechanicWorkspace(db: DB, tenant: string) {
  const orders = (await listOrders(db, tenant))
    .filter((o) => ["open", "working", "ready", "completed"].includes(o.status))
    .map((o) => ({
      id: o.id,
      number: o.number,
      kind: o.kind,
      status: o.status,
      display_status: o.status,
      customer_name: o.customer_name,
      plate: o.plate,
      brand: o.brand,
      model: o.model,
      entered_on: o.entered_on,
      due_on: o.due_on,
      completed_on: o.completed_on,
      km: o.km,
      problem: o.problem,
      notes: o.notes,
      items: o.items.map((i: Row) => ({
        id: i.id,
        kind: i.kind,
        name: i.name,
        quantity: i.quantity,
        professional_name: i.professional_name,
      })),
    }));
  return {
    orders,
    customers: [],
    vehicles: [],
    catalog: [],
    professionals: [],
    receivables: [],
    cash: [],
    movements: [],
    installments: [],
    payment_settings: null,
  };
}

