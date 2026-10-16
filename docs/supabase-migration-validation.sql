-- Read-only validation for supabase/migrations/202610150002_reconcile_existing_supabase.sql.
-- Run each SELECT in Supabase SQL Editor after a separately approved migration.
-- This file does not insert, update, delete, grant, revoke, or alter objects.

-- 0) Exact canonical table, column, and constraint contracts are enforced by the
-- transactional starter signature in migration 202610150002. These read-only
-- checks prove canonical object counts and required auth/workflow objects exist.
SELECT 'public_base_tables' AS check_name, count(*)::bigint AS actual, 159::bigint AS expected
FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'public_views',count(*)::bigint,6::bigint
FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'starter_archive_tables',count(*)::bigint,7::bigint
FROM information_schema.tables WHERE table_schema='osaah_legacy_20261015' AND table_type='BASE TABLE';

-- Required auth and core workflow relations. This should return no missing rows.
WITH required(name) AS (VALUES
 ('users'),('roles'),('permissions'),('user_roles'),('role_permissions'),('auth_sessions'),
 ('students'),('student_profiles'),('student_enrollments'),('parent_student_links'),
 ('student_attendance'),('staff_attendance'),('academic_score_records'),('examinations'),
 ('examination_marks'),('mock_examinations'),('mock_examination_marks'),('fee_structures'),
 ('fee_obligations'),('student_fee_accounts'),('student_fee_ledger'),('student_fee_payments'),
 ('student_fee_receipts'),('general_income'),('general_expenses'),('budgets')
)
SELECT required.name AS missing_required_table
FROM required LEFT JOIN information_schema.tables t ON t.table_schema='public' AND t.table_name=required.name AND t.table_type='BASE TABLE'
WHERE t.table_name IS NULL ORDER BY required.name;

-- Complete hosted schema fingerprint material for comparison/audit. Compare the
-- sorted output to the canonical migration after running the guarded migration.
SELECT table_name,ordinal_position,column_name,format_type(a.atttypid,a.atttypmod) AS column_type,
       is_nullable,column_default,is_identity,identity_generation,is_generated,generation_expression
FROM information_schema.columns c JOIN pg_class t ON t.relname=c.table_name
JOIN pg_namespace n ON n.oid=t.relnamespace AND n.nspname='public'
JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
WHERE c.table_schema='public' ORDER BY table_name,ordinal_position;

SELECT t.relname AS table_name,con.conname,con.contype,pg_get_constraintdef(con.oid,true) AS definition,con.convalidated
FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' ORDER BY t.relname,con.conname;

SELECT s.relname AS sequence_name,format_type(q.seqtypid,null) AS data_type,q.seqstart,q.seqincrement,q.seqmax,q.seqmin,q.seqcache,q.seqcycle,
       tn.nspname AS owner_schema,t.relname AS owner_table,a.attname AS owner_column,d.deptype AS ownership_type
FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_sequence q ON q.seqrelid=s.oid
LEFT JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
WHERE sn.nspname='public' AND s.relkind='S' ORDER BY s.relname;

-- 1) Foreign keys and index counts. The canonical baseline declares 55 explicit
-- indexes; the catalog includes PK/unique/constraint indexes as well (294 in PGlite).
SELECT 'public_foreign_keys' AS check_name, count(*)::bigint AS actual,
       448::bigint AS expected
FROM pg_constraint con
JOIN pg_namespace n ON n.oid = con.connamespace
WHERE n.nspname = 'public' AND con.contype = 'f'
UNION ALL
SELECT 'public_catalog_indexes', count(*)::bigint, 294::bigint
FROM pg_indexes WHERE schemaname = 'public';

-- 1b) The archive must retain the starter relation definitions and row counts.
SELECT table_name, (xpath('/row/count/text()',query_to_xml(format('SELECT count(*) AS count FROM osaah_legacy_20261015.%I',table_name),false,true,'')))[1]::text::bigint AS row_count
FROM information_schema.tables WHERE table_schema='osaah_legacy_20261015' AND table_type='BASE TABLE'
ORDER BY table_name;

-- The archive schema and all archived relations must remain inaccessible to API roles.
SELECT has_schema_privilege('anon','osaah_legacy_20261015','USAGE') AS anon_schema_usage,
       has_schema_privilege('authenticated','osaah_legacy_20261015','USAGE') AS authenticated_schema_usage,
       has_schema_privilege('service_role','osaah_legacy_20261015','USAGE') AS service_role_schema_usage;
SELECT grantee,table_name,privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='osaah_legacy_20261015'
  AND grantee IN ('anon','authenticated','service_role','PUBLIC')
ORDER BY grantee,table_name,privilege_type;

-- Explicit index definitions can be compared by name to the 55 CREATE INDEX
-- statements in the canonical baseline.
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 3) Every public application table should have RLS. This should return no rows.
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND NOT c.relrowsecurity
ORDER BY c.relname;

-- 4) Expected policies: only the fixed single-school lookup is client-readable.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Expected: one SELECT policy on schools, for anon/authenticated, with
-- (id = 'sch_default_01'). No direct client policy should exist on private tables.

-- 5) Client-role table grants. Expected: no application-table privileges except
-- SELECT on schools. Treat any other row as a security failure requiring review.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee, table_name, privilege_type;

-- 6) Server role assumptions and grants (never expose service_role credentials).
SELECT rolname, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role')
ORDER BY rolname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'service_role'
ORDER BY table_name, privilege_type;

-- 7) Required single-school record. Expected exactly one row.
SELECT id, name
FROM public.schools
WHERE id = 'sch_default_01';

-- 8) Archive should be outside the public API schema and have no RLS policies.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'osaah_legacy_20261015'
ORDER BY table_name;

SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'osaah_legacy_20261015';

-- Note: catalog checks do not prove application authorization. Separately test
-- denied anon/authenticated access and server-only service access in non-production.
