-- 040_fee_structures_v2.sql
-- CANONICAL PUBLISHED FEE STRUCTURES
-- Additive only: preserves the existing fee_structures contract and history.

CREATE TABLE IF NOT EXISTS fee_structures_v2 (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  academic_year_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  fee_type VARCHAR(128) NOT NULL,
  description TEXT DEFAULT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  published_by TEXT DEFAULT NULL REFERENCES users(id),
  published_at TEXT DEFAULT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_by TEXT DEFAULT NULL REFERENCES users(id),
  updated_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_v2_scope
  ON fee_structures_v2(school_id, academic_year_id, term_id, class_id);

CREATE INDEX IF NOT EXISTS idx_fee_structures_v2_status
  ON fee_structures_v2(school_id, status);

CREATE INDEX IF NOT EXISTS idx_fee_structures_v2_type
  ON fee_structures_v2(school_id, fee_type);
