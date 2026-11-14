import {assertOrderVisible} from './userAccess.js';
import { z } from "zod";
import { vehicleDisplayModel } from "../../shared/vehicleIdentity.js";
import type { Context } from "../auth/session.js";
import { transaction, type DB } from "../db/database.js";
import { requireAdmin } from "./payments.js";
import { normalizePlate } from "./vehicleLookup.js";
import { vehicleFipeFields } from "./vehicleFipeFields.js";
import { audit, id, saveOrder, scoped } from "./workshop.js";
import { confirmVehicleModel, catalogAccessState, identifyVehicleModel } from "./repairCatalog.js";

const conditionState = z.enum(["ok", "issue", "unchecked"]);
const damageSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  type: z.enum(["Risco", "Amassado", "Trinca", "Avaria / adicional"]),
  note: z.string().trim().max(200).default(""),
});
const vehicleDataSchema = z.object({
  ...vehicleFipeFields,
  brand: z.string().trim().min(2, "Informe a marca.").max(150),
  model: z.string().trim().min(2, "Informe o modelo.").max(150),
  year: z.number().int().min(1900).max(2100),
  color: z.string().trim().max(80).default(""),
  chassis: z.string().trim().max(100).default(""),
  service_model_id: z.string().uuid().nullable().optional(),
  service_link_mode: z.enum(["", "manual", "auto", "none"]).optional(),
});
const createSchema = z.object({
  order_id: z.string().trim().min(1).nullable().optional(),
  plate: z.string().trim().max(12),
  lookup_source: z.string().trim().max(30).default(""),
  customer_id: z.string().trim().min(1).nullable().optional(),
  customer_name: z.string().trim().max(150).default(""),
  phone: z.string().trim().max(80).default(""),
  vehicle_data: vehicleDataSchema,
  km: z.number().int().min(0).max(2000000).default(0),
  fuel_level: z.number().int().min(0).max(100).default(0),
  inspector: z.string().trim().min(2).max(150),
});
const updateSchema = z.object({
  km: z.number().int().min(0).max(2000000),
  fuel_level: z.number().int().min(0).max(100),
  inspector: z.string().trim().min(2).max(150),
  complaint: z.string().trim().max(4000).default(""),
  conditions: z.record(z.string(), conditionState).default({}),
  accessories_notes: z.string().trim().max(2000).default(""),
  panel_lights: z.record(z.string(), z.boolean()).default({}),
  panel_notes: z.string().trim().max(2000).default(""),
  objects_left: z.string().trim().max(2000).default(""),
  functioning_notes: z.string().trim().max(4000).default(""),
  damages: z.array(damageSchema).max(100).default([]),
  damage_notes: z.string().trim().max(3000).default(""),
  signature_data: z
    .string()
    .max(250000)
    .refine(
      (value) => !value || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value),
      "Assinatura inválida.",
    )
    .default(""),
  signature_absent_reason: z.string().trim().max(500).default(""),
  customer_confirmed: z.boolean().default(false),
});
const photoKind = z.enum([
  "front",
  "rear",
  "left",
  "right",
  "dashboard",
  "damage",
  "other",
]);
const photoMime = z.enum(["image/jpeg", "image/png"]);

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
}
function vehicleLabel(vehicle: Record<string, any>) {
  return [vehicle.brand, vehicleDisplayModel(vehicle), vehicle.color, vehicle.year]
    .filter(Boolean)
    .join(" ");
}
function todaySaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function row(db: DB, ctx: Context, checklistId: string) {
  const value = await db
    .prepare(
      `SELECT k.*,o.number order_number,o.kind order_kind
       FROM checklists k
       LEFT JOIN orders o ON o.id=k.order_id AND o.tenant_id=k.tenant_id
       WHERE k.tenant_id=? AND k.id=?`,
    )
    .get(ctx.tenantId, checklistId);
  if (!value)
    throw Object.assign(new Error("Checklist não encontrado."), { status: 404 });
  return value;
}

async function draft(db: DB, ctx: Context, checklistId: string) {
  const value = await row(db, ctx, checklistId);
  if (value.status !== "draft")
    throw new Error("Checklist finalizado fica disponível somente para consulta.");
  return value;
}

