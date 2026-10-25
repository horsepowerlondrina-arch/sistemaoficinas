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
const accented='áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const plain=accented.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const searchKey=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const searchColumn=(column:string)=>`LOWER(translate(${column},'${accented}','${plain}'))`;
const cents = z.number().int().min(0).max(100000000);
export const commercialCategorySchema = z.enum([
  "compacto",
  "medio",
  "premium",
  "pesado",
]);
export const serviceSelectionSchema = z.object({
  repair_service_id: uuid.optional(),
  repair_model_id: uuid.optional(),
  workshop_service_id: uuid.optional(),
  porte_id: uuid.optional(),
  commercial_category_id: commercialCategorySchema.optional(),
  service_execution: z.enum(["internal", "outsourced"]).optional(),
  service_cost: cents.optional(),
  service_minutes: z.number().finite().min(0).max(10000).optional(),
  manual_price: cents.optional(),
});
async function tenantRead<T>(db: DB, ctx: Context, fn: () => Promise<T>) {
  return db.withTenantRead ? db.withTenantRead(ctx.tenantId, fn) : fn();
}
export function withTenantScope<T>(db: DB, ctx: Context, fn: () => Promise<T>) {
  return tenantRead(db, ctx, fn);
}
export type CatalogAccessState="active"|"not_contracted"|"expired"|"revoked"|"not_installed";
export async function catalogAccessState(db:DB,ctx:Context):Promise<CatalogAccessState>{
  try {
    const row = await db
      .prepare(
        `SELECT a.enabled,a.valid_until,EXISTS(SELECT 1 FROM service_catalog.releases WHERE status='active') catalog_installed
         FROM service_catalog.tenant_access a WHERE a.tenant_id=?`,
      )
      .get(ctx.tenantId);
    if(!row)return "not_contracted";
    if(!(row as any).catalog_installed)return "not_installed";
    if(!(row as any).enabled)return "revoked";
    if((row as any).valid_until&&new Date((row as any).valid_until).getTime()<=Date.now())return "expired";
    return "active";
  } catch (error) {
    if (/no such table/.test(String(error)) || (error as {code?:string}).code==="42P01") return "not_installed";
    throw error;
  }
}
const catalogStatusMessage:Record<Exclude<CatalogAccessState,"active">,string>={
  not_contracted:"O Catálogo Técnico é um módulo adicional e não está habilitado para esta oficina.",
  expired:"O acesso ao Catálogo Técnico venceu. Solicite a renovação à administração da plataforma.",
  revoked:"O acesso ao Catálogo Técnico foi revogado. Seus serviços particulares continuam disponíveis.",
  not_installed:"O Catálogo Técnico ainda não foi instalado neste ambiente.",
};
async function access(db:DB,ctx:Context){return await catalogAccessState(db,ctx)==="active";}
export async function withCatalog<T>(
  db: DB,
  ctx: Context,
  fn: () => Promise<T>,
) {
  return tenantRead(db, ctx, async () => {
    const state=await catalogAccessState(db,ctx);
    if(state!=="active")throw Object.assign(new Error(`${catalogStatusMessage[state]} O catálogo não está liberado para esta oficina.`),{status:state==="not_installed"?503:403});
    return fn();
  });
}
export async function serviceInfo(db: DB, ctx: Context) {
  requireAdmin(ctx);
  const [categories, pricing, catalog_status] = await Promise.all([
    tenantRead(db, ctx, async () =>
      await db.prepare(
        "SELECT c.id,c.name,c.sort_order,COALESCE(r.hourly_rate,0) hourly_rate FROM labor_categories c LEFT JOIN labor_commercial_rates r ON r.category_id=c.id AND r.tenant_id=? ORDER BY c.sort_order",
      ).all(ctx.tenantId),
    ),
    getPartsPricing(db, ctx.tenantId),
    tenantRead(db, ctx, () => catalogAccessState(db, ctx)),
  ]);
  return {
    categories,
    enabled:catalog_status==="active",
    catalog_status,
    service_markup_bps: pricing.service_markup_bps ?? 3000,
  };
}
export async function saveLaborRates(db: DB, ctx: Context, body: unknown) {
  requireAdmin(ctx);
  const rates = z
    .array(z.object({ category_id: commercialCategorySchema, hourly_rate: cents }))
    .max(4)
    .parse(body);
  if (new Set(rates.map((r) => r.category_id)).size !== rates.length)
    throw new Error("Categoria comercial repetida.");
  await tenantRead(db, ctx, async () => {
    for (const rate of rates) {
      if (!rate.hourly_rate) {
        await db
          .prepare("DELETE FROM labor_commercial_rates WHERE tenant_id=? AND category_id=?")
          .run(ctx.tenantId, rate.category_id);
        continue;
      }
      await db
        .prepare(
          "INSERT INTO labor_commercial_rates(tenant_id,category_id,hourly_rate) VALUES(?,?,?) ON CONFLICT(tenant_id,category_id) DO UPDATE SET hourly_rate=excluded.hourly_rate,updated_at=CURRENT_TIMESTAMP",
        )
        .run(ctx.tenantId, rate.category_id, rate.hourly_rate);
    }
  });
}
export async function repairModel(db: DB, ctx: Context, modelId: string) {
  uuid.parse(modelId);
  return withCatalog(db, ctx, async () => {
    const model = await db
      .prepare(
        "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count,lc.category_id commercial_category_id,cat.name commercial_category_name,lc.assignment_source category_assignment_source,lc.review_status category_review_status FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id LEFT JOIN service_catalog.model_labor_categories lc ON lc.model_id=m.id LEFT JOIN labor_categories cat ON cat.id=lc.category_id WHERE m.id=?",
      )
      .get(modelId);
    if (!model)
      throw Object.assign(new Error("Modelo não encontrado no catálogo."), {
        status: 404,
      });
    return model;
  });
}
async function commercialRate(db: DB, ctx: Context, categoryId: string) {
  return tenantRead(db, ctx, async () =>
    Number((await db.prepare(
      "SELECT hourly_rate FROM labor_commercial_rates WHERE tenant_id=? AND category_id=?",
    ).get(ctx.tenantId, categoryId))?.hourly_rate || 0),
  );
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
        `SELECT m.id,m.name,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count,lc.category_id commercial_category_id,cat.name commercial_category_name,lc.assignment_source category_assignment_source,lc.review_status category_review_status FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id LEFT JOIN service_catalog.model_labor_categories lc ON lc.model_id=m.id LEFT JOIN labor_categories cat ON cat.id=lc.category_id WHERE (?='' OR m.fipe_code=?) AND ${searchColumn("b.name || ' ' || m.name")} LIKE ? ORDER BY b.name,m.name,m.id LIMIT 31 OFFSET ?`,
      )
      .all(q.fipe, q.fipe, `%${searchKey(q.q)}%`, q.offset);
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
        `SELECT service_id,service_name name,minutes FROM service_catalog.model_services WHERE model_id=? AND ${searchColumn('service_name')} LIKE ? ORDER BY service_name,service_id LIMIT 51 OFFSET ?`,
      )
      .all(modelId, `%${searchKey(q.q)}%`, q.offset);
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
      category_id: commercialCategorySchema.optional(),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(query);
  const rows = await tenantRead(db, ctx, async () =>
    await db
      .prepare(
        `SELECT s.*,p.name porte_name,COALESCE(s.commercial_category_id,CASE p.name WHEN 'Básico Elétrico' THEN 'compacto' WHEN 'SUV Compacto' THEN 'compacto' WHEN 'SUV Médio' THEN 'medio' WHEN 'SUV e Sedan Elétrico' THEN 'medio' WHEN 'Utilitário Compacto' THEN 'compacto' WHEN 'Utilitário Médio' THEN 'medio' WHEN 'Utilitário Médio Diesel' THEN 'medio' WHEN 'SUV Premium' THEN 'premium' WHEN 'SUV Premium Diesel' THEN 'premium' WHEN 'Utilitário Premium' THEN 'premium' WHEN 'Veículo Compacto' THEN 'compacto' WHEN 'Veículo Médio' THEN 'medio' WHEN 'Veículo Premium' THEN 'premium' WHEN 'Veículo de Luxo' THEN 'premium' END) commercial_category_id FROM workshop_services s LEFT JOIN labor_portes p ON p.id=s.porte_id WHERE s.tenant_id=? AND s.active=1 AND (CAST(? AS TEXT) IS NULL OR COALESCE(s.commercial_category_id,CASE p.name WHEN 'Básico Elétrico' THEN 'compacto' WHEN 'SUV Compacto' THEN 'compacto' WHEN 'SUV Médio' THEN 'medio' WHEN 'SUV e Sedan Elétrico' THEN 'medio' WHEN 'Utilitário Compacto' THEN 'compacto' WHEN 'Utilitário Médio' THEN 'medio' WHEN 'Utilitário Médio Diesel' THEN 'medio' WHEN 'SUV Premium' THEN 'premium' WHEN 'SUV Premium Diesel' THEN 'premium' WHEN 'Utilitário Premium' THEN 'premium' WHEN 'Veículo Compacto' THEN 'compacto' WHEN 'Veículo Médio' THEN 'medio' WHEN 'Veículo Premium' THEN 'premium' WHEN 'Veículo de Luxo' THEN 'premium' END)=CAST(? AS TEXT)) AND ${searchColumn('s.name')} LIKE ? ORDER BY s.name,s.id LIMIT 51 OFFSET ?`,
      )
      .all(ctx.tenantId, q.category_id || null, q.category_id || null, `%${searchKey(q.q)}%`, q.offset),
  );
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
      porte_id: uuid.nullable().optional(),
      commercial_category_id: commercialCategorySchema,
      pricing_mode: z.enum(["time", "price"]),
      minutes: z.number().finite().min(0).max(10000),
      price: cents,
      cost: cents,
    })
    .parse(body);
  return tenantRead(db, ctx, async () => {
  if (
    record &&
    !(await db
      .prepare(
        "SELECT id FROM workshop_services WHERE tenant_id=? AND id=? AND active=1",
      )
      .get(ctx.tenantId, record))
  )
    throw new Error("Serviço não encontrado nesta oficina.");
  const rate = Number((await db
    .prepare("SELECT hourly_rate FROM labor_commercial_rates WHERE tenant_id=? AND category_id=?")
    .get(ctx.tenantId, v.commercial_category_id))?.hourly_rate || 0);
  if (v.porte_id && !(await db.prepare("SELECT id FROM labor_portes WHERE id=?").get(v.porte_id)))
    throw new Error("Porte técnico legado inválido.");
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
        "UPDATE workshop_services SET name=?,execution=?,porte_id=?,commercial_category_id=?,minutes=?,price=?,cost=?,pricing_mode=? WHERE tenant_id=? AND id=?",
      )
      .run(
        v.name,
        v.execution,
        v.porte_id,
        v.commercial_category_id,
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
        "INSERT INTO workshop_services(id,tenant_id,name,execution,porte_id,commercial_category_id,minutes,price,cost,pricing_mode) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        key,
        ctx.tenantId,
        v.name,
        v.execution,
        v.porte_id,
        v.commercial_category_id,
        v.minutes,
        v.price,
        v.cost,
        v.pricing_mode,
      );
  return key;
  });
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
        technical_classification: model.porte_name,
        commercial_category_id: model.commercial_category_id,
        commercial_category_name: model.commercial_category_name,
        category_assignment_source: model.category_assignment_source,
        category_review_status: model.category_review_status,
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
    const service = await tenantRead(db, ctx, async () => await db
      .prepare(
        "SELECT * FROM workshop_services WHERE id=? AND tenant_id=? AND active=1",
      )
      .get(selected.workshop_service_id, ctx.tenantId));
    if (!service) throw new Error("Serviço não encontrado nesta oficina.");
    if (service.porte_id && selected.porte_id !== service.porte_id)
      throw new Error("Este serviço pertence a outro porte.");
    snapshot = {
      source: "manual",
      workshop_service_id: service.id,
      name: service.name,
      porte_id: service.porte_id || selected.porte_id,
      commercial_category_id: service.commercial_category_id,
      commercial_category_name: service.commercial_category_id
        ? (await db.prepare("SELECT name FROM labor_categories WHERE id=?").get(service.commercial_category_id))?.name
        : "",
      minutes: Number(service.minutes),
      execution: service.execution,
      cost: service.cost,
      pricing_mode: service.pricing_mode,
      fixed_price: service.price,
    };
  }
  if (!snapshot) throw new Error("Escolha um serviço válido.");
  let originalCategory = String(snapshot.original_commercial_category_id || snapshot.commercial_category_id || "");
  if (!originalCategory && snapshot.porte_id) {
    originalCategory = String((await db.prepare(
      "SELECT CASE name WHEN 'Básico Elétrico' THEN 'compacto' WHEN 'SUV Compacto' THEN 'compacto' WHEN 'SUV Médio' THEN 'medio' WHEN 'SUV e Sedan Elétrico' THEN 'medio' WHEN 'Utilitário Compacto' THEN 'compacto' WHEN 'Utilitário Médio' THEN 'medio' WHEN 'Utilitário Médio Diesel' THEN 'medio' WHEN 'SUV Premium' THEN 'premium' WHEN 'SUV Premium Diesel' THEN 'premium' WHEN 'Utilitário Premium' THEN 'premium' WHEN 'Veículo Compacto' THEN 'compacto' WHEN 'Veículo Médio' THEN 'medio' WHEN 'Veículo Premium' THEN 'premium' WHEN 'Veículo de Luxo' THEN 'premium' END category_id FROM labor_portes WHERE id=?",
    ).get(snapshot.porte_id))?.category_id || "");
  }
  const categoryId = selected.commercial_category_id || originalCategory;
  if (!categoryId && !existing)
    throw new Error("Este veículo ou serviço não tem categoria comercial definida.");
  const category = categoryId
    ? await db.prepare("SELECT id,name FROM labor_categories WHERE id=?").get(categoryId)
    : undefined;
  if (categoryId && !category) throw new Error("Categoria comercial inválida.");
  const categoryChanged = existing && !!selected.commercial_category_id && categoryId !== String(snapshot.commercial_category_id || "");
  const shouldPersistCategory = !existing || !!snapshot.commercial_category_id || !!selected.commercial_category_id;
  let rate = Number(snapshot.hourly_rate || 0),
    markup = Number(snapshot.markup_bps ?? 3000);
  if (!existing) {
    const porte = snapshot.porte_id
      ? await db.prepare("SELECT name FROM labor_portes WHERE id=?").get(snapshot.porte_id)
      : undefined;
    snapshot.porte_name = porte?.name || "";
    rate = await commercialRate(db, ctx, categoryId);
    markup =
      (await getPartsPricing(db, ctx.tenantId)).service_markup_bps ?? 3000;
  } else if (categoryChanged) {
    rate = await commercialRate(db, ctx, categoryId);
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
  } else if (snapshot.execution !== execution || categoryChanged) {
    if (execution === "internal" && !categoryId)
      throw new Error("Selecione uma categoria comercial para recalcular este serviço.");
    if (!rate)
      rate = await commercialRate(db, ctx, categoryId);
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
    ...(category && shouldPersistCategory ? {
      commercial_category_id: categoryId,
      commercial_category_name: category.name,
      category_override: categoryId !== originalCategory,
      original_commercial_category_id: originalCategory,
      category_assignment_source: categoryId !== originalCategory ? "manual" : snapshot.category_assignment_source || (snapshot.source === "manual" ? "manual" : "automatic"),
      category_review_status: categoryId !== originalCategory ? "confirmed" : snapshot.category_review_status || "confirmed",
    } : {}),
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
