-- 047_fee_types_registry.sql
-- Canonical fee/collection type registry shared by Fee Setup and Collection Reports.

CREATE TABLE IF NOT EXISTS fee_types (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  description TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, code)
);

ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS fee_type_id TEXT DEFAULT NULL;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS custom_fee_type_name TEXT DEFAULT NULL;
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS fee_type_id TEXT DEFAULT NULL;
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS custom_fee_type_name TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_types_scope
  ON fee_types(school_id, is_active, code);
CREATE INDEX IF NOT EXISTS idx_fee_collection_fee_type
  ON fee_collection_records(school_id, fee_type_id, collection_date);
CREATE INDEX IF NOT EXISTS idx_fee_structure_fee_type
  ON fee_structures(school_id, fee_type_id, academic_year_id, term_id);

-- System types are seeded once per school by the deployment migration runner.
-- Existing Extra Classes and Canteen rows remain in fee_collection_records.
