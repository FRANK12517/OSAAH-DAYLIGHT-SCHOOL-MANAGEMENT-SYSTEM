-- Additive fee obligation label for custom Fee Setup types (e.g. Other).
-- Existing fee structures and obligations remain valid; the field is nullable
-- so historical records retain their original semantics.
ALTER TABLE fee_obligations ADD COLUMN IF NOT EXISTS custom_fee_type_name VARCHAR(128) DEFAULT NULL;
