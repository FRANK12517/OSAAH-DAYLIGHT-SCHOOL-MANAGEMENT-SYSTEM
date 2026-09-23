-- Part 5: collection-specific periods. Vacation Classes is not an academic term.
ALTER TABLE fee_collection_records ADD COLUMN IF NOT EXISTS collection_period VARCHAR(32) DEFAULT NULL;
UPDATE fee_collection_records SET collection_period = term_id WHERE collection_period IS NULL;
CREATE INDEX IF NOT EXISTS idx_fee_collections_period_scope ON fee_collection_records(school_id, collection_type, academic_year_id, collection_period, collection_date);
