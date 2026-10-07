-- 074_durable_promotion_rollover.sql
-- Additive decision context for durable, term-scoped promotion and rollover.
-- Existing promotion records are retained; nullable added fields preserve legacy rows.
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS class_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS term_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS to_class_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS next_academic_year_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS next_term_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS completion_year VARCHAR(64) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS source_enrollment_id VARCHAR(191) NULL;
ALTER TABLE promotion_decisions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_decision_idempotency
  ON promotion_decisions (school_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_promotion_decision_context
  ON promotion_decisions (school_id, academic_year_id, class_id, term_id);
