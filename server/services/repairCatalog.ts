import { PORTE_RATE_IDS, porteRateId } from "../../shared/vehiclePorte.js";
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
export const commercialCategorySchema = z.enum(PORTE_RATE_IDS);
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
export type CatalogAccessState="active"|"not_contracted"|"expired"|"revoked"|"not_installed"|"administratively_disabled";
export async function catalogAccessState(db:DB,ctx:Context):Promise<CatalogAccessState>{
  if (ctx.modules?.technical_catalog === false) return "administratively_disabled";
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
  administratively_disabled:"O acesso ao Catálogo Técnico foi desabilitado pela administração da plataforma.",
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
    throw new Error("Porte repetido.");
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
function withModelPorte(model: Row): Row {
  // Compatibility fields expose the tariff key of this same catalog classification.
  const categoryId = porteRateId(model.porte_name);
  if (!categoryId)
    throw Object.assign(new Error("O modelo não possui um dos quatro portes do catálogo atualizado."), { status: 409 });
  return { ...model, classification_id: model.porte_id,
    commercial_category_id: categoryId, commercial_category_name: model.porte_name,
    category_assignment_source: "catalog", category_review_status: "confirmed" };
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
    return withModelPorte(model);
  });
}
async function commercialRate(db: DB, ctx: Context, categoryId: string) {
  return tenantRead(db, ctx, async () =>
    Number((await db.prepare(
      "SELECT hourly_rate FROM labor_commercial_rates WHERE tenant_id=? AND category_id=?",
    ).get(ctx.tenantId, categoryId))?.hourly_rate || 0),
  );
}
export async function searchBrands(db: DB, ctx: Context, query: unknown) {
  const q = z.object({ q: z.string().trim().max(100).default(""), offset: z.coerce.number().int().min(0).max(1000).default(0) }).parse(query);
  return withCatalog(db, ctx, async () => {
    const rows = await db.prepare("SELECT b.id,b.name,(SELECT count(*) FROM service_catalog.models m WHERE m.brand_id=b.id) vehicle_count FROM service_catalog.brands b WHERE " + searchColumn("b.name") + " LIKE ? ORDER BY CASE WHEN " + searchColumn("b.name") + "=? THEN 0 ELSE 1 END,b.name,b.id LIMIT 21 OFFSET ?").all("%" + searchKey(q.q) + "%", searchKey(q.q), q.offset);
    return { items: rows.slice(0, 20), has_more: rows.length > 20 };
  });
}
export async function searchModels(db: DB, ctx: Context, query: unknown) {
  const q = z.object({ brand_id: uuid, q: z.string().trim().max(100).default(""), fipe: z.string().max(20).default(""), preferred: z.string().trim().max(200).default(""), year: z.string().trim().max(10).default(""), offset: z.coerce.number().int().min(0).max(10000).default(0) }).parse(query);
  return withCatalog(db, ctx, async () => {
    const sql = "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE m.brand_id=? AND (" + searchColumn("m.name") + " LIKE ? OR (?<>'' AND m.fipe_code=?) OR (?<>'' AND " + searchColumn("m.name") + " LIKE ?)) ORDER BY CASE WHEN (?<>'' AND m.fipe_code=?) THEN 0 ELSE 1 END,CASE WHEN (?<>'' AND " + searchColumn("m.name") + "=?) THEN 0 ELSE 1 END,CASE WHEN (?<>'' AND " + searchColumn("m.name") + " LIKE ?) THEN 0 ELSE 1 END,CASE WHEN (?<>'' AND " + searchColumn("m.name") + " LIKE ?) THEN 0 ELSE 1 END,CASE WHEN (?<>'' AND " + searchColumn("m.name") + "=?) THEN 0 ELSE 1 END,m.name,m.id LIMIT 31 OFFSET ?";
    const preferredKey = searchKey(q.preferred);
    const yearKey = searchKey(q.year);
    const loadExact = (offset: number) => db.prepare(sql).all(q.brand_id,"%"+searchKey(q.q)+"%",q.fipe,q.fipe,q.preferred,"%"+preferredKey+"%",q.fipe,q.fipe,q.preferred,preferredKey,q.preferred,"%"+preferredKey+"%",q.year,"%"+yearKey+"%",q.q,searchKey(q.q),offset);
    let rows = await loadExact(q.offset);
    if (!rows.length && q.q.trim()) {
      const exactFirstPage = q.offset === 0 ? rows : await loadExact(0);
      if (!exactFirstPage.length) {
        const tokens = searchKey(q.q).split(/\s+/).filter(Boolean);
        const minimumTokens = Math.min(2, tokens.length);
        let fallbackPattern = "";
        let fallbackFirstPage: Row[] = [];
        for (let count = tokens.length - 1; count >= minimumTokens; count--) {
          const pattern = "%" + tokens.slice(0, count).join(" ") + "%";
          const candidates = await db.prepare(
            "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE m.brand_id=? AND " + searchColumn("m.name") + " LIKE ? ORDER BY m.name,m.id LIMIT 31"
          ).all(q.brand_id, pattern);
          if (!candidates.length) continue;
          fallbackPattern = pattern;
          fallbackFirstPage = candidates;
          if (candidates.length > 1) break;
        }
        if (!fallbackPattern && tokens.length === 1) {
          fallbackPattern = "%" + tokens[0] + "%";
          fallbackFirstPage = await db.prepare(
            "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE m.brand_id=? AND " + searchColumn("m.name") + " LIKE ? ORDER BY m.name,m.id LIMIT 31"
          ).all(q.brand_id, fallbackPattern);
        }
        if (fallbackPattern) {
          rows = q.offset === 0 ? fallbackFirstPage : await db.prepare(
            "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id WHERE m.brand_id=? AND " + searchColumn("m.name") + " LIKE ? ORDER BY m.name,m.id LIMIT 31 OFFSET ?"
          ).all(q.brand_id, fallbackPattern, q.offset);
        }
      }
    }
    return { items: rows.slice(0, 30).map(withModelPorte), has_more: rows.length > 30 };
  });
}
const vehicleSearchKey = (value: unknown) =>
  searchKey(String(value || "").trim())
    .replace(/[.,/]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const vehicleBrandKey = (value: unknown) => {
  const key = vehicleSearchKey(value).replace(/^gm\s+/, "");
  return key === "chevrolet gm" ? "chevrolet" : key;
};
const catalogModelSelect = "SELECT m.id,m.name,m.brand_id,m.fipe_code,m.classification_id porte_id,b.name brand,p.name porte_name,m.service_count FROM service_catalog.models m JOIN service_catalog.brands b ON b.id=m.brand_id LEFT JOIN service_catalog.classifications p ON p.id=m.classification_id";
const vehicleMatchInput = z.object({
  brand: z.string().trim().max(150).default(""),
  model: z.string().trim().max(300).default(""),
  year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  fipe_code: z.string().trim().max(20).default(""),
  fipe_model: z.string().trim().max(300).default(""),
  fipe_year_id: z.string().trim().max(30).default(""),
  service_model_id: z.string().trim().max(80).nullable().default("").transform((value) => value || ""),
});
export type VehicleCatalogMatchStatus = "linked" | "matched" | "needs_confirmation" | "not_identified" | "unavailable" | "mismatch";
export type VehicleRecordQuality = "complete" | "incomplete" | "inconsistent";
export type VehicleCatalogReviewStatus = "linked" | "matched" | "ambiguous" | "inconsistent" | "plate_lookup" | "not_identified" | "unavailable" | "not_evaluated";
const modelEngineTokens = (value: string) =>
  [...value.toLowerCase().matchAll(/\b(\d{1,2}(?:[.,]\d)?)\s*(mpfi|mfi|efi|mpi|tsi|tfsi|turbo|hdi|dci|cdti|tdi|16v|8v)?\b/g)]
    .map((match) => `${match[1].replace(",", ".")}${match[2] ? " " + match[2] : ""}`);
const vehicleFeatureTokens = (value: string) =>
  [...value.toLowerCase().matchAll(/\b(2p|3p|4p|5p|hatchback|hatch|sedan|wagon|sw|perua|turbo|aspirado)\b/g)]
    .map((match) => match[1]);
const hasMultipleTechnicalVariants = (value: string) =>
  modelEngineTokens(value).length > 1 || new Set(vehicleFeatureTokens(value)).size > 1;
export async function identifyVehicleModel(db: DB, ctx: Context, input: unknown) {
  const vehicle = vehicleMatchInput.parse(input);
  const accessState = await tenantRead(db, ctx, () => catalogAccessState(db, ctx));
  if (accessState !== "active") return { status: "unavailable" as const, catalog_status: accessState, model: null, candidates: [] };
  const brandKey = vehicleBrandKey(vehicle.brand);
  const rawHints = [...new Set([vehicle.fipe_model, vehicle.model].map((value) => String(value || "").trim()).filter(Boolean))];
  const modelHints = [...new Set(rawHints.map(vehicleSearchKey).filter(Boolean))];
  if (vehicle.service_model_id) {
    if (!uuid.safeParse(vehicle.service_model_id).success) return { status: "mismatch" as const, catalog_status: accessState, model: null, candidates: [] };
    const saved = await db.prepare(catalogModelSelect + " WHERE m.id=?").get(vehicle.service_model_id);
    if (!saved) return { status: "mismatch" as const, catalog_status: accessState, model: null, candidates: [] };
    const model = withModelPorte(saved);
    const brandCompatible = !brandKey || vehicleBrandKey(model.brand) === brandKey;
    const fipeCompatible = !vehicle.fipe_code || !model.fipe_code || String(model.fipe_code) === vehicle.fipe_code;
    const savedName = vehicleSearchKey(model.name);
    const modelCompatible = !modelHints.length || modelHints.some((hint) => savedName === hint || savedName.startsWith(hint) || hint.startsWith(savedName));
    return { status: brandCompatible && fipeCompatible && modelCompatible ? "linked" as const : "mismatch" as const, catalog_status: accessState, model, candidates: [model] };
  }
  if (!brandKey || (!modelHints.length && !vehicle.fipe_code)) return { status: "not_identified" as const, catalog_status: accessState, model: null, candidates: [] };
  const brandPattern = "%" + brandKey.split(" ").filter(Boolean).join("%") + "%";
  const brandMatch = searchColumn("b.name") + " LIKE ?";
  let candidateSetTruncated = false;
  const queryCandidates = async (where: string, values: unknown[], order = "") => {
    const rows = await db.prepare(catalogModelSelect + " WHERE " + brandMatch + " AND (" + where + ") " + order + " LIMIT 102").all(brandPattern, ...values);
    if (rows.length > 101) candidateSetTruncated = true;
    return rows.slice(0, 101).map(withModelPorte);
  };
  const variants = rawHints.flatMap(modelEngineTokens);
  const featureVariants = rawHints.flatMap(vehicleFeatureTokens);
  const hasAmbiguousTechnicalVariants =
    rawHints.some(hasMultipleTechnicalVariants) ||
    new Set(variants).size > 1 ||
    new Set(featureVariants).size > 1;
  const engineCompatible = (name: string) => {
    if (!variants.length) return true;
    const key = vehicleSearchKey(name);
    return variants.some((variant) => {
      const [displacement, code] = variant.split(" ");
      const compact = key.replace(/ /g, "");
      return compact.includes(displacement.replace(".", "")) &&
        (!code || key.includes(code));
    });
  };
  const vehicleFeaturesCompatible = (name: string) => {
    const required = vehicleFeatureTokens(rawHints.join(" "));
    if (!required.length) return true;
    const key = vehicleSearchKey(name);
    return required.every((feature) => key.split(" ").includes(vehicleSearchKey(feature)));
  };
  const technicallyCompatible = (name: string) => engineCompatible(name) && vehicleFeaturesCompatible(name);
  const sortByRelevance = (rows: Row[]) => rows.sort((a, b) => {
    const score = (name: string) => {
      const key = vehicleSearchKey(name);
      const tokens = new Set(key.split(" "));
      return modelHints.reduce((best, hint) => {
        const hintTokens = hint.split(" ").filter(Boolean);
        const overlap = hintTokens.filter((token) => tokens.has(token)).length;
        const prefix = key === hint ? 0 : key.startsWith(hint) ? 1 : key.includes(hint) ? 2 : 4;
        return Math.min(best, prefix * 100 + Math.max(0, hintTokens.length - overlap) * 10);
      }, 10000);
    };
    return score(a.name) - score(b.name) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));
  });
  const byFipe = vehicle.fipe_code
    ? await queryCandidates("m.fipe_code=?", [vehicle.fipe_code], "ORDER BY m.name,m.id")
    : [];
  if (byFipe.length) {
    const candidates = sortByRelevance(byFipe);
    const compatible = candidates.filter((candidate) => !modelHints.length ||
      modelHints.some((hint) => {
        const name = vehicleSearchKey(candidate.name);
        const family = hint.split(" ").slice(0, 2).join(" ");
        return name.includes(family);
      }));
    const technical = compatible.filter((candidate) => technicallyCompatible(String(candidate.name || "")));
    if (technical.length === 1 && compatible.length === 1 && !hasAmbiguousTechnicalVariants && !candidateSetTruncated)
      return { status: "matched" as const, catalog_status: accessState, model: technical[0], candidates: technical };
    const review_reason = modelHints.length && compatible.length === 0
      ? "inconsistent" as const
      : compatible.length > 0 && technical.length === 0 && (variants.length > 0 || featureVariants.length > 0)
        ? "inconsistent" as const
        : "ambiguous" as const;
    return { status: "needs_confirmation" as const, review_reason, catalog_status: accessState, model: null, candidates: sortByRelevance((technical.length ? technical : compatible.length ? compatible : candidates)).slice(0, 10) };
  }
  for (const hint of modelHints) {
    const exact = await queryCandidates(searchColumn("m.name") + "=?", [hint], "ORDER BY m.name,m.id");
    if (exact.length === 1 && !vehicle.fipe_code && !hasAmbiguousTechnicalVariants && !candidateSetTruncated && technicallyCompatible(String(exact[0].name || ""))) {
      return { status: "matched" as const, catalog_status: accessState, model: exact[0], candidates: exact };
    }
    if (exact.length) return { status: "needs_confirmation" as const, review_reason: vehicle.fipe_code ? "inconsistent" as const : "ambiguous" as const, catalog_status: accessState, model: null, candidates: sortByRelevance(exact).slice(0, 10) };
  }
  const primary = modelHints[0];
  const tokens = primary.split(" ").filter(Boolean);
  const progressive: string[] = [];
  for (let length = tokens.length; length >= 2; length--) progressive.push(tokens.slice(0, length).join(" "));
  if (tokens.length) progressive.push(tokens[0]);
  let suggestions: Row[] = [];
  for (const term of [...new Set(progressive)]) {
    if (term.length < 3) continue;
    const found = await queryCandidates(searchColumn("m.name") + " LIKE ?", ["%" + term + "%"], "ORDER BY m.name,m.id");
    const familyToken = tokens[0];
    const familyOnly = found.filter((candidate) => vehicleSearchKey(candidate.name).split(" ")[0] === familyToken);
    if (familyOnly.length) { suggestions = familyOnly; break; }
  }
  if (suggestions.length) {
    const relevant = sortByRelevance(suggestions);
    const compatible = relevant.filter((candidate) => technicallyCompatible(String(candidate.name || "")));
    if (compatible.length === 1 && !vehicle.fipe_code && !hasAmbiguousTechnicalVariants && !candidateSetTruncated)
      return { status: "matched" as const, catalog_status: accessState, model: compatible[0], candidates: compatible };
    return { status: "needs_confirmation" as const, review_reason: vehicle.fipe_code || !compatible.length ? "inconsistent" as const : "ambiguous" as const, catalog_status: accessState, model: null, candidates: (compatible.length ? compatible : relevant).slice(0, 10) };
  }
  return { status: "not_identified" as const, catalog_status: accessState, model: null, candidates: [] };
}
export async function previewVehicleCatalogReview(
  db: DB,
  ctx: Context,
  input: { limit?: number; offset?: number; plateLookupEnabled?: boolean } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit || 20)));
  const offset = Math.max(0, Math.min(100000, Math.trunc(input.offset || 0)));
  const page = await tenantRead(db, ctx, async () => {
    const total = Number((await db.prepare("SELECT COUNT(*) n FROM vehicles WHERE tenant_id=?").get(ctx.tenantId))?.n || 0);
    const rows = await db.prepare(
      "SELECT v.*,c.name customer_name FROM vehicles v JOIN customers c ON c.id=v.customer_id AND c.tenant_id=v.tenant_id WHERE v.tenant_id=? ORDER BY v.plate,v.id LIMIT ? OFFSET ?",
    ).all(ctx.tenantId, limit, offset);
    return { total, rows };
  });
  const items = [];
  for (const vehicle of page.rows) {
    const nonEmpty = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";
    const rawYear = vehicle.year === null || vehicle.year === undefined || String(vehicle.year).trim() === ""
      ? null
      : Number(vehicle.year);
    const yearMissing = rawYear === null || rawYear === 0;
    const validYear = rawYear !== null && Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= 2100;
    const normalizedPlate = typeof vehicle.plate === "string"
      ? vehicle.plate.toUpperCase().replace(/[^A-Z0-9]/g, "")
      : "";
    const rawFipeCode = typeof vehicle.fipe_code === "string" ? vehicle.fipe_code.trim() : "";
    const fipeCodeValid = !rawFipeCode || /^\d{6}-\d$/.test(rawFipeCode);
    const boundedText = (value: unknown, max: number) =>
      typeof value === "string" && value.length <= max ? value.trim() : "";
    const boundedTextInvalid = (value: unknown, max: number) =>
      value !== null && value !== undefined && (typeof value !== "string" || value.length > max);
    const malformedFields =
      boundedTextInvalid(vehicle.plate, 20) ||
      boundedTextInvalid(vehicle.brand, 150) ||
      boundedTextInvalid(vehicle.model, 300) ||
      boundedTextInvalid(vehicle.fipe_code, 20) ||
      boundedTextInvalid(vehicle.fipe_model, 300) ||
      boundedTextInvalid(vehicle.fipe_year_id, 30) ||
      boundedTextInvalid(vehicle.service_model_id, 80);
    const incomplete =
      !nonEmpty(vehicle.plate) || !nonEmpty(vehicle.brand) || !nonEmpty(vehicle.model) || yearMissing;
    const inconsistentFields =
      malformedFields ||
      (!!normalizedPlate && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizedPlate)) ||
      (!!rawFipeCode && !fipeCodeValid) ||
      (!yearMissing && !validYear);
    const match = incomplete
      ? { status: "not_identified", candidates: [] as Row[] }
      : await identifyVehicleModel(db, ctx, {
          brand: boundedText(vehicle.brand, 150),
          model: boundedText(vehicle.model, 300),
          year: validYear ? rawYear : null,
          fipe_code: fipeCodeValid ? boundedText(vehicle.fipe_code, 20) : "",
          fipe_model: boundedText(vehicle.fipe_model, 300),
          fipe_year_id: boundedText(vehicle.fipe_year_id, 30),
          service_model_id: boundedText(vehicle.service_model_id, 80),
        });
    const data_quality: VehicleRecordQuality = incomplete
      ? "incomplete"
      : inconsistentFields || match.status === "mismatch" || ("review_reason" in match && match.review_reason === "inconsistent")
        ? "inconsistent"
        : "complete";
    const catalog_status: VehicleCatalogReviewStatus = incomplete
      ? "not_evaluated"
      : match.status === "linked"
        ? "linked"
        : match.status === "matched"
          ? "matched"
          : match.status === "needs_confirmation"
            ? (("review_reason" in match && match.review_reason === "inconsistent") ? "inconsistent" : "ambiguous")
            : match.status === "mismatch"
              ? "inconsistent"
              : match.status === "unavailable"
                ? "unavailable"
                : match.status === "not_identified" && input.plateLookupEnabled && !vehicle.fipe_code
                  ? "plate_lookup"
                  : "not_identified";
    let status: string;
    if (incomplete) status = "incomplete";
    else if (match.status === "linked") status = "linked";
    else if (match.status === "matched") status = "matched";
    else if (match.status === "needs_confirmation" || match.status === "mismatch") status = "confirmation";
    else if (match.status === "unavailable") status = "unavailable";
    else if (match.status === "not_identified" && input.plateLookupEnabled && !vehicle.fipe_code) status = "plate_lookup";
    else status = "not_identified";
    items.push({ vehicle, status, data_quality, catalog_status, candidates: (match.candidates || []).slice(0, 5) });
  }
  return { items, total: page.total, limit, offset, has_more: offset + items.length < page.total, dry_run: true };
}
export async function confirmVehicleModel(db: DB, ctx: Context, vehicle: { brand?: unknown }, modelId: string) {
  const model = await repairModel(db, ctx, modelId);
  if (vehicleSearchKey(model.brand) !== vehicleSearchKey(vehicle.brand))
    throw Object.assign(new Error("O modelo selecionado pertence a outra marca."), { status: 409 });
  return model;
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
      status: z.enum(["active", "inactive", "all"]).default("active"),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .parse(query);
  const activeFilter = q.status === "all" ? null : q.status === "active" ? 1 : 0;
  const rows = await tenantRead(db, ctx, async () =>
    await db
      .prepare(
        `SELECT s.*,p.name porte_name FROM workshop_services s LEFT JOIN labor_categories p ON p.id=s.commercial_category_id WHERE s.tenant_id=? AND (CAST(? AS INTEGER) IS NULL OR s.active=CAST(? AS INTEGER)) AND (CAST(? AS TEXT) IS NULL OR s.commercial_category_id=CAST(? AS TEXT)) AND ${searchColumn('s.name')} LIKE ? ORDER BY s.name,s.id LIMIT 51 OFFSET ?`,
      )
      .all(ctx.tenantId, activeFilter, activeFilter, q.category_id || null, q.category_id || null, `%${searchKey(q.q)}%`, q.offset),
  );
  return { items: rows.slice(0, 50), has_more: rows.length > 50 };
}
function normalizedWorkshopServiceName(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}
async function assertUniqueWorkshopServiceName(db: DB, tenantId: string, name: string, record?: string) {
  const key = normalizedWorkshopServiceName(name);
  const rows = await db.prepare("SELECT id,name FROM workshop_services WHERE tenant_id=?").all(tenantId);
  if (rows.some((row) => row.id !== record && normalizedWorkshopServiceName(String(row.name)) === key))
    throw new Error("Já existe um serviço com esse nome nesta oficina. Localize e reative o cadastro existente.");
}
export async function setWorkshopServiceActive(db: DB, ctx: Context, record: string, active: boolean) {
  requireAdmin(ctx);
  return tenantRead(db, ctx, async () => {
    const service = await db.prepare("SELECT id,name,active FROM workshop_services WHERE tenant_id=? AND id=?").get(ctx.tenantId, record);
    if (!service) throw new Error("Serviço não encontrado nesta oficina.");
    if (active && !service.active) await assertUniqueWorkshopServiceName(db, ctx.tenantId, String(service.name), record);
    await db.prepare("UPDATE workshop_services SET active=? WHERE tenant_id=? AND id=?").run(active ? 1 : 0, ctx.tenantId, record);
  });
}
export async function saveWorkshopService(
  db: DB,
  ctx: Context,
  body: unknown,
  record?: string,
) {
  requireAdmin(ctx);
  const base = z.object({
    service_type: z.literal("private"),
    name: z.string().trim().min(2).max(300),
    description: z.string().trim().max(1000).optional().default(""),
    price: cents.min(1),
    cost: cents.optional(),
  }).safeParse(body);
  if (base.success) {
    const v = base.data;
    return tenantRead(db, ctx, async () => {
      const current = record
        ? await db.prepare("SELECT id,name,active FROM workshop_services WHERE tenant_id=? AND id=?").get(ctx.tenantId, record)
        : null;
      if (record && !current) throw new Error("Serviço não encontrado nesta oficina.");
      if (!current || normalizedWorkshopServiceName(String(current.name)) !== normalizedWorkshopServiceName(v.name))
        await assertUniqueWorkshopServiceName(db, ctx.tenantId, v.name, record);
      const key = record || randomUUID();
      const costKnown = v.cost !== undefined;
      const cost = v.cost ?? 0;
      if (record) {
        await db.prepare("UPDATE workshop_services SET service_type='private',name=?,name_key=?,description=?,price=?,cost=?,cost_known=? WHERE tenant_id=? AND id=?")
           .run(v.name, normalizedWorkshopServiceName(v.name), v.description, v.price, cost, costKnown ? 1 : 0, ctx.tenantId, key);
      } else {
        await db.prepare("INSERT INTO workshop_services(id,tenant_id,name,name_key,description,service_type,execution,commercial_category_id,minutes,price,cost,cost_known,pricing_mode) VALUES(?,?,?,?,?,'private','internal',NULL,0,?,?,?,'price')")
           .run(key, ctx.tenantId, v.name, normalizedWorkshopServiceName(v.name), v.description, v.price, cost, costKnown ? 1 : 0);
      }
      return key;
    });
  }
  const v = z.object({
    name: z.string().trim().min(2).max(300),
    execution: z.enum(["internal", "outsourced"]),
    porte_id: uuid.nullable().optional(),
    commercial_category_id: commercialCategorySchema,
    pricing_mode: z.enum(["time", "price"]),
    minutes: z.number().finite().min(0).max(10000),
    price: cents,
    cost: cents,
  }).parse(body);
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
  if (v.execution === "internal") {
    v.cost = 0;
    if (v.pricing_mode === "time") v.price = servicePrice(v.minutes, rate);
    else v.minutes = serviceMinutes(v.price, rate);
  } else
    v.price = outsourcedPrice(
      v.cost,
      (await getPartsPricing(db, ctx.tenantId)).service_markup_bps ?? 3000,
    );
  // Legacy porte_id values stay untouched; private services select only a tariff key.
  const key = record || randomUUID();
  if (record)
    await db
      .prepare(
        "UPDATE workshop_services SET name=?,execution=?,commercial_category_id=?,minutes=?,price=?,cost=?,pricing_mode=? WHERE tenant_id=? AND id=?",
      )
      .run(
        v.name,
        v.execution,
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
        "INSERT INTO workshop_services(id,tenant_id,name,description,service_type,execution,commercial_category_id,minutes,price,cost,cost_known,pricing_mode) VALUES(?,?,?,'','legacy',?,?,?,?,?,?,?)",
      )
      .run(
        key,
        ctx.tenantId,
        v.name,
        v.execution,
        v.commercial_category_id,
        v.minutes,
        v.price,
        v.cost,
        1,
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
        classification_id: model.porte_id,
        classification_name: model.porte_name,
        porte_name: model.porte_name,
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
    snapshot = {
      source: "manual",
      workshop_service_id: service.id,
      name: service.name,
      description: service.description || "",
      porte_id: selected.porte_id || null,
      service_type: service.service_type === "private" ? "private" : "legacy",
      cost_known: service.cost_known === undefined ? true : !!service.cost_known,
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
  if (snapshot.source === "manual" && snapshot.service_type === "private") {
    const configuredPrice = Number(snapshot.fixed_price || 0);
    const chargedPrice = Number(selected.manual_price ?? configuredPrice);
    if (!Number.isSafeInteger(chargedPrice) || chargedPrice < 0)
      throw new Error("Informe um preço de venda válido.");
    snapshot = {
      ...snapshot,
      execution: "internal",
      minutes: 0,
      cost: Number(snapshot.cost || 0),
      cost_known: snapshot.cost_known !== false,
      calculated_price: chargedPrice,
      price_override: chargedPrice !== configuredPrice,
    };
    return { ...snapshot, price: chargedPrice, service_snapshot: JSON.stringify(snapshot), kind: "service", catalog_id: null };
  }
  let originalCategory = String(snapshot.original_commercial_category_id || snapshot.commercial_category_id || "");
  const categoryId = selected.commercial_category_id || originalCategory;
  if (!categoryId && !existing)
    throw new Error("Este veículo ou serviço não tem porte definido.");
  const category = categoryId
    ? await db.prepare("SELECT id,name FROM labor_categories WHERE id=?").get(categoryId)
    : undefined;
  if (categoryId && !category) throw new Error("Porte inválido.");
  const categoryChanged = existing && !!selected.commercial_category_id && categoryId !== String(snapshot.commercial_category_id || "");
  const shouldPersistCategory = !existing || !!snapshot.commercial_category_id || !!selected.commercial_category_id;
  let rate = Number(snapshot.hourly_rate || 0),
    markup = Number(snapshot.markup_bps ?? 3000);
  if (!existing) {
    snapshot.porte_name = snapshot.classification_name || snapshot.commercial_category_name || category?.name || "";
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
      throw new Error("Selecione um porte para recalcular este serviço.");
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
