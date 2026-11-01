export type CardRate = {
  method: string;
  installments: number;
  fee_bps: number;
};
export type CardMachine = {
  id: string;
  name: string;
  operator: string;
  active: number;
  is_default: number;
  max_installments: number;
  rates: CardRate[];
};
export function machineRate(
  machine: CardMachine | undefined,
  method: string,
  installments: number,
) {
  if (!machine?.active || installments > machine.max_installments)
    return undefined;
  return machine.rates.find(
    (r) => r.method === method && r.installments === installments,
  )?.fee_bps;
}
export function selectCardMachine<
  T extends {
    method: string;
    installments: number;
    card_fee_bps: number;
    machine_id?: string;
  },
>(
  input: T,
  machines: CardMachine[],
  machineId?: string,
): T & { machine_id: string } {
  if (!input.method.startsWith("Cartão"))
    return { ...input, machine_id: "", card_fee_bps: 0 };
  const machine =
    machineId !== undefined
      ? machines.find((m) => m.id === machineId && m.active)
      : machines.find((m) => m.id === input.machine_id && m.active) ||
        machines.find((m) => m.active && m.is_default);
  return {
    ...input,
    machine_id: machine?.id || "",
    card_fee_bps: machineRate(machine, input.method, input.installments) ?? 0,
  };
}
