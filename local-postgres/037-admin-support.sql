CREATE SCHEMA platform_support;
GRANT USAGE ON SCHEMA platform_support TO hp_platform_admin_app;
-- Chamados privados; a aplicação operacional acessa apenas funções com identidade de sessão.
CREATE TABLE platform_support.support_tickets (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES horse_power.tenants(id),
 opened_by text NOT NULL REFERENCES horse_power.users(id), subject text NOT NULL CHECK(length(subject) BETWEEN 5 AND 160),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_workshop','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE INDEX support_tickets_tenant_updated ON platform_support.support_tickets(tenant_id,updated_at DESC);
CREATE TABLE platform_support.support_messages (
 id text PRIMARY KEY, tenant_id text NOT NULL, ticket_id text NOT NULL,
 sender_kind text NOT NULL CHECK(sender_kind IN ('workshop','admin')),
 sender_id text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,ticket_id) REFERENCES platform_support.support_tickets(tenant_id,id)
);
CREATE INDEX support_messages_ticket_created ON platform_support.support_messages(tenant_id,ticket_id,created_at,id);
ALTER TABLE platform_support.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_support.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_admin_tickets ON platform_support.support_tickets TO hp_platform_admin_app USING(true) WITH CHECK(true);
CREATE POLICY support_admin_messages ON platform_support.support_messages TO hp_platform_admin_app USING(true) WITH CHECK(true);
REVOKE ALL ON platform_support.support_tickets,platform_support.support_messages FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON platform_support.support_tickets TO hp_platform_admin_app;
GRANT SELECT,INSERT ON platform_support.support_messages TO hp_platform_admin_app;

CREATE FUNCTION platform_support.workshop_support_identity() RETURNS TABLE(tenant_id text,user_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t text:=nullif(current_setting('app.tenant_id',true),''); u text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 IF session_user NOT IN ('hp_local_app','horse_power_app') OR t IS NULL OR u IS NULL OR NOT EXISTS
   (SELECT 1 FROM horse_power.memberships m WHERE m.tenant_id=t AND m.user_id=u) THEN
   RAISE EXCEPTION 'Sessão da oficina inválida' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT t,u;
END $$;
CREATE FUNCTION platform_support.workshop_support_list()
RETURNS TABLE(id text,subject text,status text,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.id,s.subject,s.status,s.created_at,s.updated_at
 FROM platform_support.support_tickets s CROSS JOIN platform_support.workshop_support_identity() i
 WHERE s.tenant_id=i.tenant_id ORDER BY s.updated_at DESC LIMIT 100
$$;
CREATE FUNCTION platform_support.workshop_support_messages(p_ticket text)
RETURNS TABLE(id text,sender_kind text,body text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.id,m.sender_kind,m.body,m.created_at FROM platform_support.support_messages m
 CROSS JOIN platform_support.workshop_support_identity() i
 WHERE m.tenant_id=i.tenant_id AND m.ticket_id=p_ticket ORDER BY m.created_at,m.id LIMIT 500
$$;
CREATE FUNCTION platform_support.workshop_support_create(p_id text,p_message_id text,p_subject text,p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i record;
BEGIN
 SELECT * INTO i FROM platform_support.workshop_support_identity();
 INSERT INTO platform_support.support_tickets(id,tenant_id,opened_by,subject)
 VALUES(p_id,i.tenant_id,i.user_id,p_subject);
 INSERT INTO platform_support.support_messages(id,tenant_id,ticket_id,sender_kind,sender_id,body)
 VALUES(p_message_id,i.tenant_id,p_id,'workshop',i.user_id,p_body);
END $$;
CREATE FUNCTION platform_support.workshop_support_reply(p_ticket text,p_message_id text,p_body text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i record;
BEGIN
 SELECT * INTO i FROM platform_support.workshop_support_identity();
 UPDATE platform_support.support_tickets SET status='open',updated_at=now()
 WHERE tenant_id=i.tenant_id AND id=p_ticket;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO platform_support.support_messages(id,tenant_id,ticket_id,sender_kind,sender_id,body)
 VALUES(p_message_id,i.tenant_id,p_ticket,'workshop',i.user_id,p_body);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION platform_support.workshop_support_identity(),platform_support.workshop_support_list(),
 platform_support.workshop_support_messages(text),platform_support.workshop_support_create(text,text,text,text),
 platform_support.workshop_support_reply(text,text,text) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['hp_local_app','horse_power_app'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('GRANT USAGE ON SCHEMA platform_support TO %I',r);
   EXECUTE format('GRANT EXECUTE ON FUNCTION platform_support.workshop_support_identity(),platform_support.workshop_support_list(),platform_support.workshop_support_messages(text),platform_support.workshop_support_create(text,text,text,text),platform_support.workshop_support_reply(text,text,text) TO %I',r);
  END IF;
 END LOOP;
END $$;
