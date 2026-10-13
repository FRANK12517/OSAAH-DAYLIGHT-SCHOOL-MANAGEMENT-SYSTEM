-- Align the School Administrator role with the admissions module contract.
-- The module is already visible to this role; these are the narrowly scoped
-- read/write permissions required by its options, saved-application, and draft
-- registration endpoints.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES
  ('permission-admissions-read', 'admissions.read', 'Read admission applications'),
  ('permission-admissions-write', 'admissions.write', 'Create and update admission applications');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('admissions.read', 'admissions.write')
WHERE r.role_key = 'SCHOOL_ADMIN';
