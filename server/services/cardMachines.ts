import { z } from "zod";
import { transaction, type DB } from "../db/database.js";
import type { Context } from "../auth/session.js";
import { id, audit, scoped } from "./workshop.js";
import { requireAdmin } from "./payments.js";
import { machineRate, type CardMachine } from "../../shared/cardMachines.js";
import type { PaymentInput, MixedPaymentInput } from "../domain/payments.js";

const rateSchema = z.object({
  method: z.enum(["Cartão de débito", "Cartão de crédito"]),
  installments: z.number().int().min(1).max(24),
  fee_bps: z.number().int().min(0).max(9999),
});
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  operator: z.string().trim().min(1).max(80),
  active: z.boolean(),
  is_default: z.boolean(),
  max_installments: z.number().int().min(1).max(24),
  rates: z.array(rateSchema).max(25),
});
function access(ctx: Context, manage = false) {
  requireAdmin(ctx); // Receipts are owner-only today; do not broaden that permission.
  if (
    ctx.modules?.finance === false ||
    (manage && ctx.modules?.settings === false)
  )
    throw Object.assign(new Error("Módulo não habilitado para esta ação."), {
      status: 403,
    });
}
export async function listCardMachines(
  db: DB,
  ctx: Context,
): Promise<CardMachine[]> {
  access(ctx);
  const machines = await db
    .prepare(
      "SELECT * FROM card_machines WHERE tenant_id=? ORDER BY is_default DESC,name,id",
    )
    .all(ctx.tenantId);
  const rates = await db
    .prepare(
      "SELECT * FROM card_machine_rates WHERE tenant_id=? ORDER BY method,installments",
    )
    .all(ctx.tenantId);
  return machines.map((m) => ({
    ...m,
    rates: rates.filter((r) => r.machine_id === m.id),
  })) as CardMachine[];
}
export async function saveCardMachine(
  db: DB,
  ctx: Context,
  body: unknown,
  record?: string,
) {
  access(ctx, true);
  const input = schema.parse(body);
  if (input.is_default && !input.active)
    throw new Error("A máquina padrão deve estar ativa.");
  if (
    new Set(input.rates.map((r) => r.method + ":" + r.installments)).size !==
    input.rates.length
  )
    throw new Error("Modalidade e parcelas duplicadas.");
  if (
    input.rates.some(
      (r) =>
        r.installments > input.max_installments ||
        (r.method === "Cartão de débito" && r.installments !== 1),
    )
  )
    throw new Error(
      "Parcelas incompatíveis com a modalidade ou limite da máquina.",
    );
  return transaction(db, async () => {
    await db.lockTenantMutations?.(ctx.tenantId);
    const old = record
      ? await scoped(db, "card_machines", ctx.tenantId, record)
      : null;
    const nameKey = input.name.toLocaleLowerCase("pt-BR");
    const duplicate = await db
      .prepare("SELECT id FROM card_machines WHERE tenant_id=? AND name_key=?")
      .get(ctx.tenantId, nameKey);
    if (duplicate && duplicate.id !== record)
      throw new Error(
        "Já existe uma máquina com este nome, inclusive entre as desativadas.",
      );
    const machineId = record || id();
    if (input.is_default)
      await db
        .prepare(
          "UPDATE card_machines SET is_default=0 WHERE tenant_id=? AND is_default=1",
        )
        .run(ctx.tenantId);
    if (old)
      await db
        .prepare(
          "UPDATE card_machines SET name=?,name_key=?,operator=?,active=?,is_default=?,max_installments=? WHERE tenant_id=? AND id=?",
        )
        .run(
          input.name,
          nameKey,
          input.operator,
          Number(input.active),
          Number(input.is_default),
          input.max_installments,
          ctx.tenantId,
          machineId,
        );
    else
      await db
        .prepare(
          "INSERT INTO card_machines(id,tenant_id,name,name_key,operator,active,is_default,max_installments) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          machineId,
          ctx.tenantId,
          input.name,
          nameKey,
          input.operator,
          Number(input.active),
          Number(input.is_default),
          input.max_installments,
        );
    await db
      .prepare(
        "DELETE FROM card_machine_rates WHERE tenant_id=? AND machine_id=?",
      )
      .run(ctx.tenantId, machineId);
    for (const rate of input.rates)
      await db
        .prepare(
          "INSERT INTO card_machine_rates(tenant_id,machine_id,method,installments,fee_bps) VALUES(?,?,?,?,?)",
        )
        .run(
          ctx.tenantId,
          machineId,
          rate.method,
          rate.installments,
          rate.fee_bps,
        );
    await audit(
      db,
      ctx,
      old ? "card_machine.updated" : "card_machine.created",
      machineId,
      {
        before: old
          ? {
              name: old.name,
              operator: old.operator,
              active: old.active,
              is_default: old.is_default,
            }
          : null,
        after: input,
      },
    );
    return { id: machineId };
  });
}
export async function resolveCardPayments(
  db: DB,
  ctx: Context,
  input: PaymentInput | MixedPaymentInput,
): Promise<PaymentInput | MixedPaymentInput> {
  access(ctx);
  const payments = "payments" in input ? input.payments : [input];
  const machines = payments.some((p) => p.method.startsWith("Cartão"))
    ? await listCardMachines(db, ctx)
    : [];
  const resolved = payments.map((p) => {
    if (!p.method.startsWith("Cartão"))
      return {
        ...p,
        machine_id: undefined,
        machine_name: undefined,
        machine_operator: undefined,
      };
    const machine = p.machine_id
      ? machines.find((m) => m.id === p.machine_id)
      : machines.find((m) => m.is_default && m.active);
    if (!machine?.active)
      throw new Error("Selecione uma máquina ativa desta oficina.");
    const rate = machineRate(machine, p.method, p.installments);
    if (rate === undefined)
      throw new Error(
        "Esta modalidade e quantidade de parcelas não têm taxa cadastrada na máquina.",
      );
    if (rate !== p.card_fee_bps)
      throw new Error(
        "A taxa da máquina mudou. Atualize as máquinas e taxas para revisar o recebimento.",
      );
    return {
      ...p,
      machine_id: machine.id,
      machine_name: machine.name,
      machine_operator: machine.operator,
      card_fee_bps: rate,
    };
  });
  return "payments" in input
    ? { payments: resolved as MixedPaymentInput["payments"] }
    : resolved[0];
}
