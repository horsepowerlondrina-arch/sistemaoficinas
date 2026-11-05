-- ADM billing: additive foundation. No existing workshop status or plan changes.
SET search_path=pg_catalog;

CREATE TABLE IF NOT EXISTS platform_admin.plan_prices (
  plan_code text PRIMARY KEY CHECK (plan_code IN ('basic','professional','premium')),
  monthly_price_cents integer CHECK (monthly_price_cents IS NULL OR monthly_price_cents > 0),
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code='BRL'),
  price_version integer NOT NULL DEFAULT 0 CHECK (price_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_by_admin_id text,
  reason text NOT NULL DEFAULT ''
);
INSERT INTO platform_admin.plan_prices(plan_code) VALUES ('basic'),('professional'),('premium')
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_admin.billing_subscriptions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL UNIQUE REFERENCES horse_power.tenants(id),
  UNIQUE (id, tenant_id),
  plan_code text NOT NULL CHECK (plan_code IN ('basic','professional','premium')),
  price_version integer NOT NULL CHECK (price_version >= 1),
  monthly_price_cents integer NOT NULL CHECK (monthly_price_cents > 0),
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code='BRL'),
  provider text NOT NULL DEFAULT 'mercado_pago' CHECK (provider='mercado_pago'),
  provider_subscription_id text UNIQUE,
  provider_status text NOT NULL DEFAULT 'pending',
  payment_mode text NOT NULL DEFAULT 'unknown' CHECK (payment_mode IN ('unknown','card','pix')),
  current_period_end timestamptz,
  last_confirmed_paid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (last_confirmed_paid_until IS NULL OR last_confirmed_paid_until <= current_period_end)
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx
  ON platform_admin.billing_subscriptions(provider_status,current_period_end);

CREATE TABLE IF NOT EXISTS platform_admin.billing_invoices (
  id text PRIMARY KEY,
  subscription_id text NOT NULL,
  tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
  FOREIGN KEY (subscription_id, tenant_id)
    REFERENCES platform_admin.billing_subscriptions(id, tenant_id),
  provider_payment_id text UNIQUE,
  provider_invoice_id text UNIQUE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency_code text NOT NULL DEFAULT 'BRL' CHECK (currency_code='BRL'),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','refunded','cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (subscription_id,period_start),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS billing_invoices_tenant_idx
  ON platform_admin.billing_invoices(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS platform_admin.billing_webhook_events (
  provider_event_id text PRIMARY KEY,
  topic text NOT NULL,
  resource_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  processed_at timestamptz,
  result text NOT NULL CHECK (result IN ('received','processed','ignored','failed'))
);

REVOKE ALL ON platform_admin.plan_prices,platform_admin.billing_subscriptions,
  platform_admin.billing_invoices,platform_admin.billing_webhook_events FROM PUBLIC;
DO $grants$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hp_platform_admin_app') THEN
    GRANT SELECT,INSERT,UPDATE ON platform_admin.plan_prices,
      platform_admin.billing_subscriptions,platform_admin.billing_invoices,
      platform_admin.billing_webhook_events TO hp_platform_admin_app;
  END IF;
END $grants$;