export async function listChecklists(db: DB, ctx: Context) {
  requireAdmin(ctx);
  return db
    .prepare(
      `SELECT k.id,k.order_id,k.customer_id,k.vehicle_id,k.customer_name,k.plate,k.vehicle_label,
              k.km,k.fuel_level,k.inspector,k.status,k.lookup_source,k.created_at,k.updated_at,k.completed_at,
              o.number order_number,o.kind order_kind,
              (SELECT COUNT(*) FROM checklist_photos p
               WHERE p.tenant_id=k.tenant_id AND p.checklist_id=k.id) photo_count
       FROM checklists k
       LEFT JOIN orders o ON o.id=k.order_id AND o.tenant_id=k.tenant_id
       WHERE k.tenant_id=? AND (?=0 OR EXISTS(SELECT 1 FROM order_assignments a JOIN staff_accounts s ON s.tenant_id=a.tenant_id AND s.professional_id=a.professional_id WHERE a.tenant_id=k.tenant_id AND a.order_id=k.order_id AND a.removed_at IS NULL AND s.user_id=?))
       ORDER BY k.created_at DESC`,
    )
    .all(ctx.tenantId,ctx.access?.orderScope==='assigned'?1:0,ctx.userId);
}

export async function getChecklist(
  db: DB,
  ctx: Context,
  checklistId: string,
): Promise<Record<string, any>> {
  requireAdmin(ctx);
  const value = await row(db, ctx, checklistId);
  if(ctx.access?.orderScope==='assigned'){if(!value.order_id)throw Object.assign(new Error('Checklist indisponível.'),{status:404});await assertOrderVisible(db,ctx,String(value.order_id));}
  return {
    ...value,
    conditions: parseJson<Record<string, string>>(value.conditions_json, {}),
    panel_lights: parseJson<Record<string, boolean>>(value.panel_json, {}),
    damages: parseJson<any[]>(value.damages_json, []),
    vehicle_data: parseJson<Record<string, any>>(value.vehicle_data_json, {}),
    customer_confirmed: !!value.customer_confirmed,
    photos: await db
      .prepare(
        "SELECT id,kind,mime,created_at FROM checklist_photos WHERE tenant_id=? AND checklist_id=? ORDER BY created_at,id",
      )
      .all(ctx.tenantId, checklistId),
  };
}

