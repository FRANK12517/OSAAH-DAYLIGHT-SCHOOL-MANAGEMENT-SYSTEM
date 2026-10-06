-- Additive forward migration for Part 2 Results & Reports access.
-- Do not edit historical migration 032; production may already have applied it.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('results.read', 'results.generate', 'results.print')
WHERE r.role_key = 'SCHOOL_ADMIN';
