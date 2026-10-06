-- Additive forward migration for the Part 3 School Administrator Mock Score Entry release.
-- Do not edit historical migrations; production may already have applied them.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES
  ('permission-mock-scores-read', 'mock.scores.read', 'Read mock scores'),
  ('permission-mock-scores-write', 'mock.scores.write', 'Write mock scores');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('mock.scores.read', 'mock.scores.write')
WHERE r.role_key = 'SCHOOL_ADMIN';
