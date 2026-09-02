-- Seed data is deterministic and safe to rerun during environment setup.
INSERT OR IGNORE INTO schools (id, name, motto, address, logo_path, primary_colour, secondary_colour, accent_colour, created_at, updated_at) VALUES ('school-osaah-daylight', 'OSAAH DAYLIGHT SCH. COM.', 'AIM HIGH, ACADEMIC IS OUR CORE VALUE', 'BOGOSO', '/assets/osaah-daylight-logo.png', '#102a43', '#1769aa', '#d4a72c', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO permissions (id, permission_key, permission_name, created_at, updated_at) VALUES
 ('permission-settings-read', 'settings.read', 'View school settings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('permission-users-read', 'users.read', 'View users and roles', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO sidebar_categories (id, category_key, category_name, display_order, created_at, updated_at)
 SELECT 'category-' || lower(replace(category_name, ' ', '-')), category_name, category_name, display_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 FROM (SELECT 'ADMINISTRATIVE' category_name, 1 display_order UNION ALL SELECT 'STUDENTS MANAGEMENT', 2 UNION ALL SELECT 'ADMISSIONS', 3 UNION ALL SELECT 'ACADEMICS', 4 UNION ALL SELECT 'ATTENDANCE MANAGEMENT', 5 UNION ALL SELECT 'EXAMINATIONS & RESULTS', 6 UNION ALL SELECT 'FEE HUB', 7 UNION ALL SELECT 'FINANCE', 8 UNION ALL SELECT 'STAFF MANAGEMENT', 9 UNION ALL SELECT 'COMMUNICATION HUB', 10 UNION ALL SELECT 'LIBRARY MANAGEMENT', 11 UNION ALL SELECT 'TRANSPORT MANAGEMENT', 12 UNION ALL SELECT 'HOSTEL MANAGEMENT', 13 UNION ALL SELECT 'HEALTH & WELFARE', 14 UNION ALL SELECT 'INVENTORY & STORES', 15 UNION ALL SELECT 'ASSETS & PROPERTY', 16 UNION ALL SELECT 'PROCUREMENT', 17 UNION ALL SELECT 'COMPLIANCE & DOCUMENTS', 18 UNION ALL SELECT 'REPORTS & ANALYTICS', 19 UNION ALL SELECT 'SYSTEM & SECURITY', 20);

INSERT OR IGNORE INTO roles (id, school_id, role_key, role_name, oversight_rank, created_at, updated_at) VALUES
 ('role-proprietor', 'school-osaah-daylight', 'PROPRIETOR', 'Proprietor', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('role-school-admin', 'school-osaah-daylight', 'SCHOOL_ADMIN', 'School Admin', 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('role-headteacher', 'school-osaah-daylight', 'HEADTEACHER', 'Headteacher', 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('role-teacher', 'school-osaah-daylight', 'TEACHER', 'Teacher', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('role-parent', 'school-osaah-daylight', 'PARENT', 'Parent', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('role-student', 'school-osaah-daylight', 'STUDENT', 'Student', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO sidebar_modules (id, module_key, module_name, category_id, route, icon, display_order, required_permission, created_at, updated_at)
 SELECT 'module-dashboard', 'dashboard', 'Dashboard', id, '/', 'home', 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM sidebar_categories WHERE category_key = 'ADMINISTRATIVE';
INSERT OR IGNORE INTO sidebar_modules (id, module_key, module_name, category_id, route, icon, display_order, required_permission, created_at, updated_at)
 SELECT 'module-settings', 'settings', 'School Settings', id, '/settings', 'settings', 1, 'settings.read', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM sidebar_categories WHERE category_key = 'SYSTEM & SECURITY';
INSERT OR IGNORE INTO sidebar_modules (id, module_key, module_name, category_id, route, icon, display_order, required_permission, created_at, updated_at)
 SELECT 'module-users', 'users', 'Users & Roles', id, '/users', 'users', 2, 'users.read', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM sidebar_categories WHERE category_key = 'SYSTEM & SECURITY';
