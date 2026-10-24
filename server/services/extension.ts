import { categoryKey, productLabel } from "../../shared/productIdentity.js";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, transaction } from "../db/database.js";
import { digest, type Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit, id, invalidateOrderShares, scoped } from "./workshop.js";
import { serviceNameKey } from "./serviceCatalog.js";
import { workshopPrice } from "./partsPricing.js";
import { allocateFreight } from "../../shared/freight.js";
const txt = z.string().trim().max(300).default("");
export const captureSchema = z
  .object({
    capture_id: z.string().uuid(),
    source: z.enum(["sky", "tempario"]),
    name: z.string().trim().min(3).max(300),
    code: txt,
    brand: txt,
    department: txt.optional(),
    application: txt.optional(),
    quantity: z.number().int().min(1).max(1000).default(1),
    cost: z.number().int().min(0).max(100000000).default(0),
    price: z.number().int().min(0).max(100000000).default(0),
    duration_seconds: z.number().int().min(1).max(3600000).optional(),
    vehicle: z
      .object({ plate: txt, make: txt, model: txt, year: txt, engine: txt })
      .default({ plate: "", make: "", model: "", year: "", engine: "" }),
  })
  .superRefine((v, ctx) => {
    if (v.source === "sky" && (!v.code || !v.cost))
      ctx.addIssue({
        code: "custom",
        message: "Confira o código e o custo da peça.",
      });
    if (
      v.source === "tempario" &&
      (!v.duration_seconds || !v.price || v.quantity !== 1)
    )
      ctx.addIssue({
        code: "custom",
        message: "Confira o tempo e o valor do serviço.",
      });
  });
export { legacyPrice as suggestedPrice } from "./partsPricing.js";

async function activeCaptureSession(db: DB, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Object.assign(
      new Error("Conecte a extensão novamente no orçamento."),
      { status: 401 },
    );
  const s = await db
    .prepare(
      `SELECT c.* FROM capture_sessions c JOIN sessions s ON s.token_hash=c.session_hash AND s.user_id=c.user_id AND s.tenant_id=c.tenant_id
      JOIN memberships m ON m.user_id=c.user_id AND m.tenant_id=c.tenant_id
      WHERE c.token_hash=? AND c.expires_at>? AND s.expires_at>? AND m.role='owner'`,
    )
    .get(digest(token), Date.now(), Date.now());
  if (!s)
    throw Object.assign(
      new Error("Conexão expirada. Abra o orçamento e conecte novamente."),
      { status: 401 },
    );
  await db.setRequestIdentity?.(String(s.tenant_id), String(s.user_id));
  const accessState = await db.getTenantAccessState?.(String(s.tenant_id)) || "legacy";
  if (["pending_verification", "read_only", "blocked", "archived"].includes(accessState))
    throw Object.assign(new Error("A oficina não permite operações pela extensão no estado atual."), { status: 403 });
  return s;
}

