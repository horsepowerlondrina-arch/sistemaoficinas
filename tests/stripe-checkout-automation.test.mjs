import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutStep, isTestCheckout, stripeCardForm } from '../scripts/e2e/stripe-checkout.mjs';
const address = 'https://checkout.stripe.com/g/pay/cs_test_ABC123#opaque';
test('a pending test checkout is resumed instead of creating another subscription', () => {
  assert.deepEqual(checkoutStep({ test_mode: true, account: null, pending: { url: address, method: 'card' }, prices: [], payments: [] }, 'basic'), { kind: 'resume' });
  assert.deepEqual(checkoutStep({ test_mode: true, account: { managed: true, plan_code: 'basic' }, prices: [], payments: [{ status: 'paid' }] }, 'basic'), { kind: 'done' });
  assert.throws(() => checkoutStep({ test_mode: false }, 'basic'));
  for (const url of [address.replace('cs_test_', 'cs_live_'), address.replace('checkout.stripe.com', 'attacker.test'), 'https://user:pass@checkout.stripe.com/c/pay/cs_test_ABC']) assert.equal(isTestCheckout(url), false);
});
test('only the actual provider card frame is filled; an unavailable form is a blocker', async () => {
  const frame = (host, count) => ({ url: () => 'https://' + host + '/', locator: () => ({ count: async () => count }) });
  const bad = frame('attacker.test', 1), card = frame('js.stripe.com', 1);
  assert.equal(await stripeCardForm({ url: () => address, frames: () => [bad, card] }, { attempts: 1, wait: async () => {} }), card);
  await assert.rejects(stripeCardForm({ url: () => address, frames: () => [bad] }, { attempts: 1, wait: async () => {} }), /PROVIDER_FORM_UNAVAILABLE/);
  await assert.rejects(stripeCardForm({ url: () => address.replace('cs_test_', 'cs_live_'), frames: () => [card] }), /STRIPE_TEST_CHECKOUT_REQUIRED/);
});
