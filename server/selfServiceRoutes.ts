import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { digestAdminToken } from "./auth/platformAdmin.js";
import { workshopRegistrationSchema } from "./services/platformWorkshops.js";
import { sendWorkshopActivationEmail } from "./services/workshopActivation.js";
import { commercialRegistrationEnabled, selfServiceTestEmails, testOrigin } from "./services/selfServicePolicy.js";

const schema = z.object({ workshop: workshopRegistrationSchema, plan_code: z.enum(["basic", "professional", "premium"]) }).strict();
const accepted = { message: "Se o cadastro puder prosseguir, você receberá o e-mail de ativação. Confira a caixa de entrada." };
export function selfServiceRoutes(pool: Pool, deliver = sendWorkshopActivationEmail) {
  const router = Router();
  router.get("/admin-api/workshop-registration", (_req, res) => res.json({ enabled: selfServiceTestEmails().length > 0 }));
  router.post("/admin-api/workshop-registration", async (req, res) => {
    const emails = selfServiceTestEmails();
    if (!emails.length) { res.status(404).json({ error: "Cadastro indisponível." }); return; }
    const local = !process.env.VERCEL && process.env.NODE_ENV !== "production";
    const origin = req.get("origin");
    const allowedOrigin = commercialRegistrationEnabled() ? "https://osdrive.com.br" : testOrigin;
    if (origin !== allowedOrigin && !(local && origin === "http://127.0.0.1:5173")) { res.status(403).json({ error: "Origem não autorizada." }); return; }
    const input = schema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Confira os dados do cadastro." }); return; }
    const email = input.data.workshop.responsible_email.toLowerCase();
    if (!emails.includes(email)) { res.status(202).json(accepted); return; }
    // Database-backed limits survive serverless instances. Do not reuse login keys.
    const key = digestAdminToken("self-service:" + (req.ip || "unknown"));
    const limit = await pool.query(`INSERT INTO platform_admin.login_attempts(attempt_key,count,window_started_at) VALUES($1,1,now())
      ON CONFLICT(attempt_key) DO UPDATE SET count=CASE WHEN platform_admin.login_attempts.window_started_at<now()-interval '1 hour' THEN 1 ELSE platform_admin.login_attempts.count+1 END,
      window_started_at=CASE WHEN platform_admin.login_attempts.window_started_at<now()-interval '1 hour' THEN now() ELSE platform_admin.login_attempts.window_started_at END RETURNING count`, [key]);
    if (Number(limit.rows[0].count) > 12) { res.status(429).json({ error: "Aguarde antes de tentar novamente." }); return; }
    const tenant = randomUUID(), inviteId = randomUUID(), token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 48 * 3600000), w = input.data.workshop;
    try {
      await pool.query("SELECT platform_admin.create_workshop_self_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [tenant, w.name, w.responsible_name, email, w.phone, w.document, input.data.plan_code, inviteId, digestAdminToken(token), expiresAt]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") { res.status(202).json(accepted); return; }
      throw error;
    }
    try {
      await deliver({ inviteId, token, email, workshopName: w.name, expiresAt }, { appOrigin: origin });
      await pool.query("UPDATE platform_admin.workshop_activation_invites SET delivery_status='sent',sent_at=now() WHERE id=$1 AND used_at IS NULL", [inviteId]);
    } catch {
      await pool.query("UPDATE platform_admin.workshop_activation_invites SET delivery_status='failed' WHERE id=$1 AND used_at IS NULL", [inviteId]);
    }
    res.status(202).json(accepted);
  });
  return router;
}