async function redistributeSkyFreight(
  db: DB,
  ctx: Context,
  session: Record<string, any>,
) {
  const batchId = String(session.batch_id || "");
  const freightTotal = Number(session.freight_total || 0);
  if (!batchId) return { freight_total: freightTotal, item_count: 0 };

  const targetId = String(session.order_id || session.catalog_target || "");
  const targetColumn = session.order_id ? "order_id" : "catalog_target";
  const captures = await db
    .prepare(
      `SELECT * FROM external_captures
       WHERE tenant_id=? AND batch_id=? AND source='sky' AND ${targetColumn}=?
       ORDER BY created_at,id`,
    )
    .all(ctx.tenantId, batchId, targetId);
  if (!captures.length)
    return { freight_total: freightTotal, item_count: 0 };

  const rows = captures.map((capture) => {
    const quantity = Math.max(1, Number(capture.source_quantity || 1));
    const basis = BigInt(Number(capture.source_cost)) * BigInt(quantity);
    return { capture, quantity, basis, share: 0, remainder: 0n };
  });
  const totalBasis = rows.reduce((sum, row) => sum + row.basis, 0n);
  if (totalBasis <= 0n)
    return { freight_total: freightTotal, item_count: rows.length };

  const allocated = allocateFreight(rows.map(row => ({
    id: String(row.capture.id), cost: Number(row.capture.source_cost), quantity: row.quantity,
  })), freightTotal);
  rows.forEach((row,index) => { row.share = allocated[index].freight_total; });

  for (const row of rows) {
    const sourceCost = Number(row.capture.source_cost);
    const freightUnit = Math.round(row.share / row.quantity);
    const landedCost = sourceCost + freightUnit;
    if (landedCost > 100000000)
      throw new Error("Custo com frete acima do limite.");
    const price = await workshopPrice(db, ctx.tenantId, landedCost);
    await db
      .prepare(
        "UPDATE external_captures SET freight_total=?,source_price=? WHERE tenant_id=? AND id=?",
      )
      .run(row.share, price, ctx.tenantId, row.capture.id);
    if (row.capture.item_id || !session.order_id) {
      await db
        .prepare(
          "UPDATE catalog SET cost=?,price=?,cost_known=1,freight_unit=? WHERE tenant_id=? AND id=?",
        )
        .run(
          landedCost,
          price,
          freightUnit,
          ctx.tenantId,
          row.capture.catalog_id,
        );
    }
    if (row.capture.item_id)
      await db
        .prepare(
          "UPDATE order_items SET cost=?,price=? WHERE tenant_id=? AND id=?",
        )
        .run(landedCost, price, ctx.tenantId, row.capture.item_id);
  }

  if (session.order_id) {
    const order = await scoped(db, "orders", ctx.tenantId, session.order_id);
    const subtotal = Number(
      (
        await db
          .prepare(
            "SELECT COALESCE(SUM(price*quantity),0) subtotal FROM order_items WHERE tenant_id=? AND order_id=?",
          )
          .get(ctx.tenantId, session.order_id)
      )?.subtotal || 0,
    );
    await db
      .prepare("UPDATE orders SET total=? WHERE tenant_id=? AND id=?")
      .run(
        Math.max(0, subtotal - Number(order.discount || 0)),
        ctx.tenantId,
        session.order_id,
      );
  }
  return { freight_total: freightTotal, item_count: rows.length };
}

export async function updateCaptureFreight(
  db: DB,
  token: string,
  freightTotal: number,
) {
  freightTotal = z.number().int().min(0).max(100000000).parse(freightTotal);
  return transaction(db, async () => {
    const s = await activeCaptureSession(db, token);
    const ctx: Context = {
      tenantId: String(s.tenant_id),
      userId: String(s.user_id),
      role: "owner",
    };
    await db
      .prepare(
        "UPDATE capture_sessions SET freight_total=? WHERE token_hash=? AND tenant_id=?",
      )
      .run(freightTotal, s.token_hash, ctx.tenantId);
    return redistributeSkyFreight(db, ctx, {
      ...s,
      freight_total: freightTotal,
    });
  });
}

