import { Router } from "express";
import { z } from "zod";
import type { DB } from "./db/database.js";
import { digest, tokenFrom } from "./auth/session.js";
import { requirePermission } from "./services/userAccess.js";
import {
  profileLabels,
  permissionDefinitions,
} from "../shared/userPermissions.js";
import {
  userDirectory,
  userCapacity,
  listInvites,
  saveUserAccess,
  createUserInvite,
  cancelUserInvite,
  reauthenticate,
  employeeInviteInfo,
  acceptEmployeeInvite,
  type InviteDelivery,
} from "./services/workshopUsers.js";
import {
  staffDirectory,
  saveStaff,
  orderAssignments,
  saveAssignments,
  requestDiscount,
  listDiscountRequests,
  decideDiscount,
} from "./services/workshopOperationsAccess.js";

export function employeePublicRoutes(db: DB) {
  const router = Router();
  router.post("/employee-invites/info", async (req, res) =>
    res.json(await employeeInviteInfo(db, z.string().parse(req.body.token))),
  );
  router.post("/employee-invites/accept", async (req, res) =>
    res.json(
      await acceptEmployeeInvite(
        db,
        z.string().parse(req.body.token),
        digest(tokenFrom(req)),
        z
          .object({
            name: z.string().optional(),
            password: z.string().max(200).optional(),
          })
          .parse(req.body),
      ),
    ),
  );
  return router;
}
export function workshopUserRoutes(db: DB, deliver?: InviteDelivery) {
  const router = Router();
  router.use((req, res, next) => {
    if (
      !res.locals.context?.access &&
      (/^\/(users|user-invites|staff|approvals)(?:\/|$)/.test(req.path) ||
        /\/(assignments|discount-requests)$/.test(req.path))
    ) {
      res
        .status(503)
        .json({ error: "Gestão de usuários aguarda liberação da migração." });
      return;
    }
    next();
  });
  router.post("/reauthenticate", async (req, res) => {
    await reauthenticate(
      db,
      res.locals.context,
      digest(tokenFrom(req)),
      z.string().min(1).max(200).parse(req.body.password),
    );
    res.json({ ok: true });
  });
  router.get("/users", async (_req, res) => {
    const ctx = res.locals.context;
    res.json({
      items: await userDirectory(db, ctx),
      capacity: await userCapacity(db, ctx),
      invites: await listInvites(db, ctx),
      profiles: profileLabels,
      permissions: permissionDefinitions,
    });
  });
  router.put("/users/:id/access", async (req, res) =>
    res.json(
      await saveUserAccess(
        db,
        res.locals.context,
        String(req.params.id),
        req.body,
        digest(tokenFrom(req)),
      ),
    ),
  );
  router.post("/user-invites", async (req, res) =>
    res
      .status(201)
      .json(
        await createUserInvite(
          db,
          res.locals.context,
          req.body,
          digest(tokenFrom(req)),
          deliver,
        ),
      ),
  );
  router.post("/user-invites/:id/resend", async (req, res) => {
    const ctx = res.locals.context;
    requirePermission(ctx, "users.manage");
    const old = await db
      .prepare("SELECT * FROM workshop_user_invites WHERE tenant_id=? AND id=?")
      .get(ctx.tenantId, String(req.params.id));
    if (!old) throw new Error("Convite não encontrado.");
    const input = {
      confirm_master: req.body?.confirm_master === true,
      email: old.email,
      profile: old.profile,
      permissions: JSON.parse(old.permissions),
      order_scope: old.order_scope,
      discount_bps: Number(old.discount_bps),
      discount_cents:
        old.discount_cents === null ? null : Number(old.discount_cents),
      professional_id: old.professional_id,
    };
    res.json(
      await createUserInvite(
        db,
        ctx,
        input,
        digest(tokenFrom(req)),
        deliver,
        String(req.params.id),
      ),
    );
  });
  router.post("/user-invites/:id/cancel", async (req, res) =>
    res.json(
      await cancelUserInvite(
        db,
        res.locals.context,
        String(req.params.id),
        digest(tokenFrom(req)),
        req.body?.confirm_master === true,
      ),
    ),
  );
  router.get("/users/history", async (_req, res) => {
    requirePermission(res.locals.context, "users.manage");
    res.json(
      await db
        .prepare(
          "SELECT id,user_id,action,entity_id,created_at FROM audit_events WHERE tenant_id=? AND (action LIKE 'users.%' OR action LIKE 'staff.%' OR action LIKE 'discount.%' OR action LIKE 'orders.assignment%') ORDER BY created_at DESC LIMIT 200",
        )
        .all(res.locals.context.tenantId),
    );
  });
  router.get("/staff", async (_req, res) =>
    res.json(await staffDirectory(db, res.locals.context)),
  );
  router.post("/staff", async (req, res) =>
    res
      .status(201)
      .json(await saveStaff(db, res.locals.context, null, req.body)),
  );
  router.put("/staff/:id", async (req, res) =>
    res.json(
      await saveStaff(db, res.locals.context, String(req.params.id), req.body),
    ),
  );
  router.get("/orders/:id/assignments", async (req, res) =>
    res.json(
      await orderAssignments(db, res.locals.context, String(req.params.id)),
    ),
  );
  router.put("/orders/:id/assignments", async (req, res) =>
    res.json(
      await saveAssignments(
        db,
        res.locals.context,
        String(req.params.id),
        req.body.professional_ids,
      ),
    ),
  );
  router.post("/orders/:id/discount-requests", async (req, res) =>
    res
      .status(201)
      .json(
        await requestDiscount(
          db,
          res.locals.context,
          String(req.params.id),
          req.body,
        ),
      ),
  );
  router.get("/approvals", async (_req, res) =>
    res.json(await listDiscountRequests(db, res.locals.context)),
  );
  router.post("/approvals/:id/decision", async (req, res) =>
    res.json(
      await decideDiscount(
        db,
        res.locals.context,
        String(req.params.id),
        req.body,
      ),
    ),
  );
  return router;
}
