-- Additive metadata for the existing canonical subjects table.
-- The KG component labels describe assessment components within each scored
-- parent subject; they do not create separate mark-bearing subjects.
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS assessment_components_json JSON NULL,
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE subject_class_assignments
  ADD COLUMN IF NOT EXISTS configuration_version VARCHAR(32) NULL;
