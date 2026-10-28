import test from "node:test";
import assert from "node:assert/strict";
import { selectPaymentMethod } from "../shared/paymentMethod";

test("cart pass-through stays opt-in when changing payment method and uses the registered rate", () => {
  const configured = selectPaymentMethod(
    {
      method: "Pix",
      installments: 1,
      card_fee_bps: 0,
      interest_bps: 0,
      pass_card_fee: false,
      first_due_on: "2026-10-27",
    },
    "Cartão de crédito",
    1450,
  );
  assert.equal(configured.pass_card_fee, false);
  assert.equal(configured.card_fee_bps, 1450);
  assert.equal(configured.installments, 1);
  const enabledByUser = { ...configured, pass_card_fee: true };
  assert.equal(enabledByUser.pass_card_fee, true);
});
