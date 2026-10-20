import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, Row } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { getPartsPricing } from "./partsPricing.js";
import {
  serviceMinutes,
  servicePrice,
  outsourcedPrice,
} from "../../shared/servicePricing.js";

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(100000000);
export const serviceSelectionSchema = z.object({
  repair_service_id: uuid.optional(),
  repair_model_id: uuid.optional(),
  workshop_service_id: uuid.optional(),
  porte_id: uuid.optional(),
  service_execution: z.enum(["internal", "outsourced"]).optional(),
  service_cost: cents.optional(),
  service_minutes: z.number().finite().min(0).max(10000).optional(),
  manual_price: cents.optional(),
});
async function tenantRead<T>(db: DB, ctx: Context, fn: () => Promise<T>) {
  return db.withTenantRead ? db.withTenantRead(ctx.tenantId, fn) : fn();
}
async function access(db: DB, ctx: Context) {
  try {
    const row = await db
      .prepare(
        "SELECT a.tenant_id FROM service_catalog.tenant_access a WHERE a.tenant_id=? AND a.enabled AND (a.valid_until IS NULL OR a.valid_until>CURRENT_TIMESTAMP) AND EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active')",
      )
      .get(ctx.tenantId);
    return !!row;
  } catch (error) {
    if (!db.withTenantRead && /no such table/.test(String(error))) return false;
    throw error;
  }
}
export async function withCatalog<T>(
  db: DB,
  ctx: Context,
  fn: () => Promise<T>,
) {
  return tenantRead(db, ctx, async () => {
    if (!(await access(db, ctx)))
      throw Object.assign(
        new Error("O catálogo de tempos não está liberado para esta oficina."),
        { status: 403 },
      );
    return fn();
  });
}
export async function serviceInfo(db: DB, ctx: Context) {
  requireAdmin(ctx);
  const [portes, pricing, enabled] = await Promise.all([
    db
      .prepare(
        "SELECT p.*,COALESCE(r.hourly_rate,0) hourly_rate FROM labor_portes p LEFT JOIN labor_rates r ON r.porte_id=p.id AND r.tenant_id=? ORDER BY p.name",
      )
      .all(ctx.tenantId),
    getPartsPricing(db, ctx.tenantId),
    tenantRead(db, ctx, () => access(db, ctx)),
  ]);
  return {
    portes,
    enabled,
    service_markup_bps: pricing.service_markup_bps ?? 3000,
  };
}
export async function saveLaborRates(db: DB, ctx: Context, body: unknown) {
  requireAdmin(ctx);
  const rates = z
    .array(z.object({ porte_id: uuid, hourly_rate: cents }))
    .max(50)
    .parse(body);
  if (new Set(rates.map((r) => r.porte_id)).size !== rates.length)
    throw new Error("Porte repetido.");
  for (const rate of rates) {
    if (
      !(await db
        .prepare("SELECT id FROM labor_portes WHERE id=?")
        .get(rate.porte_id))
    )
      throw new Error("Porte inválido.");
    if (!rate.hourly_rate) {
      await db
        .prepare("DELETE FROM labor_rates WHERE tenant_id=? AND porte_id=?")
        .run(ctx.tenantId, rate.porte_id);
      continue;
    }
    await db
      .prepare(
        "INSERT INTO labor_rates(tenant_id,porte_id,hourly_rate) VALUES(?,?,?) ON CONFLICT(tenant_id,porte_id) DO UPDATE SET hourly_rate=excluded.hourly_rate",
      )
      .run(ctx.tenantId, rate.porte_id, rate.hourly_rate);
  }
}
export async function repairModel(db: DB, ctx: Context, modelId: string) {
  uuid.parse(modelId);
  return withCatalog(db, ctx, async () => {
    const model = await db
      .prepare(
        "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE m.id=?",
      )
      .get(modelId);
    if (!model)
      throw Object.assign(new Error("Modelo não encontrado no catálogo."), {
        status: 404,
      });
    return model;
  });
}
export async function searchModels(db: DB, ctx: Context, query: unknown) {
  const q = z
    .object({
      q: z.string().trim().max(100).default(""),
      fipe: z.string().max(20).default(""),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(query);
  return withCatalog(db, ctx, async () => {
    const rows = await db
      .prepare(
        "SELECT m.id,m.name,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE (?='' OR m.fipe_code=?) AND LOWER(b.name || ' ' || m.name) LIKE LOWER(?) ORDER BY b.name,m.name,m.id LIMIT 31 OFFSET ?",
      )
      .all(q.fipe, q.fipe, `%${q.q}%`, q.offset);
    return { items: rows.slice(0, 30), has_more: rows.length > 30 };
  });
}
export async function searchRepairServices(
  db: DB,
  ctx: Context,
  modelId: string,
  query: unknown,
) {
  uuid.parse(modelId);
  const q = z
    .object({
      q: z.string().trim().max(100).default(""),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(query);
  return withCatalog(db, ctx, async () => {
    const rows = await db
      .prepare(
        "SELECT service_id,service_name name,minutes FROM service_catalog.model_services WHERE model_id=? AND LOWER(service_name) LIKE LOWER(?) ORDER BY service_name,service_id LIMIT 51 OFFSET ?",
      )
      .all(modelId, `%${q.q}%`, q.offset);
    return { items: rows.slice(0, 50), has_more: rows.length > 50 };
  });
}
export async function listWorkshopServices(
  db: DB,
  ctx: Context,
  query: unknown,
) {
  const q = z
    .object({
      q: z.string().trim().max(100).default(""),
      porte_id: z.string().max(50).default(""),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(query);
  const rows = await db
    .prepare(
      "SELECT s.*,p.name porte_name FROM workshop_services s LEFT JOIN labor_portes p ON p.id=s.porte_id WHERE s.tenant_id=? AND s.active=1 AND (?='' OR s.porte_id IS NULL OR s.porte_id=?) AND LOWER(s.name) LIKE LOWER(?) ORDER BY s.name,s.id LIMIT 51 OFFSET ?",
    )
    .all(ctx.tenantId, q.porte_id, q.porte_id, `%${q.q}%`, q.offset);
  return { items: rows.slice(0, 50), has_more: rows.length > 50 };
}
export async function saveWorkshopService(
  db: DB,
  ctx: Context,
  body: unknown,
  record?: string,
) {
  requireAdmin(ctx);
  const v = z
    .object({
      name: z.string().trim().min(2).max(300),
      execution: z.enum(["internal", "outsourced"]),
      porte_id: uuid,
      pricing_mode: z.enum(["time", "price"]),
      minutes: z.number().finite().min(0).max(10000),
      price: cents,
      cost: cents,
    })
    .parse(body);
  if (
    record &&
    !(await db
      .prepare(
        "SELECT id FROM workshop_services WHERE tenant_id=? AND id=? AND active=1",
      )
      .get(ctx.tenantId, record))
  )
    throw new Error("Serviço não encontrado nesta oficina.");
  const rate = Number(
    (
      await db
        .prepare(
          "SELECT hourly_rate FROM labor_rates WHERE tenant_id=? AND porte_id=?",
        )
        .get(ctx.tenantId, v.porte_id)
    )?.hourly_rate || 0,
  );
  if (
    !(await db
      .prepare("SELECT id FROM labor_portes WHERE id=?")
      .get(v.porte_id))
  )
    throw new Error("Escolha o porte do serviço.");
  if (v.execution === "internal") {
    v.cost = 0;
    if (v.pricing_mode === "time") v.price = servicePrice(v.minutes, rate);
    else v.minutes = serviceMinutes(v.price, rate);
  } else
    v.price = outsourcedPrice(
      v.cost,
      (await getPartsPricing(db, ctx.tenantId)).service_markup_bps ?? 3000,
    );
  const key = record || randomUUID();
  if (record)
    await db
      .prepare(
        "UPDATE workshop_services SET name=?,execution=?,porte_id=?,minutes=?,price=?,cost=?,pricing_mode=? WHERE tenant_id=? AND id=?",
      )
      .run(
        v.name,
        v.execution,
        v.porte_id,
        v.minutes,
        v.price,
        v.cost,
        v.pricing_mode,
        ctx.tenantId,
        key,
      );
  else
    await db
      .prepare(
        "INSERT INTO workshop_services(id,tenant_id,name,execution,porte_id,minutes,price,cost,pricing_mode) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        ctx.tenantId,
        v.name,
        v.execution,
        v.porte_id,
        v.minutes,
        v.price,
        v.cost,
        v.pricing_mode,
      );
  return key;
}
export async function resolveService(
  db: DB,
  ctx: Context,
  input: Row,
  prior?: Row,
): Promise<Row> {
  const selected = serviceSelectionSchema.parse(input);
  if (selected.repair_service_id && selected.workshop_service_id)
    throw new Error("Escolha um serviço do catálogo ou da oficina.");
  let snapshot: Row | undefined;
  if (prior?.service_snapshot) {
    const saved = JSON.parse(prior.service_snapshot);
    if (
      (selected.repair_service_id === saved.service_id &&
        selected.repair_model_id === saved.model_id) ||
      (selected.workshop_service_id &&
        selected.workshop_service_id === saved.workshop_service_id)
    )
      snapshot = { ...saved };
  }
  const existing = !!snapshot;
  if (!snapshot && selected.repair_service_id) {
    if (!selected.repair_model_id)
      throw new Error("Confirme o modelo do veículo.");
    snapshot = await withCatalog(db, ctx, async () => {
      const model = await repairModel(db, ctx, selected.repair_model_id!);
      const time = await db
        .prepare(
          "SELECT service_id,service_name,minutes FROM service_catalog.model_services WHERE model_id=? AND service_id=?",
        )
        .get(model.id, selected.repair_service_id);
      if (!time)
        throw new Error("Este serviço não se aplica ao modelo selecionado.");
      const release = await db
        .prepare(
          "SELECT version FROM service_catalog.releases WHERE status='active' ORDER BY imported_at DESC LIMIT 1",
        )
        .get();
      return {
        source: "catalog",
        model_id: model.id,
        model_name: `${model.brand} ${model.name}`,
        porte_id: model.porte_id,
        service_id: time.service_id,
        name: time.service_name,
        minutes: Number(time.minutes),
        catalog_minutes: Number(time.minutes),
        execution: "internal",
        cost: 0,
        release: release!.version,
      };
    });
  } else if (!snapshot && selected.workshop_service_id) {
    const service = await db
      .prepare(
        "SELECT * FROM workshop_services WHERE id=? AND tenant_id=? AND active=1",
      )
      .get(selected.workshop_service_id, ctx.tenantId);
    if (!service) throw new Error("Serviço não encontrado nesta oficina.");
    if (service.porte_id && selected.porte_id !== service.porte_id)
      throw new Error("Este serviço pertence a outro porte.");
    snapshot = {
      source: "manual",
      workshop_service_id: service.id,
      name: service.name,
      porte_id: service.porte_id || selected.porte_id,
      minutes: Number(service.minutes),
      execution: service.execution,
      cost: service.cost,
      pricing_mode: service.pricing_mode,
      fixed_price: service.price,
    };
  }
  if (!snapshot) throw new Error("Escolha um serviço válido.");
  let rate = Number(snapshot.hourly_rate || 0),
    markup = Number(snapshot.markup_bps ?? 3000);
  if (!existing) {
    const porte = await db
      .prepare(
        "SELECT p.name,COALESCE(r.hourly_rate,0) hourly_rate FROM labor_portes p LEFT JOIN labor_rates r ON r.porte_id=p.id AND r.tenant_id=? WHERE p.id=?",
      )
      .get(ctx.tenantId, snapshot.porte_id || "");
    snapshot.porte_name = porte?.name || "";
    rate = Number(porte?.hourly_rate || 0);
    markup =
      (await getPartsPricing(db, ctx.tenantId)).service_markup_bps ?? 3000;
  }
  const execution = selected.service_execution || snapshot.execution;
  let minutes = Number(snapshot.minutes),
    cost =
      execution === "internal"
        ? 0
        : Number(selected.service_cost ?? snapshot.cost);
  let calculated = Number(snapshot.calculated_price || 0);
  if (execution === "outsourced") calculated = outsourcedPrice(cost, markup);
  else if (!existing) {
    if (
      snapshot.source === "manual" &&
      snapshot.pricing_mode === "price" &&
      snapshot.execution === "internal"
    )
      minutes = serviceMinutes(snapshot.fixed_price, rate);
    if (!minutes)
      minutes =
        selected.service_minutes ||
        (selected.manual_price
          ? serviceMinutes(selected.manual_price, rate)
          : 0);
    calculated = servicePrice(minutes, rate);
  } else if (snapshot.execution !== execution) {
    if (!rate)
      rate = Number(
        (
          await db
            .prepare(
              "SELECT hourly_rate FROM labor_rates WHERE tenant_id=? AND porte_id=?",
            )
            .get(ctx.tenantId, snapshot.porte_id || "")
        )?.hourly_rate || 0,
      );
    if (!minutes)
      minutes =
        selected.service_minutes ||
        (selected.manual_price
          ? serviceMinutes(selected.manual_price, rate)
          : 0);
    calculated = servicePrice(minutes, rate);
  }
  snapshot = {
    ...snapshot,
    execution,
    minutes,
    cost,
    hourly_rate: rate,
    markup_bps: markup,
    calculated_price: calculated,
  };
  return {
    ...snapshot,
    price: calculated,
    service_snapshot: JSON.stringify(snapshot),
    kind: "service",
    catalog_id: null,
  };
}