export async function createChecklist(
  db: DB,
  ctx: Context,
  input: unknown,
) {
  requireAdmin(ctx);
  const v = createSchema.parse(input);
  return transaction(db, async () => {
    const plate = normalizePlate(v.plate);
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate))
      throw new Error("Informe uma placa brasileira válida.");

    let order: Record<string, any> | null = null;
    let vehicle: Record<string, any> | null = null;
    let customer: Record<string, any> | null = null;

    if (v.order_id) {
      order = await scoped(db, "orders", ctx.tenantId, v.order_id);
      if (!order.vehicle_id || !order.customer_id)
        throw new Error("O atendimento vinculado precisa ter cliente e veículo.");
      vehicle = await scoped(
        db,
        "vehicles",
        ctx.tenantId,
        String(order.vehicle_id),
      );
      customer = await scoped(
        db,
        "customers",
        ctx.tenantId,
        String(order.customer_id),
      );
      if (normalizePlate(String(vehicle.plate)) !== plate)
        throw new Error("A placa informada não corresponde ao atendimento.");
    } else {
      vehicle =
        (await db
          .prepare(
            "SELECT * FROM vehicles WHERE tenant_id=? AND plate=?",
          )
          .get(ctx.tenantId, plate)) || null;
      if (vehicle)
        customer = await scoped(
          db,
          "customers",
          ctx.tenantId,
          String(vehicle.customer_id),
        );
      else if (v.customer_id)
        customer = await scoped(db, "customers", ctx.tenantId, v.customer_id);
    }

    if (customer && !customer.active)
      throw new Error("O cliente selecionado está inativo.");
    if (vehicle && !vehicle.active)
      throw new Error("O veículo encontrado está inativo.");
    if (!customer && v.customer_name.trim().length < 2)
      throw new Error("Informe o nome do cliente.");

    const vehicleData = vehicle
      ? {
          brand: vehicle.brand,
          model: vehicle.model,
          year: Number(vehicle.year),
          color: vehicle.color || "",
          chassis: vehicle.chassis || "",
          fipe_code: vehicle.fipe_code || "",
          fipe_model: vehicle.fipe_model || "",
          fipe_year_id: vehicle.fipe_year_id || "",
          model_year: vehicle.model_year || null,
          fuel: vehicle.fuel || "",
          service_model_id: v.vehicle_data.service_model_id !== undefined ? v.vehicle_data.service_model_id : vehicle.service_model_id || null,
          service_link_mode: v.vehicle_data.service_link_mode || vehicle.service_link_mode || "",
        }
      : vehicleDataSchema.parse(v.vehicle_data);

    const checklistId = id();
    await db
      .prepare(
        `INSERT INTO checklists(
          id,tenant_id,order_id,customer_id,vehicle_id,customer_name,phone,plate,vehicle_label,
          km,fuel_level,inspector,complaint,lookup_source,vehicle_data_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        checklistId,
        ctx.tenantId,
        order?.id || null,
        customer?.id || null,
        vehicle?.id || null,
        customer?.name || v.customer_name,
        customer?.phone || v.phone || "",
        plate,
        vehicleLabel(vehicleData),
        v.km || Number(order?.km || vehicle?.km || 0),
        v.fuel_level,
        v.inspector,
        order?.problem || "",
        vehicle ? "local" : v.lookup_source || "manual",
        JSON.stringify(vehicleData),
      );
    await audit(db, ctx, "checklist.created", checklistId);
    return { id: checklistId };
  });
}

export async function updateChecklist(
  db: DB,
  ctx: Context,
  checklistId: string,
  input: unknown,
) {
  requireAdmin(ctx);
  const v = updateSchema.parse(input);
  return transaction(db, async () => {
    await draft(db, ctx, checklistId);
    await db
      .prepare(
        `UPDATE checklists SET
          km=?,fuel_level=?,inspector=?,complaint=?,conditions_json=?,accessories_notes=?,
          panel_json=?,panel_notes=?,objects_left=?,functioning_notes=?,damages_json=?,
          damage_notes=?,signature_data=?,signature_absent_reason=?,customer_confirmed=?,updated_at=?
         WHERE tenant_id=? AND id=?`,
      )
      .run(
        v.km,
        v.fuel_level,
        v.inspector,
        v.complaint,
        JSON.stringify(v.conditions),
        v.accessories_notes,
        JSON.stringify(v.panel_lights),
        v.panel_notes,
        v.objects_left,
        v.functioning_notes,
        JSON.stringify(v.damages),
        v.damage_notes,
        v.signature_data,
        v.signature_absent_reason,
        v.customer_confirmed ? 1 : 0,
        new Date().toISOString(),
        ctx.tenantId,
        checklistId,
      );
    await audit(db, ctx, "checklist.updated", checklistId);
    return getChecklist(db, ctx, checklistId);
  });
}

export async function finalizeChecklist(
  db: DB,
  ctx: Context,
  checklistId: string,
): Promise<Record<string, any>> {
  requireAdmin(ctx);
  return transaction(db, async () => {
    const value = await draft(db, ctx, checklistId);
    if (!String(value.inspector || "").trim())
      throw new Error("Informe quem realizou o checklist.");
    if (
      !String(value.signature_data || "") &&
      !String(value.signature_absent_reason || "").trim()
    )
      throw new Error(
        "Registre a assinatura do cliente ou informe o motivo da ausência.",
      );

    let order: Record<string, any> | null = null;
    let customer: Record<string, any> | null = null;
    let vehicle: Record<string, any> | null = null;

    if (value.order_id) {
      order = await scoped(db, "orders", ctx.tenantId, String(value.order_id));
      if (!order.customer_id || !order.vehicle_id)
        throw new Error("O atendimento vinculado não possui cliente e veículo.");
      customer = await scoped(
        db,
        "customers",
        ctx.tenantId,
        String(order.customer_id),
      );
      vehicle = await scoped(
        db,
        "vehicles",
        ctx.tenantId,
        String(order.vehicle_id),
      );
    } else {
      vehicle =
        (await db
          .prepare("SELECT * FROM vehicles WHERE tenant_id=? AND plate=?")
          .get(ctx.tenantId, normalizePlate(String(value.plate)))) || null;

      if (vehicle) {
        customer = await scoped(
          db,
          "customers",
          ctx.tenantId,
          String(vehicle.customer_id),
        );
      } else {
        if (value.customer_id) {
          customer = await scoped(
            db,
            "customers",
            ctx.tenantId,
            String(value.customer_id),
          );
          if (!customer.active)
            throw new Error("O cliente selecionado está inativo.");
        } else {
          const customerName = String(value.customer_name || "").trim();
          if (customerName.length < 2)
            throw new Error("Informe o nome do cliente antes de finalizar.");
          const customerId = id();
          await db
            .prepare(
              `INSERT INTO customers(
                id,tenant_id,name,phone,email,document,birthday,address,notes,active
              ) VALUES(?,?,?,?,?,?,?,?,?,1)`,
            )
            .run(
              customerId,
              ctx.tenantId,
              customerName,
              String(value.phone || ""),
              "",
              "",
              "",
              "",
              "Cadastro criado automaticamente pelo checklist de entrada.",
            );
          await audit(db, ctx, "customers.created_from_checklist", customerId);
          customer = await scoped(db, "customers", ctx.tenantId, customerId);
        }

        const vehicleData = vehicleDataSchema.parse(
          parseJson(value.vehicle_data_json, {}),
        );
        const vehicleId = id();
        await db
          .prepare(
            `INSERT INTO vehicles(
              id,tenant_id,customer_id,plate,brand,model,year,color,km,chassis,fipe_code,fipe_model,fipe_year_id,model_year,fuel,service_link_mode,active
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          )
          .run(
            vehicleId,
            ctx.tenantId,
            customer.id,
            normalizePlate(String(value.plate)),
            vehicleData.brand,
            vehicleData.model,
            vehicleData.year,
            vehicleData.color,
            Number(value.km || 0),
            vehicleData.chassis,
            vehicleData.fipe_code,
            vehicleData.fipe_model,
            vehicleData.fipe_year_id,
            vehicleData.model_year || null,
            vehicleData.fuel || "",
            vehicleData.service_model_id ? "manual" : "none",
          );
        await audit(db, ctx, "vehicles.created_from_checklist", vehicleId);
        vehicle = await scoped(db, "vehicles", ctx.tenantId, vehicleId);
      }
    }

    const vehicleDataRaw: any = parseJson(value.vehicle_data_json, {});
    const requestedModelId = typeof vehicleDataRaw?.service_model_id === "string" && vehicleDataRaw.service_model_id ? z.string().uuid().parse(vehicleDataRaw.service_model_id) : "";
    if (vehicle) {
      let selectedModel: any = null;
      if (requestedModelId && (requestedModelId !== vehicle.service_model_id || vehicleDataRaw.service_link_mode === "manual") && await catalogAccessState(db, ctx) === "active") selectedModel = await confirmVehicleModel(db, ctx, vehicle, requestedModelId);
      if (!value.vehicle_id && !Object.prototype.hasOwnProperty.call(vehicleDataRaw, "service_model_id")) {
        const match = await identifyVehicleModel(db, ctx, vehicleDataRaw);
        if (match.status === "matched") selectedModel = match.model;
      }
      if (selectedModel) {
        await db.prepare("UPDATE vehicles SET service_model_id=?,service_porte_id=?,service_link_mode='manual' WHERE tenant_id=? AND id=?").run(selectedModel.id, selectedModel.porte_id || "", ctx.tenantId, vehicle.id);
        vehicle.service_model_id = selectedModel.id; vehicle.service_porte_id = selectedModel.porte_id || "";
        await audit(db, ctx, requestedModelId ? "vehicles.catalog_link_confirmed" : "vehicles.catalog_link_auto", String(vehicle.id));
      }
    }

    if (vehicle && vehicleDataRaw.service_link_mode === "none" && !requestedModelId) {
      await db.prepare("UPDATE vehicles SET service_model_id='',service_porte_id='',service_link_mode='none' WHERE tenant_id=? AND id=?").run(ctx.tenantId, vehicle.id);
      await audit(db, ctx, "vehicles.catalog_link_removed", String(vehicle.id));
    }
    await db
      .prepare("UPDATE vehicles SET km=? WHERE tenant_id=? AND id=?")
      .run(Number(value.km || 0), ctx.tenantId, vehicle.id);

    let createdQuote = false;
    let orderId = order?.id || "";
    if (!order) {
      const day = todaySaoPaulo();
      orderId = await saveOrder(db, ctx, {
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        guest_name: "",
        guest_plate: "",
        guest_vehicle: "",
        status: "quote",
        entered_on: day,
        due_on: day,
        km: Number(value.km || 0),
        problem: String(value.complaint || ""),
        notes: "Orçamento aberto automaticamente após o checklist de entrada.",
        discount: 0,
        items: [],
      });
      order = await scoped(db, "orders", ctx.tenantId, orderId);
      createdQuote = true;
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE checklists SET
          order_id=?,customer_id=?,vehicle_id=?,customer_name=?,phone=?,plate=?,vehicle_label=?,
          status='completed',completed_at=?,updated_at=?
         WHERE tenant_id=? AND id=?`,
      )
      .run(
        orderId,
        customer.id,
        vehicle.id,
        customer.name,
        customer.phone || "",
        vehicle.plate,
        vehicleLabel(vehicle),
        now,
        now,
        ctx.tenantId,
        checklistId,
      );
    await audit(db, ctx, "checklist.completed", checklistId);

    // A completed checklist is an issued customer document. Capture it in
    // this transaction so its signature and photos cannot drift later.
    const { issueDocument } = await import("./documents.js");
    await issueDocument(db, ctx, "checklist", checklistId, true);

    return {
      ...(await getChecklist(db, ctx, checklistId)),
      created_quote: createdQuote,
      redirect_order_id: orderId,
    };
  });
}

export async function addChecklistPhoto(
  db: DB,
  ctx: Context,
  checklistId: string,
  kindInput: unknown,
  mimeInput: unknown,
  data: Buffer,
) {
  requireAdmin(ctx);
  const kind = photoKind.parse(kindInput);
  const mime = photoMime.parse(mimeInput);
  if (!Buffer.isBuffer(data) || data.length < 100)
    throw new Error("Foto inválida.");
  if (data.length > 1600000)
    throw new Error("A foto ficou muito grande. Tente novamente.");

  return transaction(db, async () => {
    await draft(db, ctx, checklistId);
    const count = Number(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM checklist_photos WHERE tenant_id=? AND checklist_id=?",
          )
          .get(ctx.tenantId, checklistId)
      )?.n || 0,
    );
    if (count >= 40)
      throw new Error("O checklist atingiu o limite de 40 fotos.");

    const photoId = id();
    await db
      .prepare(
        "INSERT INTO checklist_photos(id,tenant_id,checklist_id,kind,mime,image_data) VALUES(?,?,?,?,?,?)",
      )
      .run(
        photoId,
        ctx.tenantId,
        checklistId,
        kind,
        mime,
        data.toString("base64"),
      );
    await db
      .prepare(
        "UPDATE checklists SET updated_at=? WHERE tenant_id=? AND id=?",
      )
      .run(new Date().toISOString(), ctx.tenantId, checklistId);
    await audit(db, ctx, "checklist.photo_added", checklistId);
    return { id: photoId };
  });
}

export async function removeChecklistPhoto(
  db: DB,
  ctx: Context,
  checklistId: string,
  photoId: string,
) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    await draft(db, ctx, checklistId);
    const photo = await db
      .prepare(
        "SELECT id FROM checklist_photos WHERE tenant_id=? AND checklist_id=? AND id=?",
      )
      .get(ctx.tenantId, checklistId, photoId);
    if (!photo) throw new Error("Foto não encontrada neste checklist.");

    await db
      .prepare(
        "DELETE FROM checklist_photos WHERE tenant_id=? AND checklist_id=? AND id=?",
      )
      .run(ctx.tenantId, checklistId, photoId);
    await db
      .prepare(
        "UPDATE checklists SET updated_at=? WHERE tenant_id=? AND id=?",
      )
      .run(new Date().toISOString(), ctx.tenantId, checklistId);
    await audit(db, ctx, "checklist.photo_removed", checklistId);
    return { ok: true };
  });
}

export async function getChecklistPhoto(
  db: DB,
  ctx: Context,
  photoId: string,
) {
  requireAdmin(ctx);
  const photo = await db
    .prepare(
      "SELECT id,mime,image_data FROM checklist_photos WHERE tenant_id=? AND id=?",
    )
    .get(ctx.tenantId, photoId);
  if (!photo)
    throw Object.assign(new Error("Foto não encontrada."), { status: 404 });
  return photo;
}
