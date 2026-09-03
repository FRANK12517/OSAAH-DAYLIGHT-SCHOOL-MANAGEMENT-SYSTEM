PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  school_id TEXT REFERENCES schools(id),
  user_id TEXT REFERENCES users(id),
  role_key TEXT,
  capability_id TEXT,
  tool_name TEXT,
  operation_type TEXT,
  authorization_result TEXT,
  data_scope_json TEXT,
  production_data_only INTEGER,
  data_quality_status TEXT,
  request_status TEXT NOT NULL,
  duration_ms INTEGER,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost TEXT,
  error_code TEXT,
  action_requested INTEGER NOT NULL DEFAULT 0,
  action_executed INTEGER NOT NULL DEFAULT 0,
  approval_user_id TEXT REFERENCES users(id),
  rejection_user_id TEXT REFERENCES users(id),
  action_decision_at TEXT,
  target_record_id TEXT,
  rollback_reference_id TEXT,
  environment TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_timestamp ON ai_audit_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_request ON ai_audit_logs(request_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_audit_logs(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_school ON ai_audit_logs(school_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_capability ON ai_audit_logs(capability_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_status ON ai_audit_logs(request_status, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_operation ON ai_audit_logs(operation_type, occurred_at);
