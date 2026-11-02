CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX password_reset_tokens_user_created ON password_reset_tokens(user_id,created_at DESC);
CREATE TABLE password_reset_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX password_reset_attempts_email_time ON password_reset_attempts(email_hash,requested_at DESC);
CREATE INDEX password_reset_attempts_ip_time ON password_reset_attempts(ip_hash,requested_at DESC);
INSERT INTO migrations(version) VALUES(32);
