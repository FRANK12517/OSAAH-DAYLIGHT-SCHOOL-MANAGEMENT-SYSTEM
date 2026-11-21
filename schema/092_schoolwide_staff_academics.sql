-- Explicit school-wide academic access for teachers and complete mock-result
-- access for School Administrators. Tenant isolation remains enforced by the
-- academic service for every request.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES
  ('permission-academics-schoolwide', 'academics.schoolwide', 'Access school-wide academic classes and records');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'academics.schoolwide'
WHERE r.role_key = 'TEACHER';

INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES
  ('permission-mock-results-read', 'mock.results.read', 'Read mock results'),
  ('permission-mock-results-generate', 'mock.results.generate', 'Generate mock results');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN ('mock.results.read', 'mock.results.generate')
WHERE r.role_key = 'SCHOOL_ADMIN';
