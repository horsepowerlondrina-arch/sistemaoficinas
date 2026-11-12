export function receiptIsCompleteAfterSettlement(
  parts: Array<{ id: string; method?: string; status?: string }>,
  settledId: string,
  isCredit: boolean,
) {
  return parts.every((part) =>
    part.status === "paid" ||
    (isCredit ? part.method === "Cartão de crédito" : part.id === settledId)
  );
}
