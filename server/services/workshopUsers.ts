import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "../db/database";
import { transaction } from "../db/database";
import type { Context } from "../auth/session";
import { digest, verifyPassword, hashPassword } from "../auth/session";
import { audit } from "./workshop";
import { requirePermission, accessDenied } from "./userAccess";
import {
  effectivePermissions,
  permissionKeys,
} from "../../shared/userPermissions";

const profile = z.enum(["master", "manager", "advisor", "mechanic", "finance"]);
export const accessInput = z
  .object({
    profile,
    active: z.boolean().default(true),
    permissions: z.record(z.string(), z.boolean()).default({}),
    order_scope: z.enum(["all", "assigned"]).default("all"),
    discount_bps: z.number().int().min(0).max(10000).default(0),
    discount_cents: z.number().int().min(0).nullable().default(null),
  })
  .strict();
export const inviteInput = accessInput
  .omit({ active: true })
  .extend({
    email: z.email().transform((s) => s.trim().toLowerCase()),
    professional_id: z.string().min(1).nullable().default(null),
  });
function validated(raw: unknown) {
  const input = accessInput.parse(raw);
  if (
    Object.keys(input.permissions).some(
      (k) => !permissionKeys.includes(k as any),
    )
  )
    throw new Error("Permissão desconhecida.");
  effectivePermissions(input.profile, input.permissions);
  if (input.profile === "master") {
    input.permissions = {};
    input.order_scope = "all";
    input.discount_bps = 10000;
    input.discount_cents = null;
  }
  return input;
}
export async function userDirectory(db: DB, ctx: Context) {
  requirePermission(ctx, "users.manage");
  if (db.withRequestContext) {
    const row = await db
      .prepare("SELECT horse_power.workshop_user_directory() AS items")
      .get();
    return row?.items || [];
  }
  return db
    .prepare(
      "SELECT m.user_id,u.name,u.email,m.role,CASE WHEN m.role='owner' THEN 'master' WHEN a.profile='master' THEN 'mechanic' ELSE COALESCE(a.profile,'mechanic') END profile,COALESCE(a.active,1) active,COALESCE(a.permissions,'{}') permissions,COALESCE(a.order_scope,'all') order_scope,COALESCE(a.discount_bps,CASE WHEN m.role='owner' THEN 10000 ELSE 0 END) discount_bps,a.discount_cents FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? ORDER BY u.name",
    )
    .all(ctx.tenantId);
}
export async function userCapacity(db: DB, ctx: Context) {
  requirePermission(ctx, "users.manage");
  if (db.withRequestContext)
    return (await db
      .prepare("SELECT horse_power.workshop_user_capacity() AS capacity")
      .get())!.capacity;
  const active = Number(
    (await db
      .prepare(
        "SELECT count(*) n FROM memberships m LEFT JOIN workshop_user_access a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND COALESCE(a.active,1)=1",
      )
      .get(ctx.tenantId))!.n,
  );
  const pending = Number(
    (await db
      .prepare(
        "SELECT count(*) n FROM workshop_user_invites WHERE tenant_id=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?",
      )
      .get(ctx.tenantId, Date.now()))!.n,
  );
  return { limit: null, active, pending, available: null };
}
export async function recentAuthentication(
  db: DB,
  ctx: Context,
  sessionHash: string,
) {
  const row = await db
    .prepare(
      "SELECT authenticated_at FROM session_reauthentication WHERE token_hash=?",
    )
    .get(sessionHash);
  if (!row || Number(row.authenticated_at) < Date.now() - 5 * 60000)
    accessDenied("Confirme sua senha novamente para esta alteração sensível.");
}
export async function reauthenticate(
  db: DB,
  ctx: Context,
  sessionHash: string,
  password: string,
) {
  const user = await db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(ctx.userId);
  if (!user || !verifyPassword(password, String(user.password_hash)))
    accessDenied("Senha atual incorreta.");
  await db
    .prepare(
      "INSERT INTO session_reauthentication(token_hash,authenticated_at) VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET authenticated_at=excluded.authenticated_at",
    )
    .run(sessionHash, Date.now());
}
async function lock(db: DB, ctx: Context) {
  if (db.withRequestContext)
    await db
      .prepare("SELECT pg_advisory_xact_lock(hashtextextended(?,104730))")
      .get(ctx.tenantId);
}
export async function saveUserAccess(
  db: DB,
  ctx: Context,
  target: string,
  raw: unknown,
  sessionHash: string,
) {
  requirePermission(ctx, "users.manage");
  const input = validated(raw);
  return transaction(db, async () => {
    await lock(db, ctx);
    const members = await userDirectory(db, ctx);
    const old = members.find((m: any) => m.user_id === target);
    if (!old)
      throw Object.assign(new Error("Usuário não encontrado nesta oficina."), {
        status: 404,
      });
    if (old.role === "owner" || input.profile === "master")
      await recentAuthentication(db, ctx, sessionHash);
    if (
      old.role === "owner" &&
      target === ctx.userId &&
      (!input.active || input.profile !== "master")
    )
      accessDenied(
        "Você não pode desativar ou rebaixar seu próprio acesso Master.",
      );
    if (
      old.role === "owner" &&
      old.active === 1 &&
      (!input.active || input.profile !== "master") &&
      members.filter((m: any) => m.role === "owner" && m.active === 1).length <=
        1
    )
      throw new Error("A oficina deve manter pelo menos um Master ativo.");
    if (!old.active && input.active) {
      const capacity = await userCapacity(db, ctx);
      if (
        capacity.limit !== null &&
        capacity.active + capacity.pending >= capacity.limit
      )
        throw new Error("Limite de usuários atingido.");
    }
    await db
      .prepare("UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?")
      .run(
        input.profile === "master" ? "owner" : "operator",
        ctx.tenantId,
        target,
      );
    await db
      .prepare(
        "INSERT INTO workshop_user_access(tenant_id,user_id,profile,active,permissions,order_scope,discount_bps,discount_cents) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET profile=excluded.profile,active=excluded.active,permissions=excluded.permissions,order_scope=excluded.order_scope,discount_bps=excluded.discount_bps,discount_cents=excluded.discount_cents",
      )
      .run(
        ctx.tenantId,
        target,
        input.profile,
        input.active ? 1 : 0,
        JSON.stringify(input.permissions),
        input.order_scope,
        input.profile === "master" ? 10000 : input.discount_bps,
        input.profile === "master" ? null : input.discount_cents,
      );
    if (!input.active) {
      if (db.withRequestContext)
        await db
          .prepare("SELECT horse_power.workshop_revoke_sessions(?)")
          .get(target);
      else
        await db
          .prepare("DELETE FROM sessions WHERE tenant_id=? AND user_id=?")
          .run(ctx.tenantId, target);
    }
    await audit(db, ctx, "users.access_changed", target, {
      before: old,
      after: input,
    });
    return { ok: true };
  });
}
export async function listInvites(db: DB, ctx: Context) {
  requirePermission(ctx, "users.manage");
  const rows = await db
    .prepare(
      "SELECT id,email,profile,professional_id,created_at,expires_at,revoked_at,accepted_at FROM workshop_user_invites WHERE tenant_id=? ORDER BY created_at DESC",
    )
    .all(ctx.tenantId);
  return rows.map((r) => ({
    ...r,
    status: r.accepted_at
      ? "accepted"
      : r.revoked_at
        ? "cancelled"
        : r.expires_at <= Date.now()
          ? "expired"
          : "pending",
  }));
}
export type InviteDelivery = (input: {
  email: string;
  token: string;
  workshopName: string;
  id: string;
}) => Promise<void>;
export async function deliverEmployeeInvite(input: {
  email: string;
  token: string;
  workshopName: string;
  id: string;
}) {
  const origin = process.env.APP_ORIGIN,
    from = process.env.WORKSHOP_ACTIVATION_FROM,
    key = process.env.RESEND_API_KEY;
  if (!origin || !from || !key)
    throw new Error("Envio de convites indisponível.");
  const url = new URL("/aceitar-convite", origin);
  url.hash = input.token;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `employee-invite/${input.id}/${digest(input.token).slice(0, 12)}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `Convite para a oficina ${input.workshopName}`,
      text: `Você foi convidado para acessar ${input.workshopName}. Aceite o convite em até 48 horas: ${url}\nSe já possui conta, utilize sua senha atual. Nenhuma senha é enviada por e-mail.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Não foi possível entregar o convite.");
}
export async function createUserInvite(
  db: DB,
  ctx: Context,
  raw: unknown,
  sessionHash: string,
  deliver: InviteDelivery = deliverEmployeeInvite,
  replacing?: string,
) {
  requirePermission(ctx, "users.manage");
  const input = inviteInput.parse(raw);
  const { email, professional_id, ...access } = input;
  const valid = validated({ ...access, active: true });
  Object.assign(input, {
    profile: valid.profile,
    permissions: valid.permissions,
    order_scope: valid.order_scope,
    discount_bps: valid.discount_bps,
    discount_cents: valid.discount_cents,
  });
  if (input.profile === "master")
    await recentAuthentication(db, ctx, sessionHash);
  const token = randomBytes(32).toString("hex"),
    id = replacing || randomUUID();
  const prepared = await transaction(db, async () => {
    await lock(db, ctx);
    if (replacing) {
      const prior = await db
        .prepare(
          "SELECT * FROM workshop_user_invites WHERE tenant_id=? AND id=? AND accepted_at IS NULL AND revoked_at IS NULL",
        )
        .get(ctx.tenantId, replacing);
      if (!prior) throw new Error("Convite indisponível.");
      await db
        .prepare(
          "UPDATE workshop_user_invites SET revoked_at=? WHERE id=? AND tenant_id=?",
        )
        .run(Date.now(), id, ctx.tenantId);
    }
    const capacity = await userCapacity(db, ctx);
    if (
      capacity.limit !== null &&
      capacity.active + capacity.pending >= capacity.limit
    )
      throw new Error("Limite de usuários atingido.");
    const members = await userDirectory(db, ctx);
    if (members.some((m: any) => m.email.toLowerCase() === input.email))
      throw new Error(
        "Esta conta já possui vínculo; reative o acesso existente.",
      );
    if (
      await db
        .prepare(
          "SELECT 1 FROM workshop_user_invites WHERE tenant_id=? AND lower(email)=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?",
        )
        .get(ctx.tenantId, input.email, Date.now())
    )
      throw new Error("Já existe convite pendente para este e-mail.");
    if (
      input.professional_id &&
      !(await db
        .prepare(
          "SELECT 1 FROM professionals WHERE tenant_id=? AND id=? AND active=1",
        )
        .get(ctx.tenantId, input.professional_id))
    )
      throw new Error("Funcionário indisponível.");
    if (
      input.professional_id &&
      (await db
        .prepare(
          "SELECT 1 FROM staff_accounts WHERE tenant_id=? AND professional_id=? AND user_id IS NOT NULL",
        )
        .get(ctx.tenantId, input.professional_id))
    )
      throw new Error("Funcionário já vinculado a uma conta.");
    const values = [
      ctx.tenantId,
      input.email,
      input.profile,
      JSON.stringify(input.permissions),
      input.order_scope,
      input.discount_bps,
      input.discount_cents,
      input.professional_id,
      digest(token),
      ctx.userId,
      Date.now(),
      Date.now() + 48 * 3600000,
    ];
    if (replacing)
      await db
        .prepare(
          "UPDATE workshop_user_invites SET tenant_id=?,email=?,profile=?,permissions=?,order_scope=?,discount_bps=?,discount_cents=?,professional_id=?,token_hash=?,created_by=?,created_at=?,expires_at=?,revoked_at=NULL WHERE id=?",
        )
        .run(...values, id);
    else
      await db
        .prepare(
          "INSERT INTO workshop_user_invites(tenant_id,email,profile,permissions,order_scope,discount_bps,discount_cents,professional_id,token_hash,created_by,created_at,expires_at,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...values, id);
    await audit(
      db,
      ctx,
      replacing ? "users.invite_resent" : "users.invited",
      id,
      { email: input.email, profile: input.profile },
    );
    return (await db
      .prepare("SELECT name FROM tenants WHERE id=?")
      .get(ctx.tenantId))!.name;
  });
  let delivered = true;
  try {
    await deliver({ email: input.email, token, workshopName: prepared, id });
  } catch {
    delivered = false;
  }
  return { id, delivered };
}
export async function cancelUserInvite(
  db: DB,
  ctx: Context,
  id: string,
  sessionHash = "",
) {
  const row = await db
    .prepare(
      "SELECT profile FROM workshop_user_invites WHERE tenant_id=? AND id=?",
    )
    .get(ctx.tenantId, id);
  if (row?.profile === "master")
    await recentAuthentication(db, ctx, sessionHash);
  requirePermission(ctx, "users.manage");
  await db
    .prepare(
      "UPDATE workshop_user_invites SET revoked_at=? WHERE tenant_id=? AND id=? AND accepted_at IS NULL",
    )
    .run(Date.now(), ctx.tenantId, id);
  await audit(db, ctx, "users.invite_cancelled", id);
  return { ok: true };
}

export async function employeeInviteInfo(db: DB, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error("Convite inválido ou expirado.");
  if (db.withRequestContext) {
    const row = await db
      .prepare("SELECT horse_power.employee_invite_info(?) AS invite")
      .get(digest(token));
    if (!row?.invite) throw new Error("Convite inválido ou expirado.");
    return row.invite;
  }
  const invite = await db
    .prepare(
      "SELECT i.*,t.name workshop_name FROM workshop_user_invites i JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>?",
    )
    .get(digest(token), Date.now());
  if (!invite) throw new Error("Convite inválido ou expirado.");
  return {
    email: invite.email,
    workshop_name: invite.workshop_name,
    account_exists: !!(await db
      .prepare("SELECT 1 FROM users WHERE lower(email)=?")
      .get(invite.email)),
  };
}
export async function acceptEmployeeInvite(
  db: DB,
  token: string,
  sessionHash: string,
  input: { name?: string; password?: string },
) {
  const info = await employeeInviteInfo(db, token);
  let passwordHash = info.account_exists
    ? ""
    : hashPassword(z.string().min(12).max(200).parse(input.password));
  const name = info.account_exists
    ? ""
    : z.string().trim().min(2).max(150).parse(input.name);
  if (info.account_exists) {
    const account = db.withRequestContext
      ? (
          await db
            .prepare("SELECT horse_power.employee_invite_account(?) AS account")
            .get(digest(token))
        )?.account
      : await db
          .prepare("SELECT password_hash FROM users WHERE lower(email)=?")
          .get(info.email);
    if (
      !account ||
      !input.password ||
      !verifyPassword(input.password, String(account.password_hash))
    )
      accessDenied("Senha atual incorreta.");
    passwordHash = account.password_hash;
  }
  if (db.withRequestContext)
    return (await db
      .prepare("SELECT horse_power.accept_employee_invite(?,?,?,?) AS result")
      .get(digest(token), sessionHash, name, passwordHash))!.result;
  return transaction(db, async () => {
    const invite = await db
      .prepare(
        "SELECT * FROM workshop_user_invites WHERE token_hash=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?",
      )
      .get(digest(token), Date.now());
    if (!invite) throw new Error("Convite inválido ou expirado.");
    let user = await db
      .prepare("SELECT id FROM users WHERE lower(email)=?")
      .get(invite.email);
    if (user) {
      const session = await db
        .prepare(
          "SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?",
        )
        .get(sessionHash, user.id, Date.now());
      if (!session && !passwordHash)
        accessDenied("Entre com a conta que recebeu o convite.");
    } else {
      user = { id: randomUUID() };
      await db
        .prepare(
          "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
        )
        .run(user.id, name, invite.email, passwordHash);
    }
    if (
      await db
        .prepare("SELECT 1 FROM memberships WHERE user_id=? AND tenant_id=?")
        .get(user.id, invite.tenant_id)
    )
      throw new Error("Esta conta já está vinculada à oficina.");
    await db
      .prepare("UPDATE workshop_user_invites SET accepted_at=? WHERE id=?")
      .run(Date.now(), invite.id);
    await db
      .prepare("INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)")
      .run(
        user.id,
        invite.tenant_id,
        invite.profile === "master" ? "owner" : "operator",
      );
    await db
      .prepare(
        "INSERT INTO workshop_user_access(tenant_id,user_id,profile,permissions,order_scope,discount_bps,discount_cents) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        invite.tenant_id,
        user.id,
        invite.profile,
        invite.permissions,
        invite.order_scope,
        invite.profile === "master" ? 10000 : invite.discount_bps,
        invite.profile === "master" ? null : invite.discount_cents,
      );
    if (
      invite.professional_id &&
      (await db
        .prepare(
          "SELECT 1 FROM staff_accounts WHERE tenant_id=? AND professional_id=? AND user_id IS NOT NULL",
        )
        .get(invite.tenant_id, invite.professional_id))
    )
      throw new Error("Funcionário já vinculado.");
    if (invite.professional_id)
      await db
        .prepare(
          "INSERT INTO staff_accounts(tenant_id,professional_id,user_id) VALUES(?,?,?) ON CONFLICT(tenant_id,professional_id) DO UPDATE SET user_id=excluded.user_id",
        )
        .run(invite.tenant_id, invite.professional_id, user.id);
    await audit(
      db,
      {
        userId: user.id,
        tenantId: invite.tenant_id,
        role: invite.profile === "master" ? "owner" : "operator",
      },
      "users.invite_accepted",
      invite.id,
    );
    return { ok: true };
  });
}
