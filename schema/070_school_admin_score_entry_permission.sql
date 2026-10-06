-- Additive forward migration for the Part 1 Administrator Score Entry release.
-- Do not edit historical migration 032; production may already have applied it.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES ('permission-marks-write', 'marks.write', 'Write marks');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'marks.write'
WHERE r.role_key = 'SCHOOL_ADMIN';
