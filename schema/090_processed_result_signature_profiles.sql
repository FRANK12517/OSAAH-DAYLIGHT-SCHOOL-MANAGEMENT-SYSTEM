-- Persist uploaded, processed PNG signatures and their canonical identity/scope.
-- Existing metadata rows remain valid and are left untouched.
-- Some deployed TiDB baselines name the role column `role`; add the canonical
-- name while the service reads/writes both columns when both are present.
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS signatory_role VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS staff_id VARCHAR(191) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS phone_number VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS class_id VARCHAR(191) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS term VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS processed_image_data LONGTEXT NULL;
