CREATE TABLE workshop_user_access (
 tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile IN ('master','manager','advisor','mechanic','finance')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 permissions TEXT NOT NULL DEFAULT '{}', order_scope TEXT NOT NULL DEFAULT 'all' CHECK(order_scope IN ('all','assigned')),
 discount_bps INTEGER NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 10000),
 discount_cents INTEGER CHECK(discount_cents>=0),
 PRIMARY KEY(tenant_id,user_id), FOREIGN KEY(user_id,tenant_id) REFERENCES memberships(user_id,tenant_id) ON DELETE CASCADE
);
INSERT INTO workshop_user_access(tenant_id,user_id,profile,discount_bps)
 SELECT tenant_id,user_id,CASE WHEN role='owner' THEN 'master' ELSE 'mechanic' END,CASE WHEN role='owner' THEN 10000 ELSE 0 END FROM memberships;
CREATE TABLE staff_accounts (
 tenant_id TEXT NOT NULL, professional_id TEXT NOT NULL, user_id TEXT,
 productive INTEGER NOT NULL DEFAULT 1 CHECK(productive IN (0,1)),
 PRIMARY KEY(tenant_id,professional_id), UNIQUE(tenant_id,user_id),
 FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES memberships(user_id,tenant_id) ON DELETE CASCADE
);
CREATE TABLE workshop_user_invites (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),email TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile IN ('master','manager','advisor','mechanic','finance')),
 permissions TEXT NOT NULL DEFAULT '{}',order_scope TEXT NOT NULL DEFAULT 'all' CHECK(order_scope IN ('all','assigned')),
 discount_bps INTEGER NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 10000), discount_cents INTEGER CHECK(discount_cents>=0),
 professional_id TEXT,token_hash TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,accepted_at INTEGER,
 FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id)
);
CREATE INDEX workshop_invites_pending ON workshop_user_invites(tenant_id,email,expires_at);
CREATE TABLE session_reauthentication(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,authenticated_at INTEGER NOT NULL);
CREATE TABLE order_assignments (
 tenant_id TEXT NOT NULL,order_id TEXT NOT NULL,professional_id TEXT NOT NULL,assigned_by TEXT NOT NULL REFERENCES users(id),assigned_at INTEGER NOT NULL,removed_at INTEGER,
 PRIMARY KEY(tenant_id,order_id,professional_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,professional_id) REFERENCES professionals(tenant_id,id)
);
CREATE TABLE discount_requests (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,order_id TEXT NOT NULL,requester_id TEXT NOT NULL REFERENCES users(id),
 subtotal INTEGER NOT NULL CHECK(subtotal>=0),discount INTEGER NOT NULL CHECK(discount>=0),state_digest TEXT NOT NULL,
 justification TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','invalidated')),
 created_at INTEGER NOT NULL,decided_by TEXT REFERENCES users(id),decided_at INTEGER,decision_reason TEXT,
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE TABLE session_office_choices(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)));
INSERT INTO migrations(version) VALUES(33);
