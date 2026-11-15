-- The billing role receives only the limit of a lower plan and the aggregate occupancy.
CREATE FUNCTION platform_admin.downgrade_seats(p_tenant text, p_plan text)
RETURNS TABLE(seat_limit integer, occupied integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce(CASE WHEN NOT (e.override_expires_at ? 'max_users')
                         OR (e.override_expires_at->>'max_users')::timestamptz > statement_timestamp()
                       THEN e.max_users_override END,
                  CASE WHEN d.configured THEN d.max_users END),
         (s->>'user_count')::integer
  FROM platform_admin.workshop_entitlement_status(p_tenant) s
  JOIN platform_admin.plan_defaults d ON d.plan_code=p_plan
  LEFT JOIN platform_admin.workshop_entitlements e ON e.tenant_id=p_tenant
  WHERE (s->>'effective_plan_code'='premium' AND p_plan IN ('basic','professional'))
     OR (s->>'effective_plan_code'='professional' AND p_plan='basic')
$$;
REVOKE ALL ON FUNCTION platform_admin.downgrade_seats(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.downgrade_seats(text,text) TO hp_platform_admin_app;

-- The existing BEFORE guards serialize changes with checkout on the workshop seat lock.
-- Keep the target capacity reserved while a checkout can still settle.
CREATE FUNCTION horse_power.guard_pending_downgrade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM platform_admin.stripe_checkouts x
   JOIN platform_admin.stripe_prices p ON p.id=x.price_id
   CROSS JOIN LATERAL platform_admin.downgrade_seats(x.tenant_id,p.plan_code) s
   JOIN platform_admin.stripe_accounts a ON a.tenant_id=x.tenant_id
   WHERE x.tenant_id=NEW.tenant_id AND (x.status IN ('pending','open')
       OR (x.method='card' AND x.subscription_id=a.subscription_id AND x.status='paid'))
     AND s.occupied>s.seat_limit
 ) THEN
   RAISE EXCEPTION 'Limite de usuários do plano em contratação atingido.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION horse_power.guard_pending_downgrade() FROM PUBLIC;
CREATE TRIGGER downgrade_membership AFTER INSERT ON horse_power.memberships
 FOR EACH ROW EXECUTE FUNCTION horse_power.guard_pending_downgrade();
CREATE TRIGGER downgrade_reactivation AFTER UPDATE OF active ON horse_power.workshop_user_access
 FOR EACH ROW WHEN (OLD.active=0 AND NEW.active=1) EXECUTE FUNCTION horse_power.guard_pending_downgrade();
CREATE TRIGGER downgrade_invite AFTER INSERT OR UPDATE ON horse_power.workshop_user_invites
 FOR EACH ROW WHEN (NEW.revoked_at IS NULL AND NEW.accepted_at IS NULL)
 EXECUTE FUNCTION horse_power.guard_pending_downgrade();
