import {thirdPartySalePrice} from "../shared/pricing.js";
import { respondAfterCommit } from "./db/responseCommit.js";
import { documentHistory, readDocument, issueDocument, listArchivedDocuments, readArchivedDocument } from "./services/documents.js";
import {
  savePartsPricing,
  workshopPrice,
  getPartsPricing,
} from "./services/partsPricing.js";
import {
  beginCapture,
  beginCatalogCapture,
  catalogCaptureState,
  captureState,
  discardCapture,
  discardExtensionCapture,
  finishCapture,
  importCapture,
  updateCaptureFreight,
  updateStagedCaptureItem,
} from "./services/extension.js";
import { listProductCategories, saveProductCategory, removeProductCategory, validProductCategory } from "./services/productCategories.js";
import { assertUniqueService } from "./services/serviceCatalog.js";
import { createProductBatch } from "./services/productBatch.js";
import { generateExpenses, payExpense } from "./services/expenses.js";
import { createShare, readShare } from "./services/sharing.js";
import {
  addChecklistPhoto,
  createChecklist,
  finalizeChecklist,
  getChecklist,
  getChecklistPhoto,
  listChecklists,
  removeChecklistPhoto,
  updateChecklist,
} from "./services/checklists.js";
import express from "express";
import { randomBytes } from "node:crypto";
import { cancelPasswordReset, completePasswordReset, issuePasswordReset, newPasswordResetToken, passwordResetRequestId, sendPasswordResetEmail, type PasswordResetMailConfig } from "./services/passwordReset.js";
import { z } from "zod";
import { normalizeVehicleModelLink, serviceModelIdSchema } from "./services/vehicleModelLink.js";
import { resolve } from "node:path";
import type { DB } from "./db/database.js";
import { defaultWorkshopModules, moduleForApiRequest, workspaceForModules } from "../shared/workshopModules.js";
import { transaction } from "./db/database.js";
import {
  auth,
  digest,
  startSession,
  tokenFrom,
  verifyPassword,
  hashPassword,
  type Context,
} from "./auth/session.js";
import {
  audit,
  id,
  invalidateOrderShares,
  listOrders,
  mechanicWorkspace,
  previewVehicleCatalogBackfill,
  applyVehicleCatalogBackfill,
  saveOrder,
  scoped,
  settle,
  transitionOrder,
} from "./services/workshop.js";
import { statuses } from "./domain/orders.js";
import {
  configurePlan,
  settleInstallment,
  settleCredit,
  previewReceivableDiscount,
  updateReceivableDiscount,
} from "./services/payments.js";
import {
  cashControl,
  saveCashAccount,
  adjustCash,
} from "./services/cashControl.js";
import { requireAdmin } from "./services/payments.js";
import { previewStockInvoice, importStockInvoice } from "./services/stockInvoices.js";
import { listSuppliers, supplierDetails, saveSupplier } from "./services/suppliers.js";
import { getWorkshopProfile, saveWorkshopProfile } from "./services/workshopProfile.js";
import { listCardMachines, saveCardMachine, resolveCardPayments } from "./services/cardMachines.js";
import { calculatePaymentPlan, paymentMethods } from "./domain/payments.js";
import { lookupVehicle, lookupVehicleExternal, normalizePlate, vehicleLookupAccess } from "./services/vehicleLookup.js";
import { vehicleFipeFields } from "./services/vehicleFipeFields.js";
import { serviceInfo, saveLaborRates, searchBrands, searchModels, repairModel, identifyVehicleModel, catalogAccessState, searchRepairServices, listWorkshopServices, saveWorkshopService, setWorkshopServiceActive, listWorkshopServiceCategories, saveWorkshopServiceCategory, setWorkshopServiceCategoryActive, resolveService, serviceSelectionSchema, withTenantScope, previewVehicleCatalogReview, registrationVehicleModels, confirmRegistrationVehicleModel } from './services/repairCatalog.js';
const text = z.string().trim().max(500).default("");
const name = z
  .string()
  .trim()
  .min(2, "Informe pelo menos 2 caracteres.")
  .max(150);
const integer = z.number().int().min(0).max(100000000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida.");
const schemas = {
  customers: z.object({
    name,
    phone: text,
    email: z.union([z.string().email(), z.literal("")]).default(""),
    document: text,
    birthday: z.union([date, z.literal("")]).default(""),
    address: text,
    notes: text,
    active: z.number().int().min(0).max(1).default(1),
  }),
  vehicles: z.object({
    ...vehicleFipeFields,
    customer_id: z.string().min(1),
    plate: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/[^A-Z0-9]/g, ""))
      .refine(
        (v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v),
        "Informe uma placa brasileira válida.",
      ),
    brand: name,
    model: name,
    year: z.number().int().min(1900).max(2100),
    color: text,
    km: integer,
    chassis: text,
    service_model_id: serviceModelIdSchema,
    service_link_mode: z.enum(["", "manual", "auto", "none"]).optional(),
    active: z.number().int().min(0).max(1).default(1),
  }),
  catalog: z.object({
    kind: z.enum(["product", "service"]),
    name,
    sku: z.string().trim().min(1).max(40),
    category: text,
    brand: z.string().trim().max(300).optional(),
    manufacturer_code: z.string().trim().max(300).optional(),
    application: z.string().trim().max(1000).optional(),
    cost: integer,
    price: integer,
    stock: integer,
    minimum_stock: integer,
    freight_unit: integer.default(0),
    active: z.number().int().min(0).max(1).default(1),
  }),
  professionals: z.object({
    name,
    role: name,
    phone: text,
    email: z.union([z.string().email(), z.literal("")]).default(""),
    active: z.number().int().min(0).max(1).default(1),
  }),
};
const orderSchema = z.object({
  confirm_vehicle_change: z.boolean().optional(),
  service_model_id:z.string().uuid().nullable().optional(),
  service_link_mode:z.enum(["manual", "none"]).optional(),
  customer_id: z.string().nullable().optional(),
  vehicle_id: z.string().nullable().optional(),
  new_customer: z.object({ name, phone: z.string().trim().max(60) }).optional(),
  new_vehicle: schemas.vehicles.omit({ customer_id: true }).optional(),
  status: z.enum(["quote", "open"]).default("open"),
  guest_name: text,
  guest_plate: text,
  guest_vehicle: text,
  entered_on: date,
  due_on: z.union([date, z.literal("")]),
  km: integer,
  problem: text,
  notes: z.string().trim().max(4000).default(""),
  discount: integer,
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        ...serviceSelectionSchema.shape,
        catalog_id: z.string().nullable().optional(),
        professional_id: z.string().nullable().optional(),
        quantity: z.number().int().min(1).max(10000),
        price: integer,
        cost_override: integer.optional(),
        refresh_catalog: z.boolean().optional(),
      }),
    )
    .max(200),
});
const paymentSchema = z.object({
  machine_id: z.string().max(100).optional(),
  pass_card_fee: z.boolean().default(false),
  method: z.enum(paymentMethods),
  installments: z.number().int().min(1).max(24),
  card_fee_bps: z.number().int().min(0).max(10000),
  interest_bps: z.number().int().min(0).max(10000),
  first_due_on: date,
  sale_on: date.optional(),
});
const receiptDiscountSchema = z.object({
  mode: z.enum(["money", "percent"]),
  value: integer,
});
const receiptPlanSchema = z.union([paymentSchema,z.object({payments:z.array(paymentSchema.extend({amount:integer.refine(v=>v>0,"Informe o valor desta forma de pagamento.")})).min(1).max(6)})]);
const receiptPlanRequestSchema = receiptPlanSchema.and(
  z.object({ discount: receiptDiscountSchema.optional() }),
);
function requestSecuritySettings(req: express.Request) {
  const loginEmail = req.path === "/login" && typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  const setupToken = req.path === "/setup" && typeof req.body?.token === "string"
    ? req.body.token
    : "";
  const publicToken = req.path.match(/^\/public\/([a-f0-9]{64})$/)?.[1] || "";
  const extensionToken = /^\/extension\/(discard|import|freight)$/.test(req.path)
    ? req.headers.authorization?.replace(/^Bearer /, "") || ""
    : "";
  return {
    "app.session_hash": digest(tokenFrom(req)),
    "app.login_email": loginEmail,
    "app.login_key": loginEmail ? digest((req.ip || "local") + ":" + loginEmail) : "",
    "app.setup_hash": /^[a-f0-9]{64}$/.test(setupToken) ? digest(setupToken) : "",
    "app.public_share_hash": publicToken ? digest(publicToken) : "",
    "app.extension_hash": /^[a-f0-9]{64}$/.test(extensionToken) ? digest(extensionToken) : "",
  };
}

