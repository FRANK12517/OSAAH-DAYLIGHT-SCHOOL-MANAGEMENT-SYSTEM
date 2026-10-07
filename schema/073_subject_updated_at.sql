-- Add the nullable timestamp required by the durable subject write paths.
-- Existing subject rows are preserved; updated_at is populated on subsequent writes.
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS updated_at VARCHAR(50) NULL DEFAULT NULL;
