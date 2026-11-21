-- Persist uploaded, processed PNG signatures and their canonical identity/scope.
-- Existing metadata rows remain valid and are left untouched.
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS staff_id VARCHAR(191) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS phone_number VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS class_id VARCHAR(191) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS academic_year VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS term VARCHAR(64) NULL;
ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS processed_image_data LONGTEXT NULL;
