/** Formas que podem ser quitadas integralmente sem configuração financeira. */
export const basicOrderReceiptMethods = ["Pix", "Dinheiro", "Transferência"] as const;
export type BasicOrderReceiptMethod = typeof basicOrderReceiptMethods[number];
