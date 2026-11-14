export function isTestCheckout(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password && /\/cs_test_[A-Za-z0-9]+(?:\/|$)/.test(u.pathname);
  } catch { return false; }
}

export function checkoutStep(summary, plan) {
  if (summary.test_mode !== true) throw Error('STRIPE_TEST_MODE_REQUIRED');
  if (summary.account?.managed && summary.account.plan_code === plan && summary.payments.some(p => p.status === 'paid')) return { kind: 'done' };
  if (summary.pending) {
    if (summary.pending.method !== 'card' || !isTestCheckout(summary.pending.url)) throw Error('PENDING_TEST_CHECKOUT_REQUIRED');
    return { kind: 'resume' };
  }
  const price = summary.prices.find(p => p.plan_code === plan);
  if (!price) throw Error('PRICE_REQUIRED');
  return { kind: 'choose', priceId: price.id };
}

export async function stripeCardForm(page, options = {}) {
  if (!isTestCheckout(page.url())) throw Error('STRIPE_TEST_CHECKOUT_REQUIRED');
  const attempts = options.attempts ?? 30;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const frame of page.frames()) {
      let host; try { host = new URL(frame.url()).hostname; } catch { continue; }
      if (!['checkout.stripe.com', 'js.stripe.com'].includes(host)) continue;
      if (await frame.locator('[name="cardNumber"]').count()) return frame;
    }
    await wait(500);
  }
  // Never click challenges, alter browser fingerprints, or synthesize a payment.
  throw Error('PROVIDER_FORM_UNAVAILABLE');
}
