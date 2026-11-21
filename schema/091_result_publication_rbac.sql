-- Grant scoped result publication to staff roles that manage academic results.
-- Teacher class boundaries remain enforced by the academic result service.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES ('permission-results-publish', 'results.publish', 'Publish academic results');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'results.publish'
WHERE r.role_key IN ('SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER');