export function createApp(db: DB, platformAdminApp?: express.RequestHandler, passwordResetMailConfig: PasswordResetMailConfig = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/stock-invoices", express.json({ limit: "3mb" }));
  app.use("/api/workshop-profile", express.json({ limit: "512kb" }));
  app.use("/api/admin-api/workshops/:id/data-transfer", express.json({ limit: "4.25mb" }));
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      let origin;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        res.status(403).json({ error: "Origem inválida." });
        return;
      }
      const extensionRequest =
        ["/extension/import", "/extension/freight"].includes(req.path) &&
        /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin);
      const valid =
        extensionRequest ||
        (process.env.NODE_ENV === "production"
          ? [
              process.env.APP_ORIGIN,
              ...(process.env.APP_ORIGINS || "").split(","),
            ]
              .map((value) => value?.trim())
              .includes(origin.origin)
          : [
              "http://127.0.0.1:5173",
              "http://localhost:5173",
              "http://127.0.0.1:3001",
              "http://localhost:3001",
            ].includes(origin.origin));
      if (!valid) {
        res.status(403).json({ error: "Origem não autorizada." });
        return;
      }
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!db.withRequestContext || req.path.startsWith("/admin-api") || req.path.startsWith("/password-reset/")) {
      next();
      return;
    }
    respondAfterCommit(db, requestSecuritySettings(req), res, next);
  });
  if (process.env.VERCEL) app.set("trust proxy", 1);
  app.post("/api/setup", async (req, res) => {
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z
          .string()
          .min(12, "Use uma senha com pelo menos 12 caracteres.")
          .max(200),
      })
      .parse(req.body);
    await transaction(db, async () => {
      const setup = await db
        .prepare(
          "SELECT * FROM admin_setup WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
        )
        .get(digest(input.token), Date.now());
      if (!setup) throw new Error("Link de ativação inválido ou expirado.");
      await db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(hashPassword(input.password), setup.user_id);
      await db
        .prepare(
          "UPDATE admin_setup SET used_at=? WHERE user_id=? AND used_at IS NULL",
        )
        .run(new Date().toISOString(), setup.user_id);
      await db
        .prepare("DELETE FROM sessions WHERE user_id=?")
        .run(setup.user_id);
    });
    res.json({ ok: true });
  });
  app.post("/api/password-reset/request", async (req, res) => {
    res.set("Referrer-Policy", "no-referrer");
    const input = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Informe um e-mail válido." }); return; }
    if (!(passwordResetMailConfig.apiKey ?? process.env.RESEND_API_KEY) ||
        !(passwordResetMailConfig.from ?? process.env.WORKSHOP_ACTIVATION_FROM) ||
        !(passwordResetMailConfig.appOrigin ?? process.env.APP_ORIGIN)) {
      res.status(503).json({ error: "O envio de e-mail está temporariamente indisponível." }); return;
    }
    const token = newPasswordResetToken(), tokenHash = digest(token);
    const recipient = await issuePasswordReset(db, input.data.email.toLowerCase(), digest(req.ip || "unknown"), tokenHash);
    if (recipient) {
      try {
        await sendPasswordResetEmail({ email: recipient, token, requestId: passwordResetRequestId() }, passwordResetMailConfig);
      } catch {
        try { await cancelPasswordReset(db, tokenHash); }
        catch { console.warn("Não foi possível revogar um link de recuperação não entregue."); }
        console.warn("Falha ao enviar e-mail de recuperação de senha da oficina.");
      }
    }
    res.status(202).json({ message: "Se esse e-mail possui acesso a uma oficina, enviaremos um link para redefinir a senha." });
  });
  app.post("/api/password-reset/complete", async (req, res) => {
    res.set("Referrer-Policy", "no-referrer");
    const input = z.object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(12).max(200),
    }).strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Link inválido ou senha fora dos limites permitidos." }); return; }
    const completed = await completePasswordReset(db, digest(input.data.token), input.data.password);
    if (!completed) { res.status(400).json({ error: "O link é inválido, expirou ou já foi utilizado. Solicite outro." }); return; }
    res.json({ ok: true, message: "Senha alterada. Entre novamente na sua oficina." });
  });
  app.post("/api/login", async (req, res) => {
    const input = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const key = digest((req.ip || "local") + ":" + input.email.toLowerCase());
    const now = Date.now();
    const attempt = await db
      .prepare(
        "INSERT INTO login_attempts(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.until_at<? THEN 1 ELSE login_attempts.count+1 END,until_at=CASE WHEN login_attempts.until_at<? THEN excluded.until_at ELSE login_attempts.until_at END RETURNING count",
      )
      .get(key, now + 300000, now, now);
    if (Number(attempt?.count) > 10) {
      res
        .status(429)
        .json({ error: "Aguarde alguns minutos antes de tentar novamente." });
      return;
    }
    const user = await db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(input.email.toLowerCase());
    if (!user || !verifyPassword(input.password, String(user.password_hash))) {
      res.status(401).json({ error: "E-mail ou senha incorretos." });
      return;
    }
    await db.setRequestIdentity?.("", String(user.id));
    await db
      .prepare("DELETE FROM login_attempts WHERE key=? OR until_at<?")
      .run(key, now);
    const membership = await db
      .prepare(
        "SELECT tenant_id FROM memberships WHERE user_id=? ORDER BY tenant_id LIMIT 1",
      )
      .get(user.id);
    if (!membership) {
      res.status(403).json({ error: "Acesso não habilitado." });
      return;
    }
    await db.setRequestIdentity?.(String(membership.tenant_id), String(user.id));
    await db
      .prepare("DELETE FROM sessions WHERE expires_at<? OR token_hash=?")
      .run(Date.now(), digest(tokenFrom(req)));
    await startSession(db, res, String(user.id), String(membership.tenant_id));
    res.json({ ok: true });
  });
  app.get("/api/public/:token", async (req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");
    const result = await readShare(db, String(req.params.token));
    if (!result) {
      res.status(404).json({ error: "Link indisponível ou expirado." });
      return;
    }
    res.json(result);
  });
  app.post("/api/extension/discard", async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    res.json(await discardExtensionCapture(db, token));
  });
  app.post("/api/extension/import", async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    res.json(await importCapture(db, token, req.body));
  });
  app.post("/api/extension/freight", async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    res.json(
      await updateCaptureFreight(
        db,
        token,
        integer.parse(req.body.freight_total ?? 1750),
      ),
    );
  });
  const workshopAuth = auth(db);
  app.use("/api", (req, res, next) => {
    if (req.path === "/admin-api" || req.path.startsWith("/admin-api/")) {
      next();
      return;
    }
    workshopAuth(req, res, next);
  });
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path.startsWith("/admin-api") || !res.locals.context?.tenantId) {
      next();
      return;
    }
    if (!db.lockTenantMutations) {
      next();
      return;
    }
    void db.lockTenantMutations(String(res.locals.context.tenantId)).then(() => next()).catch(next);
  });
  app.get("/api/session", async (_req, res) => {
    const ctx: Context = res.locals.context;
    res.json({
      user: await db
        .prepare("SELECT id,name,email FROM users WHERE id=?")
        .get(ctx.userId),
      tenant: await db
        .prepare("SELECT * FROM tenants WHERE id=?")
        .get(ctx.tenantId),
      tenants: await db
        .prepare(
          "SELECT t.* FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? ORDER BY t.name",
        )
        .all(ctx.userId),
      role: ctx.role,
      modules: ctx.modules || defaultWorkshopModules,
    });
  });
  app.get("/api/account/plan", async (_req, res) => {
    const ctx: Context = res.locals.context;
    res.json({plan: await db.getTenantPlanSummary?.(ctx.tenantId) ?? null});
  });
  app.post("/api/logout", async (req, res) => {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(digest(tokenFrom(req)));
    res.clearCookie("hp_session", { path: "/" }).json({ ok: true });
  });
  app.post("/api/tenant", async (req, res) => {
    const ctx: Context = res.locals.context;
    const tenant = z.string().parse(req.body.tenant_id);
    if (
      !(await db
        .prepare("SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?")
        .get(ctx.userId, tenant))
    ) {
      res.status(403).json({ error: "Você não tem acesso a esta oficina." });
      return;
    }
    await db.setRequestIdentity?.(tenant, ctx.userId);
    await db
      .prepare("UPDATE sessions SET tenant_id=? WHERE token_hash=?")
      .run(tenant, digest(tokenFrom(req)));
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    if (req.path === "/admin-api" || req.path.startsWith("/admin-api/")) {
      next();
      return;
    }
    if (
      res.locals.context.role === "owner" ||
      (/^\/documents\/order\/[^/]+$/.test(req.path) && ["GET","POST"].includes(req.method)) ||
      (req.method === "GET" && req.path === "/workspace") ||
      (req.method === "POST" && /^\/orders\/[^/]+\/status$/.test(req.path)) ||
      (req.method === "PATCH" && /^\/orders\/[^/]+\/notes$/.test(req.path))
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Esta área é exclusiva do administrador." });
  });
  app.use("/api", (req, res, next) => {
    if (req.path === "/admin-api" || req.path.startsWith("/admin-api/")) { next(); return; }
    const required = moduleForApiRequest(req.path, req.method);
    if (required === null) { res.status(404).json({ error: "Rota indisponível." }); return; }
    const modules = (res.locals.context as Context).modules || defaultWorkshopModules;
    if (required.some((key) => modules[key] === false)) {
      res.status(403).json({ error: "Esta funcionalidade não está habilitada para a oficina." });
      return;
    }
    next();
  });
  // Complete workshop transfers are available only through the separately authenticated central-admin API.
  app.get("/api/workspace", async (_req, res) => {
    const context: Context = res.locals.context;
    const tenant = context.tenantId;
    const modules = context.modules || defaultWorkshopModules;
    if (context.role !== "owner") {
      const workspace = await mechanicWorkspace(db, tenant);
      res.json({ ...workspaceForModules(workspace as Record<string, unknown>, modules), modules });
      return;
    }
    const workspace = {
      catalog_mode:
        (
          await db
            .prepare("SELECT catalog_mode FROM tenants WHERE id=?")
            .get(tenant)
        )?.catalog_mode || "standard",
      parts_pricing: await getPartsPricing(db, tenant),
      installments: await db
        .prepare(
          "SELECT * FROM payment_installments WHERE tenant_id=? ORDER BY sequence",
        )
        .all(tenant),
      payment_settings: (await db
        .prepare("SELECT * FROM payment_settings WHERE tenant_id=?")
        .get(tenant)) || {
        debit_fee_bps: 0,
        credit_fee_bps: 0,
        interest_bps: 0,
      },
      plate_lookup_enabled: (await vehicleLookupAccess(db, tenant)).enabled,
      customers: await db
        .prepare("SELECT * FROM customers WHERE tenant_id=? ORDER BY name")
        .all(tenant),
      vehicles: await db
        .prepare(
          "SELECT v.*,c.name customer_name FROM vehicles v JOIN customers c ON c.id=v.customer_id AND c.tenant_id=v.tenant_id WHERE v.tenant_id=? ORDER BY v.plate",
        )
        .all(tenant),
      suppliers: await listSuppliers(db, res.locals.context),
      product_categories: await listProductCategories(db, res.locals.context),
      catalog: await db
        .prepare(
          "SELECT c.*,(SELECT group_concat(a.alias,' ') FROM service_aliases a WHERE a.tenant_id=c.tenant_id AND a.catalog_id=c.id) search_aliases FROM catalog c WHERE c.tenant_id=? AND c.merged_into IS NULL AND c.archived_at IS NULL ORDER BY c.name",
        )
        .all(tenant),
      professionals: await db
        .prepare("SELECT * FROM professionals WHERE tenant_id=? ORDER BY name")
        .all(tenant),
      card_rates: await db
        .prepare(
          "SELECT * FROM card_rates WHERE tenant_id=? ORDER BY installments",
        )
        .all(tenant),
      orders: await listOrders(db, tenant),
      receivables: await db
        .prepare(
          `SELECT r.*,(SELECT number FROM orders o WHERE o.tenant_id=r.tenant_id AND o.id=r.order_id) order_number,c.name customer_name,CASE WHEN r.plan_configured=0 THEN r.amount ELSE COALESCE((SELECT SUM(gross) FROM payment_installments p WHERE p.tenant_id=r.tenant_id AND p.receivable_id=r.id AND p.status='open'),0) END balance FROM receivables r JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=? ORDER BY r.due_on`,
        )
        .all(tenant),
      cash_accounts: await db
        .prepare("SELECT * FROM cash_accounts WHERE tenant_id=? ORDER BY name")
        .all(tenant),
      cash: await db
        .prepare(
          "SELECT * FROM cash_entries WHERE tenant_id=? ORDER BY created_at",
        )
        .all(tenant),
      movements: await db
        .prepare(
          "SELECT s.*,c.name product_name,u.name user_name FROM stock_movements s JOIN catalog c ON c.id=s.catalog_id AND c.tenant_id=s.tenant_id JOIN users u ON u.id=s.user_id WHERE s.tenant_id=? ORDER BY s.created_at DESC",
        )
        .all(tenant),
    };
    res.json({ ...workspaceForModules(workspace, modules), modules });
  });
  app.get("/api/checklists", async (_req, res) => {
    res.json(await listChecklists(db, res.locals.context));
  });
  app.post("/api/checklists", async (req, res) => {
    res
      .status(201)
      .json(await createChecklist(db, res.locals.context, req.body));
  });
  app.get("/api/checklists/:id", async (req, res) => {
    res.json(await getChecklist(db, res.locals.context, String(req.params.id)));
  });
  app.put("/api/checklists/:id", async (req, res) => {
    res.json(
      await updateChecklist(
        db,
        res.locals.context,
        String(req.params.id),
        req.body,
      ),
    );
  });
  app.post("/api/checklists/:id/finalize", async (req, res) => {
    res.json(
      await finalizeChecklist(db, res.locals.context, String(req.params.id)),
    );
  });
  app.post(
    "/api/checklists/:id/photos",
    express.raw({ type: ["image/jpeg", "image/png"], limit: "2mb" }),
    async (req, res) => {
      res
        .status(201)
        .json(
          await addChecklistPhoto(
            db,
            res.locals.context,
            String(req.params.id),
            req.query.kind,
            req.headers["content-type"]?.split(";")[0],
            req.body,
          ),
        );
    },
  );
  app.delete("/api/checklists/:id/photos/:photoId", async (req, res) => {
    res.json(
      await removeChecklistPhoto(
        db,
        res.locals.context,
        String(req.params.id),
        String(req.params.photoId),
      ),
    );
  });
  app.get("/api/checklist-photos/:photoId", async (req, res) => {
    const photo = await getChecklistPhoto(
      db,
      res.locals.context,
      String(req.params.photoId),
    );
    res.set("Content-Type", String(photo.mime));
    res.set("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(String(photo.image_data), "base64"));
  });

  app.get("/api/expenses", async (_req, res) => {
    const t = res.locals.context.tenantId;
    res.json({
      templates: await db
        .prepare(
          "SELECT * FROM expense_templates WHERE tenant_id=? AND deleted_at IS NULL ORDER BY category,description",
        )
        .all(t),
      payables: await db
        .prepare("SELECT * FROM payables WHERE tenant_id=? ORDER BY due_on")
        .all(t),
    });
  });
  const expenseSchema = z.object({
    description: name,
    supplier: text,
    category: name,
    amount: integer.refine((v) => v > 0),
    due_on: date,
    notes: text,
  });
  app.post("/api/payables", async (req, res) => {
    const ctx: Context = res.locals.context;
    const value = expenseSchema.parse(req.body),
      record = id();
    await db
      .prepare(
        "INSERT INTO payables(id,tenant_id,description,supplier,category,amount,due_on,notes) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        record,
        ctx.tenantId,
        value.description,
        value.supplier,
        value.category,
        value.amount,
        value.due_on,
        value.notes,
      );
    await audit(db, ctx, "expense.created", record);
    res.json({ id: record });
  });
  app.put("/api/payables/:id", async (req, res) => {
    const ctx: Context = res.locals.context;
    const p = await scoped(db, "payables", ctx.tenantId, String(req.params.id));
    if (p.status !== "open")
      throw new Error("Somente contas em aberto podem ser editadas.");
    const v = expenseSchema.parse(req.body);
    await db
      .prepare(
        "UPDATE payables SET description=?,supplier=?,category=?,amount=?,due_on=?,notes=? WHERE tenant_id=? AND id=?",
      )
      .run(
        v.description,
        v.supplier,
        v.category,
        v.amount,
        v.due_on,
        v.notes,
        ctx.tenantId,
        p.id,
      );
    await audit(db, ctx, "expense.updated", p.id);
    res.json({ ok: true });
  });
  app.post("/api/payables/:id/pay", async (req, res) => {
    const value = z
      .object({
        paid_on: date,
        method: name,
        account_id: z.string().min(1).optional(),
      })
      .parse(req.body);
    await payExpense(
      db,
      res.locals.context,
      String(req.params.id),
      value.paid_on,
      value.method,
      value.account_id,
    );
    res.json({ ok: true });
  });
  app.post("/api/payables/:id/cancel", async (req, res) => {
    const ctx: Context = res.locals.context;
    const p = await scoped(db, "payables", ctx.tenantId, String(req.params.id));
    if (p.status !== "open")
      throw new Error("Somente contas em aberto podem ser canceladas.");
    await db
      .prepare(
        "UPDATE payables SET status='cancelled' WHERE tenant_id=? AND id=?",
      )
      .run(ctx.tenantId, p.id);
    await audit(db, ctx, "expense.cancelled", p.id);
    res.json({ ok: true });
  });
  app.post("/api/expenses/generate", async (req, res) => {
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse(req.body.month);
    res.json(await generateExpenses(db, res.locals.context, month));
  });
  const templateSchema = z.object({
    description: name.optional(),
    category: name.optional(),
    supplier: text.optional(),
    amount: integer.nullable(),
    due_day: z.number().int().min(1).max(31),
    remaining_months: z.number().int().min(1).max(600).nullable().optional(),
    start_month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .nullable()
      .optional(),
    source: text.optional(),
    request_id: z.string().uuid().optional(),
    active: z.number().int().min(0).max(1),
  });
  app.post("/api/expense-templates", async (req, res) => {
    const ctx: Context = res.locals.context;
    requireAdmin(ctx);
    const v = templateSchema
        .extend({ description: name, category: name })
        .parse(req.body),
      record = v.request_id || id();
    await transaction(db, async () => {
      const existing = await db
        .prepare("SELECT * FROM expense_templates WHERE tenant_id=? AND id=?")
        .get(ctx.tenantId, record);
      if (existing) {
        const expected = {
          description: v.description,
          category: v.category,
          supplier: v.supplier || "",
          amount: v.amount,
          due_day: v.due_day,
          remaining_months: v.remaining_months ?? null,
          start_month: v.start_month ?? null,
          source: v.source || "",
          active: v.active,
        };
        if (
          existing.deleted_at ||
          !Object.entries(expected).every(
            ([key, value]) => existing[key] === value,
          )
        )
          throw new Error(
            "Este pedido já cadastrou outro gasto. Confira o planejamento antes de repetir.",
          );
        return;
      }
      await db
        .prepare(
          "INSERT INTO expense_templates(id,tenant_id,description,category,supplier,amount,due_day,remaining_months,start_month,source,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          record,
          ctx.tenantId,
          v.description,
          v.category,
          v.supplier || "",
          v.amount,
          v.due_day,
          v.remaining_months ?? null,
          v.start_month ?? null,
          v.source || "",
          v.active,
        );
      await audit(db, ctx, "expense_template.created", record);
    });
    res.status(201).json({ id: record });
  });
  app.put("/api/expense-templates/:id", async (req, res) => {
    const ctx: Context = res.locals.context;
    requireAdmin(ctx);
    const v = templateSchema.parse(req.body);
    await transaction(db, async () => {
      const p = await scoped(
        db,
        "expense_templates",
        ctx.tenantId,
        String(req.params.id),
      );
      if (p.deleted_at) throw new Error("Este gasto recorrente foi excluído.");
      await db
        .prepare(
          "UPDATE expense_templates SET description=?,category=?,supplier=?,amount=?,due_day=?,remaining_months=?,start_month=?,source=?,active=? WHERE tenant_id=? AND id=?",
        )
        .run(
          v.description ?? p.description,
          v.category ?? p.category,
          v.supplier ?? p.supplier,
          v.amount,
          v.due_day,
          v.remaining_months === undefined
            ? p.remaining_months
            : v.remaining_months,
          v.start_month === undefined ? p.start_month : v.start_month,
          v.source ?? p.source,
          v.active,
          ctx.tenantId,
          p.id,
        );
      await audit(db, ctx, "expense_template.updated", p.id);
    });
    res.json({ ok: true });
  });
  app.delete("/api/expense-templates/:id", async (req, res) => {
    const ctx: Context = res.locals.context;
    requireAdmin(ctx);
    await transaction(db, async () => {
      const p = await scoped(
        db,
        "expense_templates",
        ctx.tenantId,
        String(req.params.id),
      );
      await db
        .prepare(
          "UPDATE expense_templates SET active=0,deleted_at=? WHERE tenant_id=? AND id=?",
        )
        .run(new Date().toISOString(), ctx.tenantId, p.id);
      await audit(db, ctx, "expense_template.deleted", p.id);
    });
    res.json({ ok: true });
  });
  const accountSchema = z.object({
    name,
    kind: z.enum(["bank", "cash"]),
    opening_balance: z.number().int().min(-100000000).max(100000000),
    opening_on: date,
    active: z.number().int().min(0).max(1).default(1),
    request_id: z.string().uuid().optional(),
  });
  app.get("/api/cash-control", async (_req, res) =>
    res.json(await cashControl(db, res.locals.context)),
  );
  app.post("/api/cash-accounts", async (req, res) =>
    res
      .status(201)
      .json(
        await saveCashAccount(
          db,
          res.locals.context,
          accountSchema.parse(req.body),
        ),
      ),
  );
  app.put("/api/cash-accounts/:id", async (req, res) =>
    res.json(
      await saveCashAccount(
        db,
        res.locals.context,
        accountSchema.parse(req.body),
        String(req.params.id),
      ),
    ),
  );
  app.post("/api/cash-adjustments", async (req, res) =>
    res.json(
      await adjustCash(
        db,
        res.locals.context,
        z
          .object({
            account_id: z.string().min(1),
            target_balance: z.number().int().min(-100000000).max(100000000),
            reason: z.string().trim().min(3).max(500),
            request_id: z.string().uuid(),
          })
          .parse(req.body),
      ),
    ),
  );
  app.post("/api/orders/:id/capture-session", async (req, res) => {
    res.json(
      await beginCapture(
        db,
        res.locals.context,
        String(req.params.id),
        tokenFrom(req),
        integer.parse(req.body.freight_total ?? req.body.freight_unit ?? 1750),
        z.string().uuid().optional().parse(req.body.batch_id),
      ),
    );
  });
  app.get("/api/orders/:id/capture-state", async (req, res) => {
    res.json(await captureState(db, res.locals.context, String(req.params.id)));
  });
  app.patch("/api/orders/:id/capture-items/:captureId", async (req, res) => {
    res.json(
      await updateStagedCaptureItem(
        db,
        res.locals.context,
        String(req.params.id),
        String(req.params.captureId),
        req.body,
      ),
    );
  });
  app.post("/api/orders/:id/discard-capture", async (req, res) => {
    res.json(
      await discardCapture(db, res.locals.context, String(req.params.id)),
    );
  });
  app.post("/api/orders/:id/end-capture", async (req, res) => {
    res.json(
      await finishCapture(db, res.locals.context, String(req.params.id)),
    );
  });
  app.put("/api/parts-pricing", async (req, res) => {
    await savePartsPricing(db,res.locals.context,req.body);
    res.json({ ok: true });
  });
  app.post("/api/parts-pricing/preview", async (req, res) => {
    const cost = integer.parse(req.body.cost);
    res.json({
      price: req.body.kind === "service"
        ? thirdPartySalePrice(cost, await getPartsPricing(db,res.locals.context.tenantId))
        : await workshopPrice(db, res.locals.context.tenantId, cost),
    });
  });
  app.post("/api/catalog-capture/:id/start", async (req, res) =>
    res.json(
      await beginCatalogCapture(
        db,
        res.locals.context,
        String(req.params.id),
        tokenFrom(req),
        integer.parse(req.body.freight_total ?? req.body.freight_unit ?? 1750),
        z.string().uuid().optional().parse(req.body.batch_id),
      ),
    ),
  );
  app.get("/api/catalog-capture/:id", async (req, res) =>
    res.json(
      await catalogCaptureState(db, res.locals.context, String(req.params.id)),
    ),
  );
  app.post("/api/catalog-capture/:id/end", async (req, res) =>
    res.json(
      await catalogCaptureState(
        db,
        res.locals.context,
        String(req.params.id),
        true,
      ),
    ),
  );
  app.post("/api/orders/:id/share", async (req, res) => {
    const ctx: Context = res.locals.context;
    const record = String(req.params.id);
    res.json({
      ...(await createShare(db, ctx, record)),
      public_origin: process.env.PUBLIC_ORIGIN || "",
    });
  });
  app.post("/api/orders/:id/revoke-share", async (req, res) => {
    const ctx: Context = res.locals.context;
    const record = String(req.params.id);
    await scoped(db, "orders", ctx.tenantId, record);
    await transaction(db, async () => {
      await invalidateOrderShares(db, ctx, record);
    });
    res.json({ ok: true });
  });
  const lookupLimits = new Map<string, { count: number; until: number }>();
  app.post("/api/vehicles/model-options", async (req, res) => {
    requireAdmin(res.locals.context);
    res.json(await registrationVehicleModels(db, res.locals.context, req.body));
  });
  app.post("/api/vehicles/lookup", async (req, res) => {
    const tenant = res.locals.context.tenantId;
    const plate = z.string().max(12).parse(req.body.plate);
    const prior = lookupLimits.get(tenant);
    const entry =
      prior && prior.until > Date.now()
        ? prior
        : { count: 0, until: Date.now() + 60000 };
    if (entry.count >= 20) {
      res
        .status(429)
        .json({ error: "Limite de consultas atingido. Aguarde um minuto." });
      return;
    }
    entry.count++;
    lookupLimits.set(tenant, entry);
    res.json(await lookupVehicle(db, tenant, plate));
  });
  app.post("/api/vehicles/:id/lookup-refresh", async (req, res) => {
    const tenant = res.locals.context.tenantId;
    const prior = lookupLimits.get(tenant);
    const entry = prior && prior.until > Date.now() ? prior : { count: 0, until: Date.now() + 60000 };
    if (entry.count >= 20) {
      res.status(429).json({ error: "Limite de consultas atingido. Aguarde um minuto." });
      return;
    }
    entry.count++;
    lookupLimits.set(tenant, entry);
    const current = await scoped(db, "vehicles", tenant, String(req.params.id));
    const result = await lookupVehicleExternal(db, tenant, String(current.plate));
    let confirmation_token: string | undefined;
    if (result.source === "external" && result.vehicle) {
      confirmation_token = randomBytes(32).toString("hex");
      const fields = ["brand", "model", "year", "model_year", "fuel", "color", "fipe_code", "fipe_model", "fipe_year_id"];
      const baseline = Object.fromEntries(fields.map((field) => [field, current[field]]));
      const storedResult = {
        ...result,
        _confirmation: {
          token: confirmation_token,
          vehicle_id: String(current.id),
          plate: normalizePlate(String(current.plate)),
          baseline,
          expires_at: Date.now() + 10 * 60 * 1000,
        },
      };
      const saved = await db.prepare(
        "UPDATE vehicle_lookup_cache SET result_json=? WHERE tenant_id=? AND plate=? AND expires_at>?"
      ).run(JSON.stringify(storedResult), tenant, normalizePlate(String(current.plate)), Date.now());
      if (Number(saved.changes) !== 1)
        throw Object.assign(new Error("Não foi possível registrar a consulta para confirmação. Tente novamente."), { status: 503 });
    }
    res.json({ ...result, ...(confirmation_token ? { confirmation_token } : {}), current });
  });
  app.post("/api/vehicles/:id/apply-lookup", async (req, res) => {
    const input = z.object({
      confirmation_token: z.string().regex(/^[a-f0-9]{64}$/),
      fields: z.array(z.enum(["brand", "model", "year", "model_year", "fuel", "color", "fipe_code", "fipe_model", "fipe_year_id"])).min(1).max(9),
      fipe_candidate_index: z.number().int().min(0).max(999).nullable().optional(),
    }).strict().parse(req.body);
    const fields = [...new Set(input.fields)];
    const tenant = res.locals.context.tenantId;
    const vehicleId = String(req.params.id);
    const rejectConfirmation = (message: string) => Object.assign(new Error(message), { status: 409 });
    const current = await scoped(db, "vehicles", tenant, vehicleId);
    if (!(await vehicleLookupAccess(db, tenant)).enabled) {
      res.status(403).json({error:"A consulta externa de placas não está autorizada ou configurada para esta oficina."}); return;
    }
    const plate = normalizePlate(String(current.plate));
    const cached = await db.prepare(
      "SELECT result_json FROM vehicle_lookup_cache WHERE tenant_id=? AND plate=? AND expires_at>?"
    ).get(tenant, plate, Date.now()) as { result_json?: string } | undefined;
    if (!cached?.result_json)
      throw rejectConfirmation("A consulta expirou ou não pertence a este veículo. Consulte a placa novamente.");
    let storedResult: any;
    try { storedResult = JSON.parse(cached.result_json); } catch {
      throw rejectConfirmation("A consulta não pode ser confirmada. Consulte a placa novamente.");
    }
    const proof = storedResult?._confirmation;
    if (!proof || proof.token !== input.confirmation_token || proof.expires_at <= Date.now() ||
        proof.vehicle_id !== vehicleId || proof.plate !== plate)
      throw rejectConfirmation("A consulta expirou ou não pertence a este veículo. Consulte a placa novamente.");
    const { _confirmation: _discardConfirmation, ...result } = storedResult;
    for (const field of fields)
      if (current[field] !== proof.baseline[field])
        throw rejectConfirmation("Os dados selecionados mudaram após a consulta. Consulte novamente.");
    const sourceValues: Record<string, unknown> = { ...result.vehicle };
    if (input.fipe_candidate_index !== undefined && input.fipe_candidate_index !== null) {
      const candidate = result.fipe_candidates?.[input.fipe_candidate_index];
      if (!candidate?.codigoFipe)
        throw rejectConfirmation("A versão FIPE selecionada não pertence à consulta.");
      sourceValues.fipe_code = candidate.codigoFipe;
      sourceValues.fipe_model = candidate.modelo || "";
      sourceValues.fipe_year_id = candidate.anoId || "";
      sourceValues.model_year = candidate.anoModelo || null;
      sourceValues.fuel = candidate.combustivel || "";
    }
    const selectedValues = Object.fromEntries(fields.map((field) => [field, sourceValues[field]]));
    for (const field of fields)
      if (!Object.prototype.hasOwnProperty.call(sourceValues, field) || sourceValues[field] === undefined || sourceValues[field] === null)
        throw rejectConfirmation("A consulta não retornou todos os campos selecionados.");
    const values = z.object({
      brand: z.string().trim().min(2).max(150).optional(),
      model: z.string().trim().min(2).max(150).optional(),
      year: z.number().int().min(1900).max(2100).optional(),
      model_year: z.number().int().min(1900).max(2100).nullable().optional(),
      fuel: z.string().trim().max(80).optional(),
      color: z.string().trim().max(80).optional(),
      fipe_code: z.string().trim().regex(/^(?:\d{6}-\d)?$/).optional(),
      fipe_model: z.string().trim().max(300).optional(),
      fipe_year_id: z.string().trim().regex(/^(?:(?:19|20|21)\d{2}-\d{1,2}|32000-\d{1,2})?$/).optional(),
    }).partial().strict().parse(selectedValues);
    await transaction(db, async () => {
      const latest = await scoped(db, "vehicles", tenant, vehicleId);
      if (normalizePlate(String(latest.plate)) !== plate || fields.some((field) => latest[field] !== proof.baseline[field]))
        throw rejectConfirmation("Os dados selecionados mudaram após a consulta. Consulte novamente.");
      const consumed = await db.prepare(
        "UPDATE vehicle_lookup_cache SET result_json=? WHERE tenant_id=? AND plate=? AND result_json=? AND expires_at>?"
      ).run(JSON.stringify(result), tenant, plate, cached.result_json, Date.now());
      if (Number(consumed.changes) !== 1)
        throw rejectConfirmation("A consulta já foi utilizada ou atualizada. Consulte novamente.");
      const before = Object.fromEntries(fields.map((field) => [field, latest[field]]));
      const assignments = fields.map((field) => field + "=?").join(",");
      await db.prepare("UPDATE vehicles SET " + assignments + " WHERE tenant_id=? AND id=?")
         .run(...fields.map((field) => values[field as keyof typeof values]), tenant, vehicleId);
      const after = Object.fromEntries(fields.map((field) => [field, values[field as keyof typeof values]]));
      const auditMetadataSaved = await audit(db, res.locals.context, "vehicles.external_lookup_updated", vehicleId, {
        source: result.source,
        updated_fields: fields,
        before,
        after,
      });
      if (!auditMetadataSaved)
        throw Object.assign(
          new Error("A confirmação de dados do veículo ficará disponível após a migração de auditoria."),
          { status: 503 },
        );
    });
    res.json({ ok: true });
  });
  app.get("/api/vehicles/catalog-review", async (req, res) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(req.query);
    res.json(await previewVehicleCatalogReview(db, res.locals.context, {
      ...query,
      plateLookupEnabled: (await vehicleLookupAccess(db, res.locals.context.tenantId)).enabled,
    }));
  });
  app.get('/api/repair-services/access', async (_req, res) => {
    const catalog_status = await catalogAccessState(db, res.locals.context);
    res.json({ enabled: catalog_status === "active", catalog_status, categories: [], service_markup_bps: 0 });
  });
  app.get('/api/repair-services/config',async(_req,res)=>res.json(await serviceInfo(db,res.locals.context)));
  app.put('/api/repair-services/rates',async(req,res)=>{
    await transaction(db,async()=>{await saveLaborRates(db,res.locals.context,req.body.rates);await audit(db,res.locals.context,'labor_rates.updated',res.locals.context.tenantId);});res.json({ok:true});
  });
  app.post('/api/repair-services/identify-model',async(req,res)=>res.json(await identifyVehicleModel(db,res.locals.context,req.body.vehicle || req.body)));
  app.post('/api/vehicles/catalog-backfill/preview',async(req,res)=>{ requireAdmin(res.locals.context); const input=z.object({limit:z.number().int().min(1).max(500).optional(),cursor:z.string().max(80).optional()}).parse(req.body||{}); res.json(await previewVehicleCatalogBackfill(db,res.locals.context,input.limit,input.cursor)); });
  app.post('/api/vehicles/catalog-backfill/apply',async(req,res)=>{ requireAdmin(res.locals.context); const input=z.object({limit:z.number().int().min(1).max(50).optional(),cursor:z.string().max(80).optional()}).parse(req.body||{}); res.json(await applyVehicleCatalogBackfill(db,res.locals.context,input.limit,input.cursor)); });
  app.get('/api/repair-services/brands',async(req,res)=>res.json(await searchBrands(db,res.locals.context,req.query)));
  app.get('/api/repair-services/models',async(req,res)=>res.json(await searchModels(db,res.locals.context,req.query)));
  app.get('/api/repair-services/models/:id',async(req,res)=>res.json(await repairModel(db,res.locals.context,String(req.params.id))));
  app.get('/api/repair-services/models/:id/services',async(req,res)=>res.json(await searchRepairServices(db,res.locals.context,String(req.params.id),req.query)));
  app.get('/api/workshop-services',async(req,res)=>res.json(await listWorkshopServices(db,res.locals.context,req.query)));
  app.post('/api/workshop-services',async(req,res)=>res.json({id:await transaction(db,async()=>{const key=await saveWorkshopService(db,res.locals.context,req.body);await audit(db,res.locals.context,'workshop_service.created',key);return key;})}));
  app.put('/api/workshop-services/:id',async(req,res)=>res.json({id:await transaction(db,async()=>{const key=await saveWorkshopService(db,res.locals.context,req.body,String(req.params.id));await audit(db,res.locals.context,'workshop_service.updated',key);return key;})}));
  app.delete('/api/workshop-services/:id',async(req,res)=>{
    await transaction(db,async()=>withTenantScope(db,res.locals.context,async()=>{await scoped(db,'workshop_services',res.locals.context.tenantId,String(req.params.id));await db.prepare('UPDATE workshop_services SET active=0 WHERE tenant_id=? AND id=?').run(res.locals.context.tenantId,String(req.params.id));await audit(db,res.locals.context,'workshop_service.removed',String(req.params.id));}));res.json({ok:true});
  });
  app.patch('/api/workshop-services/:id/status',async(req,res)=>{
    const input=z.object({active:z.boolean()}).parse(req.body);
    await transaction(db,async()=>{await setWorkshopServiceActive(db,res.locals.context,String(req.params.id),input.active);await audit(db,res.locals.context,input.active?'workshop_service.reactivated':'workshop_service.inactivated',String(req.params.id));});
    res.json({ok:true});
  });
  app.get('/api/workshop-service-categories',async(req,res)=>res.json(await listWorkshopServiceCategories(db,res.locals.context,req.query)));
  app.post('/api/workshop-service-categories',async(req,res)=>res.json({id:await transaction(db,async()=>{const id=await saveWorkshopServiceCategory(db,res.locals.context,req.body);await audit(db,res.locals.context,'workshop_service_category.created',id);return id;})}));
  app.put('/api/workshop-service-categories/:id',async(req,res)=>res.json({id:await transaction(db,async()=>{const id=await saveWorkshopServiceCategory(db,res.locals.context,req.body,String(req.params.id));await audit(db,res.locals.context,'workshop_service_category.updated',id);return id;})}));
  app.patch('/api/workshop-service-categories/:id/status',async(req,res)=>{
    const input=z.object({active:z.boolean()}).parse(req.body);
    await transaction(db,async()=>{await setWorkshopServiceCategoryActive(db,res.locals.context,String(req.params.id),input.active);await audit(db,res.locals.context,input.active?'workshop_service_category.reactivated':'workshop_service_category.inactivated',String(req.params.id));});
    res.json({ok:true});
  });
  app.post('/api/repair-services/preview',async(req,res)=>res.json(await resolveService(db,res.locals.context,req.body)));
  app.post('/api/repair-services/reprice',async(req,res)=>{
    const input=z.object({order_id:z.string(),item_id:z.string(),execution:z.enum(['internal','outsourced']),cost:integer,commercial_category_id:z.enum(['compacto','medio','premium','pesado']).optional()}).parse(req.body);
    const prior=await db.prepare('SELECT * FROM order_items WHERE tenant_id=? AND order_id=? AND id=?').get(res.locals.context.tenantId,input.order_id,input.item_id);
    if(!prior?.service_snapshot)throw new Error('Item não encontrado nesta oficina.');
    const saved=JSON.parse(prior.service_snapshot);
    res.json(await resolveService(db,res.locals.context,{repair_service_id:saved.service_id,repair_model_id:saved.model_id,workshop_service_id:saved.workshop_service_id,commercial_category_id:input.commercial_category_id,service_execution:input.execution,service_cost:input.cost},prior));
  });
  app.post("/api/customers-with-vehicle", async (req, res) => {
    const ctx: Context = res.locals.context;
    const customer = schemas.customers.parse(req.body.customer);
    const vehicle = schemas.vehicles
      .omit({ customer_id: true })
      .parse(req.body.vehicle);
    let selectedModel: any = null;
    if (vehicle.service_model_id) {
      selectedModel = await confirmRegistrationVehicleModel(db, ctx, vehicle.service_model_id, vehicle.brand);
    }
    if (!Object.prototype.hasOwnProperty.call(req.body.vehicle || {}, "service_model_id")) {
      const match = await identifyVehicleModel(db, ctx, vehicle);
      if (match.status === "matched") { selectedModel = match.model; vehicle.service_model_id = match.model.id; }
    }
    if (selectedModel) { vehicle.model = String(selectedModel.name); vehicle.fipe_model = String(selectedModel.name); vehicle.fipe_code = String(selectedModel.fipe_code || vehicle.fipe_code || ""); }
    (vehicle as any).service_porte_id = selectedModel?.porte_id || "";
    (vehicle as any).service_link_mode = req.body.vehicle?.service_model_id ? "manual" : selectedModel ? "auto" : "none";
    // The legacy database stores an absent technical association as an empty string.
    vehicle.service_model_id = vehicle.service_model_id || "";
    const result = await transaction(db, async () => {
      const customerId = id(),
        vehicleId = id();
      const fields = Object.keys(customer);
      await db
        .prepare(
          `INSERT INTO customers(id,tenant_id,${fields.join(",")}) VALUES(${Array(
            fields.length + 2,
          )
            .fill("?")
            .join(",")})`,
        )
        .run(customerId, ctx.tenantId, ...Object.values(customer));
      const vf = Object.keys(vehicle);
      await db
        .prepare(
          `INSERT INTO vehicles(id,tenant_id,customer_id,${vf.join(",")}) VALUES(${Array(
            vf.length + 3,
          )
            .fill("?")
            .join(",")})`,
        )
        .run(vehicleId, ctx.tenantId, customerId, ...Object.values(vehicle));
      await audit(db, ctx, "customers.created", customerId);
      await audit(db, ctx, "vehicles.created", vehicleId);
      if (selectedModel) await audit(db, ctx, vehicle.service_model_id === selectedModel.id && req.body.vehicle?.service_model_id ? "vehicles.catalog_link_confirmed" : "vehicles.catalog_link_auto", vehicleId);
      return { id: customerId, vehicle_id: vehicleId };
    });
    res.status(201).json(result);
  });
  app.patch("/api/orders/:id/notes", async (req, res) => {
    const ctx: Context = res.locals.context;
    const record = String(req.params.id);
    const order = await scoped(db, "orders", ctx.tenantId, record);
    if (
      !["open", "working", "ready"].includes(order.status)
    )
      throw new Error("As observações só podem mudar em uma OS em andamento.");
    const notes = z.string().trim().max(4000).parse(req.body.notes);
    await transaction(db, async () => {
      if (String(order.notes || "") === notes) return;
      await db
        .prepare("UPDATE orders SET notes=? WHERE tenant_id=? AND id=?")
        .run(notes, ctx.tenantId, record);
      await invalidateOrderShares(db, ctx, record);
      await audit(db, ctx, "order.notes_updated", record);
    });
    res.json({ ok: true });
  });
  app.get("/api/card-machines", async (_req,res) => res.json(await listCardMachines(db,res.locals.context)));
  app.post("/api/card-machines", async (req,res) => res.status(201).json(await saveCardMachine(db,res.locals.context,req.body)));
  app.put("/api/card-machines/:id", async (req,res) => res.json(await saveCardMachine(db,res.locals.context,req.body,String(req.params.id))));
  app.put("/api/payment-settings", async (req, res) => {
    const input = z
      .object({
        debit_fee_bps: z.number().int().min(0).max(10000),
        credit_fee_bps: z.number().int().min(0).max(10000),
        interest_bps: z.number().int().min(0).max(10000),
      })
      .parse(req.body);
    await transaction(db, async () => {
    await db
      .prepare(
        "INSERT INTO payment_settings(tenant_id,debit_fee_bps,credit_fee_bps,interest_bps) VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET debit_fee_bps=excluded.debit_fee_bps,credit_fee_bps=excluded.credit_fee_bps,interest_bps=excluded.interest_bps",
      )
      .run(
        res.locals.context.tenantId,
        input.debit_fee_bps,
        input.credit_fee_bps,
        input.interest_bps,
      );
    await audit(db, res.locals.context, "payment_settings.updated", res.locals.context.tenantId);
    });
    res.json({ ok: true });
  });
  app.post("/api/receivables/:id/preview", async (req, res) => {
    const r = await scoped(
      db,
      "receivables",
      res.locals.context.tenantId,
      String(req.params.id),
    );
    const discount = receiptDiscountSchema.optional().parse(req.body?.discount);
    const amount = discount
      ? (await previewReceivableDiscount(db, res.locals.context, String(req.params.id), discount)).total
      : Number(r.amount);
    res.json(calculatePaymentPlan(amount, await resolveCardPayments(db,res.locals.context,receiptPlanSchema.parse(req.body))));
  });
  app.post("/api/receivables/:id/discount", async (req, res) => {
    res.json(
      await updateReceivableDiscount(
        db,
        res.locals.context,
        String(req.params.id),
        receiptDiscountSchema.parse(req.body),
      ),
    );
  });
  app.post("/api/receivables/:id/plan", async (req, res) => {
    const { discount, ...plan } = receiptPlanRequestSchema.parse(req.body);
    res.json(
      await configurePlan(
        db,
        res.locals.context,
        String(req.params.id),
        plan,
        discount,
      ),
    );
  });
  app.post("/api/receivables/:id/settle-credit", async (req, res) => {
    res.json(await settleCredit(db,res.locals.context,String(req.params.id),
      z.string().min(1).optional().parse(req.body.account_id),
      date.optional().parse(req.body.sale_on)));
  });
  app.post("/api/installments/:id/settle", async (req, res) => {
    await settleInstallment(
      db,
      res.locals.context,
      String(req.params.id),
      z.string().min(1).optional().parse(req.body.account_id),
    );
    res.json({ ok: true });
  });
  app.patch("/api/catalog/:id/category", async (req, res) => {
    const ctx = res.locals.context;
    requireAdmin(ctx);
    const value = z.object({category:z.string().trim().max(100)}).parse(req.body);
    await transaction(db,async () => {
      const item=await scoped(db,"catalog",ctx.tenantId,String(req.params.id));
      if(item.kind!=="product" || item.archived_at || item.merged_into) throw new Error("Escolha um produto disponível.");
      const category=await validProductCategory(db,ctx,value.category);
      await db.prepare("UPDATE catalog SET category=?,category_confirmed=1 WHERE tenant_id=? AND id=?").run(category,ctx.tenantId,item.id);
      await audit(db,ctx,"catalog.category",item.id);
    });
    res.json({ok:true});
  });
  const productCategorySchema = z.object({ name: z.string().trim().min(1).max(100), request_id: z.string().uuid().optional() });
  app.get("/api/product-categories", async (_req, res) => res.json(await listProductCategories(db, res.locals.context)));
  app.post("/api/product-categories", async (req, res) => {
    const value = productCategorySchema.parse(req.body);
    res.status(201).json({ id: await saveProductCategory(db, res.locals.context, value) });
  });
  app.put("/api/product-categories/:id", async (req, res) => {
    const value = productCategorySchema.parse(req.body);
    res.json({ id: await saveProductCategory(db, res.locals.context, value, String(req.params.id)) });
  });
  app.delete("/api/product-categories/:id", async (req, res) => {
    await removeProductCategory(db, res.locals.context, String(req.params.id));
    res.json({ ok: true });
  });
  for (const table of [
    "customers",
    "vehicles",
    "catalog",
    "professionals",
  ] as const) {
    const handler = async (req: express.Request, res: express.Response) => {
      const ctx: Context = res.locals.context;
      const input: Record<string, any> = schemas[table].parse(req.body);
      if (table === "vehicles") normalizeVehicleModelLink(input);
      const record = req.params.id ? String(req.params.id) : undefined;
      const savedId = await transaction(db, async () => {
        const old = record
          ? await scoped(db, table, ctx.tenantId, record)
          : null;
        if (table === "vehicles") {
          const customer = await scoped(
            db,
            "customers",
            ctx.tenantId,
            input.customer_id,
          );
          if (!customer.active) throw new Error("Cliente inativo.");
          if (old && old.customer_id !== input.customer_id)
            await audit(db, ctx, `vehicles.owner_changed:${old.customer_id}:${input.customer_id}`, record!);
          for (const field of ["model_year", "fuel"]) if (old && !Object.prototype.hasOwnProperty.call(req.body, field)) input[field] = old[field];
          const explicitModel = Object.prototype.hasOwnProperty.call(input, "service_model_id");
          let selectedModel: any = null;
          if (explicitModel && input.service_model_id && (input.service_model_id !== old?.service_model_id || input.service_link_mode === "manual")) {
            selectedModel = await confirmRegistrationVehicleModel(db, ctx, input.service_model_id, input.brand);
          } else if (!explicitModel && old?.service_model_id) {
            input.service_model_id = old.service_model_id;
          } else if (!old && !explicitModel) {
            const match = await identifyVehicleModel(db, ctx, input);
            if (match.status === "matched") { selectedModel = match.model; input.service_model_id = match.model.id; }
          }
          if (selectedModel) { input.model = String(selectedModel.name); input.fipe_model = String(selectedModel.name); input.fipe_code = String(selectedModel.fipe_code || input.fipe_code || ""); }
          input.service_porte_id = selectedModel?.porte_id || (input.service_model_id && input.service_model_id === old?.service_model_id ? old?.service_porte_id || "" : "");
          if (explicitModel && !input.service_model_id) input.service_porte_id = "";
          input.service_link_mode = explicitModel && (input.service_model_id !== old?.service_model_id || input.service_link_mode === "manual")
            ? input.service_model_id ? "manual" : "none"
            : old?.service_link_mode || (selectedModel ? "auto" : "none");
          input.service_model_id = input.service_model_id || "";
        }
        if (table === "catalog") {
          if(input.kind==='service')throw new Error('Cadastre e edite os serviços no módulo Serviços.');
          if (input.kind === "product") {
            input.category = await validProductCategory(db, ctx, input.category, old?.category);
            input.category_confirmed = 1;
          }
          if (input.freight_unit > input.cost)
            throw new Error("O custo total deve incluir o frete.");
          if (input.kind === "service") input.freight_unit = 0;
          if (old?.archived_at)
            throw new Error(
              "Este item pertence ao catálogo anterior. Importe novamente pela extensão.",
            );
          if (old?.merged_into)
            throw new Error(
              "Este cadastro foi unificado. Edite o serviço principal.",
            );
          input.cost_known = 1;
          if (!old) input.stock_verified = 1;
          if (old && old.kind !== input.kind)
            throw new Error("O tipo do item não pode ser alterado.");
          if (input.kind === "service") {
            await assertUniqueService(db, ctx.tenantId, input.name, record);
            input.stock = 0;
            input.minimum_stock = 0;
          }
          if (old && old.stock !== input.stock)
            throw new Error("Use o ajuste de estoque para alterar o saldo.");
          if (!old && input.stock !== 0)
            throw new Error("Cadastre o produto com estoque zero. Use a nota fiscal ou os controles de estoque para registrar entradas.");
        }
        const recordId = record || id();
        const fields = Object.keys(input);
        const vehicleSnapshotChanged =
          table === "vehicles" &&
          !!old &&
          ["plate", "brand", "model", "year", "color", "km", "chassis", "fipe_code", "fipe_model", "fipe_year_id", "model_year", "fuel"].some(
            (field) => String(old[field] ?? "") !== String(input[field] ?? ""),
          );
        const linkedOrders = vehicleSnapshotChanged
          ? await db
              .prepare("SELECT id FROM orders WHERE tenant_id=? AND vehicle_id=?")
              .all(ctx.tenantId, recordId)
          : [];
        if (old)
          await db
            .prepare(
              `UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(",")} WHERE tenant_id=? AND id=?`,
            )
            .run(...Object.values(input), ctx.tenantId, recordId);
        else
          await db
            .prepare(
              `INSERT INTO ${table}(id,tenant_id,${fields.join(",")}) VALUES(${fields
                .map(() => "?")
                .concat(["?", "?"])
                .join(",")})`,
            )
            .run(recordId, ctx.tenantId, ...Object.values(input));
        if (table === "vehicles" && input.service_model_id && input.service_model_id !== old?.service_model_id) {
          const confirmed = Object.prototype.hasOwnProperty.call(req.body, "service_model_id") && !!req.body.service_model_id;
          await audit(db, ctx, confirmed ? "vehicles.catalog_link_confirmed" : "vehicles.catalog_link_auto", recordId);
        }
        for (const linkedOrder of linkedOrders) {
          await invalidateOrderShares(db, ctx, String(linkedOrder.id));
        }
        await audit(
          db,
          ctx,
          `${table}.${old ? "updated" : "created"}`,
          recordId,
        );
        return recordId;
      });
      res.json({ ok: true, id: savedId });
    };
    app.post(`/api/${table}`, handler);
    app.put(`/api/${table}/:id`, handler);
  }
  app.post("/api/catalog-batch", async (req,res) => {
    res.json(await createProductBatch(db,res.locals.context,req.body));
  });

  app.get("/api/documents/:kind/:id",async(req,res)=>{
    const kind=z.enum(["order","checklist"]).parse(req.params.kind),id=String(req.params.id),ctx=res.locals.context;
    const revision=req.query.revision===undefined?undefined:z.coerce.number().int().positive().parse(req.query.revision);
    res.json(revision?await readDocument(db,ctx,kind,id,revision):await documentHistory(db,ctx,kind,id));
  });
  app.get("/api/documents/archives",async(_req,res)=>{
    res.set("Cache-Control","no-store").json(await listArchivedDocuments(db,res.locals.context));
  });
  app.get("/api/documents/archives/:id",async(req,res)=>{
    res.set("Cache-Control","no-store").json(await readArchivedDocument(db,res.locals.context,String(req.params.id)));
  });
  app.post("/api/documents/:kind/:id",async(req,res)=>{
    const kind=z.enum(["order","checklist"]).parse(req.params.kind);
    const body=z.object({
      new_revision:z.boolean().default(false),
      current_order:z.boolean().default(false),
    }).parse(req.body);
    res.json(await issueDocument(
      db,
      res.locals.context,
      kind,
      String(req.params.id),
      body.new_revision,
      body.current_order,
    ));
  });

  app.get("/api/workshop-profile", async (_req,res) => {
    res.json(await getWorkshopProfile(db,res.locals.context));
  });
  app.put("/api/workshop-profile", async (req,res) => {
    res.json(await saveWorkshopProfile(db,res.locals.context,req.body));
  });
  app.get("/api/suppliers", async (_req,res) => {
    res.json(await listSuppliers(db,res.locals.context));
  });
  app.get("/api/suppliers/:id", async (req,res) => {
    res.json(await supplierDetails(db,res.locals.context,String(req.params.id)));
  });
  app.post("/api/suppliers", async (req,res) => {
    res.status(201).json({id:await saveSupplier(db,res.locals.context,req.body)});
  });
  app.put("/api/suppliers/:id", async (req,res) => {
    res.json({id:await saveSupplier(db,res.locals.context,req.body,String(req.params.id))});
  });
  app.post("/api/stock-invoices/preview", async (req, res) => {
    const input = z.object({xml:z.string().min(1).max(2*1024*1024)}).parse(req.body);
    res.json(await previewStockInvoice(db,res.locals.context,input.xml));
  });
  app.post("/api/stock-invoices/import", async (req, res) => {
    const input = z.object({xml:z.string().min(1).max(2*1024*1024),choices:z.unknown(),supplier:z.unknown().optional()}).parse(req.body);
    res.json(await importStockInvoice(db,res.locals.context,input.xml,input.choices,input.supplier));
  });
  app.post("/api/stock/:id", async (req, res) => {
    const ctx: Context = res.locals.context;
    const input = z
      .object({
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((n) => n !== 0),
        reason: z.string().trim().min(5).max(200),
        cost: integer.optional(),
        freight_unit: integer.optional(),
        price: integer.optional(),
        request_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    await transaction(db, async () => {
      const item = await scoped(
        db,
        "catalog",
        ctx.tenantId,
        String(req.params.id),
      );
      if (item.kind !== "product" || !item.active || item.archived_at)
        throw new Error("Selecione um produto ativo.");
      if (
        (input.cost !== undefined ||
          input.price !== undefined ||
          input.freight_unit !== undefined) &&
        input.quantity < 0
      )
        throw new Error("Atualize custo e venda ao registrar uma entrada.");
      if (
        (input.freight_unit ?? item.freight_unit ?? 0) >
        (input.cost ?? item.cost)
      )
        throw new Error("O custo total deve incluir o frete.");
      if (input.request_id) {
        const prior = await db
          .prepare("SELECT * FROM stock_movements WHERE id=? AND tenant_id=?")
          .get(input.request_id, ctx.tenantId);
        if (prior) {
          if (
            prior.catalog_id !== item.id ||
            prior.quantity !== input.quantity ||
            prior.reason !== input.reason ||
            prior.unit_cost !== (input.cost ?? null) ||
            prior.unit_price !== (input.price ?? null) ||
            prior.freight_unit !== (input.freight_unit ?? null)
          )
            throw new Error("Entrada já registrada com outros valores.");
          return;
        }
      }
      if (input.cost !== undefined || input.price !== undefined)
        await db
          .prepare(
            "UPDATE catalog SET cost=?,price=?,cost_known=1,freight_unit=? WHERE tenant_id=? AND id=?",
          )
          .run(
            input.cost ?? item.cost,
            input.price ?? item.price,
            input.freight_unit ?? item.freight_unit,
            ctx.tenantId,
            item.id,
          );
      if (item.stock + input.quantity < 0)
        throw new Error("O estoque não pode ficar negativo.");
      await db
        .prepare(
          "UPDATE catalog SET stock_verified=1,stock=stock+? WHERE tenant_id=? AND id=?",
        )
        .run(input.quantity, ctx.tenantId, item.id);
      await db
        .prepare(
          "INSERT INTO stock_movements(id,tenant_id,catalog_id,quantity,reason,user_id,unit_cost,unit_price,freight_unit) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          input.request_id || id(),
          ctx.tenantId,
          item.id,
          input.quantity,
          input.reason,
          ctx.userId,
          input.cost ?? null,
          input.price ?? null,
          input.freight_unit ?? null,
        );
      await audit(db, ctx, "stock.adjusted", item.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/orders", async (req, res) =>
    res.status(201).json({
      id: await saveOrder(db, res.locals.context, orderSchema.parse(req.body)),
    }),
  );
  app.put("/api/orders/:id", async (req, res) =>
    res.json({
      id: await saveOrder(
        db,
        res.locals.context,
        orderSchema.parse(req.body),
        String(req.params.id),
      ),
    }),
  );
  app.post("/api/orders/:id/status", async (req, res) => {
    const result = await transitionOrder(
      db,
      res.locals.context,
      String(req.params.id),
      z.enum(statuses).parse(req.body.status),
      date.optional().parse(req.body.due_on),
    );
    res.json({ ok: true, ...result });
  });
  app.post("/api/receivables/:id/settle", async (req, res) => {
    await settle(
      db,
      res.locals.context,
      String(req.params.id),
      z
        .enum([
          "Pix",
          "Dinheiro",
          "Cartão de débito",
          "Cartão de crédito",
          "Transferência",
          "Boleto",
        ])
        .parse(req.body.method),
      z.string().min(1).optional().parse(req.body.account_id),
    );
    res.json({ ok: true });
  });
  if (platformAdminApp) app.use("/api", platformAdminApp);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Recurso não encontrado." }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/p/:token", (_req, res) => res.sendFile(resolve("dist/client.html")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/app.html")));
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" "),
        });
        return;
      }
      const message = String(error.message || "");
      const constraint =
        message.includes("UNIQUE constraint") || error.code === "23505";
      if (
        typeof error.code === "string" &&
        /^[0-9A-Z]{5}$/.test(error.code) &&
        !constraint
      ) {
        console.error("Database operation failed", { code: error.code });
        res.status(500).json({
          error: "Não foi possível concluir a operação. Tente novamente.",
        });
        return;
      }
      res.status(error.status || 400).json({
        error: constraint
          ? "Já existe um cadastro com essa placa ou referência nesta oficina."
          : message.includes("constraint")
            ? "Não foi possível vincular os registros."
            : message || "Não foi possível concluir a operação.",
      });
    },
  );
  return app;
}