export async function beginCapture(
  db: DB,
  ctx: Context,
  orderId: string,
  sessionToken: string,
  freightTotal = 1750,
  batchId: string = randomUUID(),
) {
  requireAdmin(ctx);
  freightTotal = z.number().int().min(0).max(100000000).parse(freightTotal);
  return transaction(db, async () => {
    const order = await scoped(db, "orders", ctx.tenantId, orderId);
    if (["completed", "cancelled"].includes(order.status))
      throw new Error(
        "A captura está disponível em orçamentos e OS em andamento.",
      );
    const vehicle = order.vehicle_id
      ? await scoped(db, "vehicles", ctx.tenantId, order.vehicle_id)
      : null;
    const plate = String(vehicle?.plate || order?.guest_plate || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    batchId = z.string().uuid().parse(batchId);
    const token = randomBytes(32).toString("hex");
    await db
      .prepare(
        "DELETE FROM capture_sessions WHERE tenant_id=? AND order_id=? OR expires_at<?",
      )
      .run(ctx.tenantId, orderId, Date.now());
    await db
      .prepare(
        "INSERT INTO capture_sessions(token_hash,tenant_id,user_id,session_hash,order_id,expires_at,freight_unit,batch_id,freight_total) VALUES(?,?,?,?,?,?,0,?,?)",
      )
      .run(
        digest(token),
        ctx.tenantId,
        ctx.userId,
        digest(sessionToken),
        orderId,
        Date.now() + 1800000,
        batchId,
        freightTotal,
      );
    return {
      token,
      destination: "order",
      label: `OS #${order.number}`,
      number: order.number,
      plate: /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate) ? plate : "",
      batch_id: batchId,
      freight_total: freightTotal,
      expires_minutes: 30,
    };
  });
}
async function orderCaptureSession(db: DB, ctx: Context, orderId: string) {
  const session = await db
    .prepare(
      "SELECT * FROM capture_sessions WHERE tenant_id=? AND order_id=? ORDER BY expires_at DESC LIMIT 1",
    )
    .get(ctx.tenantId, orderId);
  if (!session)
    throw new Error("Abra a captura novamente antes de alterar os itens.");
  return session;
}

export async function captureState(db: DB, ctx: Context, orderId: string) {
  requireAdmin(ctx);
  const order = await scoped(db, "orders", ctx.tenantId, orderId);
  const items = await db
    .prepare(
      "SELECT i.*,e.duration_seconds,e.source capture_source,e.vehicle_label,e.freight_total capture_freight_total FROM order_items i LEFT JOIN external_captures e ON e.item_id=i.id AND e.tenant_id=i.tenant_id WHERE i.tenant_id=? AND i.order_id=?",
    )
    .all(ctx.tenantId, orderId);
  const session = await db
    .prepare(
      "SELECT * FROM capture_sessions WHERE tenant_id=? AND order_id=? ORDER BY expires_at DESC LIMIT 1",
    )
    .get(ctx.tenantId, orderId);
  const stagedItems = session?.batch_id
    ? await db
        .prepare(
          `SELECT e.id,e.catalog_id,c.kind,c.name,c.brand,c.manufacturer_code,c.application,c.usage_vehicles,c.category,e.source_quantity quantity,e.source_price price,
             CASE
               WHEN e.source='sky' THEN e.source_cost + CAST(ROUND(e.freight_total * 1.0 / e.source_quantity) AS INTEGER)
               ELSE c.cost
             END cost,
             e.source capture_source,1 capture_staged,e.id capture_receipt,
             e.freight_total capture_freight_total,e.duration_seconds
           FROM external_captures e
           JOIN catalog c ON c.id=e.catalog_id AND c.tenant_id=e.tenant_id
           WHERE e.tenant_id=? AND e.order_id=? AND e.batch_id=? AND e.item_id IS NULL
           ORDER BY e.created_at,e.id`,
        )
        .all(ctx.tenantId, orderId, session.batch_id)
    : [];
  return {
    items,
    staged_items: stagedItems,
    total: order.total,
    freight_total: Number(session?.freight_total ?? 1750),
  };
}

