import { z } from "zod";
import type { DB } from "../db/transactions.js";
import { transaction } from "../db/transactions.js";
import type { Context } from "../auth/session.js";
import { requireAdmin } from "./payments.js";
import { audit, id } from "./workshop.js";
import { normalizePlate } from "./vehicleLookup.js";
import { workshopIdentity, type BusinessDay } from "../../shared/workshopIdentity.js";

const inputSchema = z.object({
  starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/),
  duration_minutes: z.number().int().min(30).max(720).refine(n => n % 30 === 0),
  plate: z.string().trim().min(7).max(8),
  customer_name: z.string().trim().max(150).default(""),
  phone: z.string().trim().max(80).default(""),
  planned_services: z.string().trim().min(2).max(2000),
}).strict();

function requireAgenda(ctx: Context) {
  requireAdmin(ctx);
  if (ctx.modules?.agenda !== true) throw Object.assign(
    new Error("A Agenda está disponível nos planos Profissional e Premium."), { status: 403 },
  );
}

function minutes(value: string) { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)); }
function clock(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function dayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function scheduleEnd(starts: string, duration: number, hours: BusinessDay[]) {
  const date = starts.slice(0, 10), time = starts.slice(11);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < dayInSaoPaulo())
    throw new Error("Escolha uma data válida a partir de hoje.");
  const weekday = parsed.getUTCDay();
  const rule = hours.find(h => h.day === weekday);
  if (!rule || rule.closed || !rule.open || !rule.close)
    throw new Error("A oficina não atende neste dia. Confira os horários em Configurações.");
  const start = minutes(time), end = start + duration;
  if (start < minutes(rule.open) || end > minutes(rule.close))
    throw new Error("O agendamento deve caber no horário de atendimento da oficina.");
  if (rule.break_start && rule.break_end && start < minutes(rule.break_end) && end > minutes(rule.break_start))
    throw new Error("O agendamento não pode atravessar o intervalo de atendimento.");
  return `${date}T${clock(end)}`;
}

export async function listAppointments(db: DB, ctx: Context, date: string) {
  requireAgenda(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data inválida.");
  return db.prepare(`SELECT a.id,a.starts_at,a.ends_at,a.plate,a.customer_id,a.customer_name,a.phone,
      a.planned_services,a.status,a.checklist_id,v.brand,v.model
    FROM appointments a LEFT JOIN vehicles v ON v.tenant_id=a.tenant_id AND v.plate=a.plate
    WHERE a.tenant_id=? AND a.starts_at>=? AND a.starts_at<? ORDER BY a.starts_at,a.plate`)
    .all(ctx.tenantId, `${date}T00:00`, `${date}T23:59`);
}

export async function getAppointment(db: DB, ctx: Context, appointmentId: string) {
  requireAgenda(ctx);
  const row = await db.prepare("SELECT * FROM appointments WHERE tenant_id=? AND id=?").get(ctx.tenantId, appointmentId);
  if (!row) throw Object.assign(new Error("Agendamento não encontrado nesta oficina."), { status: 404 });
  return row;
}

export async function createAppointment(db: DB, ctx: Context, input: unknown) {
  requireAgenda(ctx);
  const value = inputSchema.parse(input);
  const plate = normalizePlate(value.plate);
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) throw new Error("Informe uma placa brasileira válida.");
  return transaction(db, async () => {
    const tenant = await db.prepare("SELECT * FROM tenants WHERE id=?").get(ctx.tenantId);
    const ends = scheduleEnd(value.starts_at, value.duration_minutes, workshopIdentity(tenant).business_hours);
    const existing = await db.prepare("SELECT v.customer_id,c.name,c.phone,v.active AS vehicle_active,c.active AS customer_active FROM vehicles v JOIN customers c ON c.tenant_id=v.tenant_id AND c.id=v.customer_id WHERE v.tenant_id=? AND v.plate=?").get(ctx.tenantId, plate);
    if (existing && (!existing.vehicle_active || !existing.customer_active)) throw new Error("Veículo ou cliente inativo. Confira o cadastro antes de agendar.");
    const name = existing ? String(existing.name) : value.customer_name;
    const phone = existing ? String(existing.phone || value.phone) : value.phone;
    if (name.length < 2 || !phone.trim()) throw new Error("Informe nome e telefone do cliente para o agendamento.");
    const conflict = await db.prepare("SELECT id FROM appointments WHERE tenant_id=? AND plate=? AND status='scheduled' AND starts_at<? AND ends_at>?")
      .get(ctx.tenantId, plate, ends, value.starts_at);
    if (conflict) throw Object.assign(new Error("Este veículo já tem agendamento nesse horário."), { status: 409 });
    const appointmentId = id();
    await db.prepare("INSERT INTO appointments(id,tenant_id,starts_at,ends_at,plate,customer_id,customer_name,phone,planned_services,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(appointmentId, ctx.tenantId, value.starts_at, ends, plate, existing?.customer_id || null, name, phone, value.planned_services, ctx.userId);
    await audit(db, ctx, "appointment.created", appointmentId);
    return { id: appointmentId };
  });
}

export async function cancelAppointment(db: DB, ctx: Context, appointmentId: string) {
  requireAgenda(ctx);
  return transaction(db, async () => {
    const row = await getAppointment(db, ctx, appointmentId);
    if (row.status !== "scheduled") throw Object.assign(new Error("Somente agendamentos pendentes podem ser cancelados."), { status: 409 });
    await db.prepare("UPDATE appointments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND status='scheduled'")
      .run(ctx.tenantId, appointmentId);
    await audit(db, ctx, "appointment.cancelled", appointmentId);
    return { ok: true };
  });
}

export async function appointmentForChecklist(db: DB, ctx: Context, appointmentId: string, plate: string) {
  const row = await getAppointment(db, ctx, appointmentId);
  if (row.status !== "scheduled" || row.starts_at.slice(0, 10) !== dayInSaoPaulo() || row.plate !== plate)
    throw Object.assign(new Error("O checklist só pode iniciar no dia agendado e para a placa prevista."), { status: 409 });
  return row;
}
