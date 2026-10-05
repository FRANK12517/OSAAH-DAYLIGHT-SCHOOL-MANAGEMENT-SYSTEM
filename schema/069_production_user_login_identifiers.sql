-- 069_production_user_login_identifiers.sql
-- Add only columns proven missing by the protected production inventory.
-- Existing users previously authenticated with email as their username; preserve
-- that exact legacy identifier while allowing new staff to persist a distinct one.
-- Keep both columns nullable because the existing admission-enrollment writer
-- intentionally omits username and updated_at for newly created Parent identities.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(191) NULL DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at VARCHAR(50) NULL DEFAULT NULL;

UPDATE users SET username = email WHERE username IS NULL AND email IS NOT NULL;
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL AND created_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_username ON users (school_id, username);