export async function updateStagedCaptureItem(
  db: DB,
  ctx: Context,
  orderId: string,
  captureId: string,
  input: unknown,
) {
  requireAdmin(ctx);
  const v = z
    .object({
      quantity: z.number().int().min(0).max(1000).optional(),
      duration_seconds: z.number().int().min(60).max(3600000).optional(),
      remove: z.boolean().optional(),
    })
    .parse(input);
  return transaction(db, async () => {
    await scoped(db, "orders", ctx.tenantId, orderId);
    const session = await orderCaptureSession(db, ctx, orderId);
    const capture = await db
      .prepare(
        "SELECT * FROM external_captures WHERE tenant_id=? AND order_id=? AND id=? AND batch_id=? AND item_id IS NULL",
      )
      .get(ctx.tenantId, orderId, captureId, session.batch_id);
    if (!capture) return captureState(db, ctx, orderId);

    if (v.remove || (capture.source === "sky" && v.quantity === 0)) {
      if (capture.source === "tempario")
        await db
          .prepare(
            "DELETE FROM service_times WHERE tenant_id=? AND capture_id=?",
          )
          .run(ctx.tenantId, capture.capture_id);
      await db
        .prepare(
          "DELETE FROM external_captures WHERE tenant_id=? AND order_id=? AND id=? AND batch_id=? AND item_id IS NULL",
        )
        .run(ctx.tenantId, orderId, captureId, session.batch_id);
    } else if (capture.source === "sky") {
      if (v.quantity === undefined)
        throw new Error("Informe a quantidade da peça.");
      await db
        .prepare(
          "UPDATE external_captures SET source_quantity=? WHERE tenant_id=? AND order_id=? AND id=? AND batch_id=? AND item_id IS NULL",
        )
        .run(v.quantity, ctx.tenantId, orderId, captureId, session.batch_id);
    } else {
      if (v.duration_seconds === undefined)
        throw new Error("Informe o tempo do serviço.");
      const oldDuration = Math.max(1, Number(capture.duration_seconds || 1));
      const newPrice = Math.max(
        0,
        Math.round(
          (Number(capture.source_price || 0) * v.duration_seconds) / oldDuration,
        ),
      );
      await db
        .prepare(
          "UPDATE external_captures SET duration_seconds=?,source_price=? WHERE tenant_id=? AND order_id=? AND id=? AND batch_id=? AND item_id IS NULL",
        )
        .run(
          v.duration_seconds,
          newPrice,
          ctx.tenantId,
          orderId,
          captureId,
          session.batch_id,
        );
      await db
        .prepare(
          "UPDATE service_times SET duration_seconds=?,source_price=? WHERE tenant_id=? AND capture_id=?",
        )
        .run(
          v.duration_seconds,
          newPrice,
          ctx.tenantId,
          capture.capture_id,
        );
    }

    await redistributeSkyFreight(db, ctx, session);
    return captureState(db, ctx, orderId);
  });
}

export async function discardCapture(db: DB, ctx: Context, orderId: string) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    await scoped(db, "orders", ctx.tenantId, orderId);
    const session = await db
      .prepare(
        "SELECT * FROM capture_sessions WHERE tenant_id=? AND order_id=? ORDER BY expires_at DESC LIMIT 1",
      )
      .get(ctx.tenantId, orderId);
    if (session?.batch_id) {
      const captures = await db
        .prepare(
          "SELECT capture_id FROM external_captures WHERE tenant_id=? AND order_id=? AND batch_id=? AND item_id IS NULL",
        )
        .all(ctx.tenantId, orderId, session.batch_id);
      for (const capture of captures)
        await db
          .prepare(
            "DELETE FROM service_times WHERE tenant_id=? AND capture_id=?",
          )
          .run(ctx.tenantId, capture.capture_id);
      await db
        .prepare(
          "DELETE FROM external_captures WHERE tenant_id=? AND order_id=? AND batch_id=? AND item_id IS NULL",
        )
        .run(ctx.tenantId, orderId, session.batch_id);
    }
    await db
      .prepare("DELETE FROM capture_sessions WHERE tenant_id=? AND order_id=?")
      .run(ctx.tenantId, orderId);
    return captureState(db, ctx, orderId);
  });
}

