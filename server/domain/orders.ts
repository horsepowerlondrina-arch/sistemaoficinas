export const statuses = [
  "quote",
  "open",
  "working",
  "ready",
  "completed",
  "cancelled",
] as const;
export type Status = (typeof statuses)[number];
export const transitions: Record<Status, Status[]> = {
  quote: ["open", "cancelled"],
  open: ["working", "cancelled"],
  working: ["ready", "cancelled"],
  ready: ["completed", "working", "cancelled"],
  completed: [],
  cancelled: [],
};
export function totalOf(
  items: { price: number; quantity: number }[],
  discount: number,
) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  if (!Number.isSafeInteger(subtotal) || discount > subtotal)
    throw new Error("O desconto não pode superar o valor dos itens.");
  return subtotal - discount;
}
export function calculateDiscountAmount(
  subtotal: number,
  mode: "money" | "percent",
  value: number,
) {
  if (!Number.isSafeInteger(subtotal) || subtotal < 0)
    throw new Error("Subtotal inválido para aplicar desconto.");
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Informe um desconto válido.");
  if (mode === "percent") {
    if (value > 10000)
      throw new Error("O desconto percentual não pode superar 100%.");
    return Math.min(subtotal, Math.round((subtotal * value) / 10000));
  }
  if (mode !== "money" || value > subtotal)
    throw new Error("O desconto não pode superar o valor dos itens.");
  return value;
}
export function assertTransition(from: Status, to: Status) {
  if (!transitions[from]?.includes(to))
    throw new Error("Esta mudança de situação não é permitida.");
}
