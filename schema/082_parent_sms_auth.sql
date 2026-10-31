-- Durable parent SMS verification challenges and shared rate-limit buckets.
-- Challenge digests only; plaintext verification codes are never persisted.
CREATE TABLE IF NOT EXISTS parent_auth_challenges (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  normalized_phone VARCHAR(20) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  code_digest CHAR(64) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  expires_at VARCHAR(64) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at VARCHAR(64),
  invalidated_at VARCHAR(64),
  KEY idx_parent_auth_challenges_active (school_id,user_id,purpose,consumed_at,invalidated_at,expires_at),
  KEY idx_parent_auth_challenges_phone (school_id,normalized_phone,purpose,created_at)
);
CREATE TABLE IF NOT EXISTS parent_auth_rate_limits (
  bucket_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at VARCHAR(64) NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  updated_at VARCHAR(64) NOT NULL,
  KEY idx_parent_auth_rate_limits_updated (updated_at)
);