export async function finishCapture(db: DB, ctx: Context, orderId: string) {
  requireAdmin(ctx);
  return transaction(db, async () => {
    const order = await scoped(db, "orders", ctx.tenantId, orderId);
    const session = await db
      .prepare(
        "SELECT * FROM capture_sessions WHERE tenant_id=? AND order_id=? ORDER BY expires_at DESC LIMIT 1",
      )
      .get(ctx.tenantId, orderId);
    if (session?.batch_id) {
      const staged = await db
        .prepare(
          `SELECT e.*,c.kind,c.name,c.brand,c.manufacturer_code,c.cost catalog_cost
           FROM external_captures e
           JOIN catalog c ON c.id=e.catalog_id AND c.tenant_id=e.tenant_id
           WHERE e.tenant_id=? AND e.order_id=? AND e.batch_id=? AND e.item_id IS NULL
           ORDER BY e.created_at,e.id`,
        )
        .all(ctx.tenantId, orderId, session.batch_id);
      const count = await db
        .prepare(
          "SELECT COUNT(*) n FROM order_items WHERE tenant_id=? AND order_id=?",
        )
        .get(ctx.tenantId, orderId);
      if (Number(count?.n) + staged.length > 200)
        throw new Error("O orçamento atingiu o limite de 200 itens.");
      for (const capture of staged) {
        const quantity =
          capture.source === "sky"
            ? Math.max(1, Number(capture.source_quantity || 1))
            : 1;
        const freightUnit =
          capture.source === "sky"
            ? Math.round(Number(capture.freight_total || 0) / quantity)
            : 0;
        const landedCost =
          capture.source === "sky"
            ? Number(capture.source_cost) + freightUnit
            : Number(capture.catalog_cost || 0);
        const price = Number(capture.source_price);
        if (capture.source === "sky")
          await db
            .prepare(
              "UPDATE catalog SET cost=?,price=?,cost_known=1,freight_unit=? WHERE tenant_id=? AND id=?",
            )
            .run(
              landedCost,
              price,
              freightUnit,
              ctx.tenantId,
              capture.catalog_id,
            );
        const itemId = id();
        await db
          .prepare(
            "INSERT INTO order_items(id,tenant_id,order_id,catalog_id,professional_id,kind,name,quantity,price,cost) VALUES(?,?,?,?,NULL,?,?,?,?,?)",
          )
          .run(
            itemId,
            ctx.tenantId,
            orderId,
            capture.catalog_id,
            capture.kind,
            capture.kind === "product" ? productLabel(capture) : capture.name,
            quantity,
            price,
            landedCost,
          );
        await db
          .prepare(
            "UPDATE external_captures SET item_id=? WHERE tenant_id=? AND id=?",
          )
          .run(itemId, ctx.tenantId, capture.id);
        if (capture.source === "tempario") {
          const [make = "", model = "", vehicleYear = "", engine = ""] =
            String(capture.vehicle_label || "").split(" · ");
          await db
            .prepare(
              `INSERT INTO service_times(id,tenant_id,catalog_id,capture_id,source,service_name,make,model,vehicle_year,engine,duration_seconds,source_price)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,capture_id) DO UPDATE SET
                 duration_seconds=excluded.duration_seconds,
                 source_price=excluded.source_price`,
            )
            .run(
              id(),
              ctx.tenantId,
              capture.catalog_id,
              capture.capture_id,
              "Tempario",
              capture.name,
              make,
              model,
              vehicleYear,
              engine,
              capture.duration_seconds,
              capture.source_price,
            );
        }
      }
      const subtotal = Number(
        (
          await db
            .prepare(
              "SELECT COALESCE(SUM(price*quantity),0) subtotal FROM order_items WHERE tenant_id=? AND order_id=?",
            )
            .get(ctx.tenantId, orderId)
        )?.subtotal || 0,
      );
      await db
        .prepare("UPDATE orders SET total=? WHERE tenant_id=? AND id=?")
        .run(
          Math.max(0, subtotal - Number(order.discount || 0)),
          ctx.tenantId,
          orderId,
        );
      if (staged.length)
        await invalidateOrderShares(db, ctx.tenantId, orderId);
    }
    await db
      .prepare("DELETE FROM capture_sessions WHERE tenant_id=? AND order_id=?")
      .run(ctx.tenantId, orderId);
    return captureState(db, ctx, orderId);
  });
}
export async function importCapture(db: DB, token: string, input: unknown) {
  const v = captureSchema.parse(input);
  if(process.env.APP_ENV==='development' && v.source==='tempario')throw new Error('Os serviços agora são adicionados pelo catálogo de tempos ou pelo módulo Serviços da oficina.');
  return transaction(db, async () => {
    const s = await activeCaptureSession(db, token);
    const ctx = {
      tenantId: String(s.tenant_id),
      userId: String(s.user_id),
      role: "owner",
    };
    const order = s.order_id
      ? await scoped(db, "orders", ctx.tenantId, s.order_id)
      : null;
    if (!order && !s.catalog_target)
      throw new Error("Destino da captura inválido.");
    const labelText = order
      ? `OS #${order.number}`
      : "Catálogo";
    if (order && ["completed", "cancelled"].includes(order.status))
      throw new Error("Este atendimento não aceita mais capturas.");
    const hash = digest(JSON.stringify(v));
    const prior = await db
      .prepare(
        "SELECT * FROM external_captures WHERE tenant_id=? AND capture_id=?",
      )
      .get(ctx.tenantId, v.capture_id);
    if (prior) {
      if (
        prior.order_id !== (order?.id ?? null) ||
        prior.catalog_target !== (s.catalog_target ?? null) ||
        prior.payload_hash !== hash
      )
        throw new Error("Identificação de captura já utilizada.");
      return {
        ok: true,
        duplicate: true,
        number: order?.number,
        label: labelText,
      };
    }
    const vehicle = order?.vehicle_id
      ? await scoped(db, "vehicles", ctx.tenantId, order.vehicle_id)
      : null;
    const plateKey = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const targetPlate = plateKey(vehicle?.plate || order?.guest_plate || "");
    if (
      v.vehicle.plate &&
      targetPlate &&
      plateKey(v.vehicle.plate) !== targetPlate
    )
      throw new Error(
        "A placa capturada pertence a outro veículo. Confira o orçamento de destino.",
      );
    const key =
      v.source === "sky"
        ? `${v.code.toUpperCase()}|${v.brand.toUpperCase()}`
        : serviceNameKey(v.name);
    if (!key) throw new Error("Identificação do item inválida.");
    const linked = await db
      .prepare(
        "SELECT catalog_id FROM external_catalog_links WHERE tenant_id=? AND source=? AND external_key=?",
      )
      .get(ctx.tenantId, v.source, key);
    let catalog = linked
      ? await scoped(db, "catalog", ctx.tenantId, linked.catalog_id)
      : undefined;
    if (catalog?.merged_into)
      catalog = await scoped(db, "catalog", ctx.tenantId, catalog.merged_into);
    if (catalog?.archived_at) catalog = undefined;
    if (!catalog && v.source === "tempario") {
      const alias = await db
        .prepare(
          "SELECT a.catalog_id FROM service_aliases a JOIN catalog c ON c.id=a.catalog_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.alias_key=? AND c.archived_at IS NULL",
        )
        .get(ctx.tenantId, key);
      catalog = alias
        ? await scoped(db, "catalog", ctx.tenantId, alias.catalog_id)
        : (
            await db
              .prepare(
                "SELECT * FROM catalog WHERE tenant_id=? AND kind='service' AND merged_into IS NULL AND archived_at IS NULL",
              )
              .all(ctx.tenantId)
          ).find((c) => serviceNameKey(c.name) === key);
    }
    if (catalog && !catalog.active)
      throw new Error(
        "Este item está inativo no catálogo. Reative-o antes de importar.",
      );
    const landedCost = v.cost;
    if (landedCost > 100000000)
      throw new Error("Custo com frete acima do limite.");
    const price =
      v.source === "sky"
        ? await workshopPrice(db, ctx.tenantId, landedCost)
        : v.price;
    if (!catalog) {
      const catalogId = id();
      await db
        .prepare(
          "INSERT INTO catalog(id,tenant_id,kind,name,sku,category,cost,price,stock,minimum_stock,cost_known,stock_verified) VALUES(?,?,?,?,?,?,?,?,0,0,?,0)",
        )
        .run(
          catalogId,
          ctx.tenantId,
          v.source === "sky" ? "product" : "service",
          v.name,
          `EXT-${catalogId.slice(0, 12)}`,
          v.source === "sky" ? "" : "Tempario",
          landedCost,
          price,
          v.source === "sky" ? 1 : 0,
        );
      catalog = await scoped(db, "catalog", ctx.tenantId, catalogId);
    }
    if (v.source === "sky") {
      const contextVehicle = vehicle ? [vehicle.brand,vehicle.model,vehicle.year].filter(Boolean).join(" · ") : String(order?.guest_vehicle || "");
      const usage = [...new Set([...(String(catalog.usage_vehicles || "").split("\n").filter(Boolean)),...(contextVehicle ? [contextVehicle] : [])])].slice(-20).join("\n");
      await db.prepare("UPDATE catalog SET brand=CASE WHEN brand='' THEN ? ELSE brand END,manufacturer_code=CASE WHEN manufacturer_code='' THEN ? ELSE manufacturer_code END,application=CASE WHEN application='' THEN ? ELSE application END,usage_vehicles=? WHERE tenant_id=? AND id=?")
        .run(v.brand,v.code,v.application || "",usage,ctx.tenantId,catalog.id);
      if (v.department) {
        const matches = (await db.prepare("SELECT * FROM product_categories WHERE tenant_id=? AND active=1").all(ctx.tenantId)).filter((c) => categoryKey(c.name)===categoryKey(v.department!));
        if (matches.length===1) await db.prepare("UPDATE catalog SET category=? WHERE tenant_id=? AND id=? AND category_confirmed=0").run(matches[0].name,ctx.tenantId,catalog.id);
      }
      catalog = await scoped(db,"catalog",ctx.tenantId,catalog.id);
    }
    if (v.source === "sky" && !order) {
      await db
        .prepare(
          "UPDATE catalog SET cost=?,price=?,cost_known=1,freight_unit=? WHERE tenant_id=? AND id=?",
        )
        .run(landedCost, price, 0, ctx.tenantId, catalog.id);
      catalog = { ...catalog, cost: landedCost, price };
    }
    await db
      .prepare(
        "INSERT INTO external_catalog_links(tenant_id,source,external_key,catalog_id) VALUES(?,?,?,?) ON CONFLICT(tenant_id,source,external_key) DO UPDATE SET catalog_id=excluded.catalog_id",
      )
      .run(ctx.tenantId, v.source, key, catalog.id);
    // A repeated click never increments quantities silently. Order captures stay staged
    // until the user explicitly concludes the capture.
    let itemId: string | null = null;
    if (order) {
      const same = await db
        .prepare(
          `SELECT id FROM external_captures
           WHERE tenant_id=? AND order_id=? AND source=? AND external_key=?
             AND (item_id IS NOT NULL OR batch_id=?)`,
        )
        .get(ctx.tenantId, order.id, v.source, key, s.batch_id ?? "");
      if (same)
        return {
          ok: true,
          duplicate: true,
          number: order?.number,
          label: labelText,
        };
      const count = await db
        .prepare(
          "SELECT COUNT(*) n FROM order_items WHERE tenant_id=? AND order_id=?",
        )
        .get(ctx.tenantId, order.id);
      const stagedCount = Number(
        (
          await db
            .prepare(
              "SELECT COUNT(*) n FROM external_captures WHERE tenant_id=? AND order_id=? AND batch_id=? AND item_id IS NULL",
            )
            .get(ctx.tenantId, order.id, s.batch_id ?? "")
        )?.n || 0,
      );
      if (Number(count?.n) + stagedCount >= 200)
        throw new Error("O orçamento atingiu o limite de 200 itens.");
      // Order captures remain staged until "Concluir captura".
      itemId = null;
    }
    const label = [
      v.vehicle.make,
      v.vehicle.model,
      v.vehicle.year,
      v.vehicle.engine,
    ]
      .filter(Boolean)
      .join(" · ");
    await db
      .prepare(
        "INSERT INTO external_captures(id,tenant_id,capture_id,order_id,item_id,catalog_id,source,external_key,payload_hash,duration_seconds,source_cost,source_price,vehicle_label,catalog_target,batch_id,source_quantity,freight_total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id(),
        ctx.tenantId,
        v.capture_id,
        order?.id ?? null,
        itemId,
        catalog.id,
        v.source,
        key,
        hash,
        v.duration_seconds ?? null,
        v.cost,
        price,
        label,
        s.catalog_target ?? null,
        s.batch_id ?? null,
        v.quantity,
        0,
      );
    if (v.source === "tempario" && !order)
      await db
        .prepare(
          "INSERT INTO service_times(id,tenant_id,catalog_id,capture_id,source,service_name,make,model,vehicle_year,engine,duration_seconds,source_price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          ctx.tenantId,
          catalog.id,
          v.capture_id,
          "Tempario",
          v.name,
          v.vehicle.make,
          v.vehicle.model,
          v.vehicle.year,
          v.vehicle.engine,
          v.duration_seconds,
          v.price,
        );
    if (v.source === "sky")
      await redistributeSkyFreight(db, ctx, s);
    await audit(db, ctx, "extension.imported", order?.id || s.catalog_target);
    return {
      ok: true,
      duplicate: false,
      number: order?.number,
      label: labelText,
      name: catalog.name,
    };
  });
}

