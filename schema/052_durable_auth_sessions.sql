-- 052_durable_auth_sessions.sql
-- Durable, cross-instance authentication sessions. Raw session tokens are never stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL REFERENCES users(id),
  school_id VARCHAR(191) NOT NULL REFERENCES schools(id),
  token_hash CHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32) DEFAULT NULL,
  last_used_at VARCHAR(32) DEFAULT NULL,
  UNIQUE(token_hash)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_school ON auth_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at, revoked_at);
