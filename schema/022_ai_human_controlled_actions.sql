CREATE TABLE IF NOT EXISTS ai_human_controlled_actions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  proposed_change TEXT NOT NULL,
  sanitized_payload TEXT NOT NULL,
  required_prepare_permission TEXT NOT NULL,
  required_approval_permission TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED')),
  submitted_at TEXT,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id),
  executed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key TEXT NOT NULL,
  integrity TEXT NOT NULL CHECK (length(integrity) = 64),
  failure_code TEXT,
  failure_reason TEXT,
  execution_result TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (school_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_actions_school_status ON ai_human_controlled_actions (school_id, status, created_at DESC);