export async function beginCatalogCapture(
  db: DB,
  ctx: Context,
  target: string,
  sessionToken: string,
  freightTotal = 1750,
  batchId: string = randomUUID(),
) {
  requireAdmin(ctx);
  freightTotal = z.number().int().min(0).max(100000000).parse(freightTotal);
  z.string().uuid().parse(target);
  batchId = z.string().uuid().parse(batchId);
  return transaction(db, async () => {
    await db
      .prepare(
        "DELETE FROM capture_sessions WHERE tenant_id=? AND catalog_target=?",
      )
      .run(ctx.tenantId, target);
    const token = randomBytes(32).toString("hex");
    await db
      .prepare(
        "INSERT INTO capture_sessions(token_hash,tenant_id,user_id,session_hash,order_id,catalog_target,expires_at,freight_unit,batch_id,freight_total) VALUES(?,?,?,?,NULL,?,?,0,?,?)",
      )
      .run(
        digest(token),
        ctx.tenantId,
        ctx.userId,
        digest(sessionToken),
        target,
        Date.now() + 1800000,
        batchId,
        freightTotal,
      );
    return {
      token,
      number: 0,
      orderId: target,
      destination: "catalog",
      label: "Catálogo",
      plate: "",
      batch_id: batchId,
      freight_total: freightTotal,
      expires_minutes: 30,
    };
  });
}
export async function catalogCaptureState(
  db: DB,
  ctx: Context,
  target: string,
  finish = false,
) {
  requireAdmin(ctx);
  z.string().uuid().parse(target);
  return transaction(db, async () => {
    const session = await db
      .prepare(
        "SELECT freight_total FROM capture_sessions WHERE tenant_id=? AND catalog_target=? ORDER BY expires_at DESC LIMIT 1",
      )
      .get(ctx.tenantId, target);
    if (finish)
      await db
        .prepare(
          "DELETE FROM capture_sessions WHERE tenant_id=? AND catalog_target=?",
        )
        .run(ctx.tenantId, target);
    const items = await db
      .prepare(
        "SELECT c.*,e.id capture_receipt,e.source capture_source,e.duration_seconds,1 quantity FROM external_captures e JOIN catalog c ON c.id=e.catalog_id AND c.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.catalog_target=? AND c.archived_at IS NULL ORDER BY e.created_at DESC",
      )
      .all(ctx.tenantId, target);
    return {
      items: [...new Map(items.map((i) => [i.id, i])).values()],
      freight_total: Number(session?.freight_total ?? 1750),
    };
  });
}

export async function discardExtensionCapture(db: DB, token: string) {
  return transaction(db, async () => {
    const session = await activeCaptureSession(db, token);
    if (session.order_id) {
      await discardCapture(db, { tenantId: session.tenant_id, userId: session.user_id, role: "owner" }, session.order_id);
    } else {
      await db.prepare("DELETE FROM capture_sessions WHERE token_hash=?").run(digest(token));
    }
    return { ok: true };
  });
}
