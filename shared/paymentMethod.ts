export type PaymentMethodForm = {
  method: string;
  installments: number;
  card_fee_bps: number;
  interest_bps: number;
  pass_card_fee: boolean;
};
export function selectPaymentMethod<T extends PaymentMethodForm>(
  current: T,
  method: string,
  registeredCardFeeBps: number,
): T {
  return {
    ...current,
    method,
    installments: 1,
    card_fee_bps: method.startsWith("Cartão") ? registeredCardFeeBps : 0,
    interest_bps: 0,
    pass_card_fee: false,
  };
}
