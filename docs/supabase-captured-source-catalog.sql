-- Read-only catalog capture for the OSAAH 12-table structural rehearsal.
-- Run only in the positively identified OSAAH source project. This file reads
-- PostgreSQL catalog metadata and information_schema only; it does not read
-- school, student, parent, staff, credential, or session rows.
--
-- Review outputs locally before sharing. Routine bodies are represented only
-- by a digest so that embedded literals are not copied into the report.

-- 1. Identify the catalog target and execution role.
SELECT current_database() AS database_name,
       current_user AS current_role,
       session_user AS session_role,
       current_schema() AS current_schema,
       current_setting('search_path') AS search_path,
       current_setting('server_version') AS server_version;

-- 2. Public relations and row-security flags.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind AS relation_kind,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relpersistence AS persistence
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
ORDER BY c.relkind, c.relname;

-- 3. Exact public column definitions, including defaults and generated expressions.
SELECT table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_schema,
       udt_name,
       character_maximum_length,
       numeric_precision,
       numeric_scale,
       datetime_precision,
       is_nullable,
       column_default,
       is_identity,
       identity_generation,
       identity_start,
       identity_increment,
       identity_minimum,
       identity_maximum,
       is_generated,
       generation_expression,
       collation_name
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 4. Exact primary-key, unique, foreign-key, check, exclusion, and not-null constraints.
SELECT n.nspname AS schema_name,
       r.relname AS table_name,
       c.conname AS constraint_name,
       c.contype AS constraint_type,
       c.convalidated AS validated,
       c.condeferrable AS deferrable,
       c.condeferred AS initially_deferred,
       c.connoinherit AS no_inherit,
       pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
WHERE n.nspname = 'public'
ORDER BY r.relname, c.contype, c.conname;

-- 5. Exact public index definitions and validity state.
SELECT schemaname,
       tablename,
       indexname,
       indexdef,
       tablespace,
       (SELECT i.indisvalid
          FROM pg_class ic
          JOIN pg_index i ON i.indexrelid = ic.oid
         WHERE ic.relname = pg_indexes.indexname
           AND ic.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = pg_indexes.schemaname)
         LIMIT 1) AS is_valid
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 6. Complete public RLS policy commands, roles, and row predicates.
SELECT schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual AS using_expression,
       with_check AS check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 7. Schema, table, column, sequence, and routine grants.
SELECT 'schema' AS object_kind,
       n.nspname AS object_schema,
       n.nspname AS object_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
       grantor.rolname AS grantor,
       acl.privilege_type,
       CASE WHEN acl.is_grantable THEN 'YES' ELSE 'NO' END AS is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public'
UNION ALL
SELECT 'table', table_schema, table_name, grantee, grantor, privilege_type, is_grantable
FROM information_schema.table_privileges
WHERE table_schema = 'public'
UNION ALL
SELECT 'column', table_schema, table_name || '.' || column_name, grantee, grantor, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE table_schema = 'public'
UNION ALL
SELECT 'sequence', n.nspname, c.relname,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
       grantor.rolname,
       acl.privilege_type,
       CASE WHEN acl.is_grantable THEN 'YES' ELSE 'NO' END
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public' AND c.relkind = 'S'
UNION ALL
SELECT 'routine', routine_schema, routine_name || '(' || specific_name || ')', grantee, grantor, privilege_type, is_grantable
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
ORDER BY 1, 2, 3, 4, 5, 6;

-- 8. Sequence ownership and current definition metadata (no sequence values).
SELECT schemaname,
       sequencename,
       sequenceowner,
       data_type,
       start_value,
       min_value,
       max_value,
       increment_by,
       cycle,
       cache_size
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;

-- 9. Role attributes and memberships. These are role metadata, not credentials.
SELECT rolname,
       rolsuper,
       rolinherit,
       rolcreaterole,
       rolcreatedb,
       rolcanlogin,
       rolreplication,
       rolbypassrls,
       rolconnlimit,
       rolvaliduntil
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
   OR rolname IN (SELECT roleid.rolname
                    FROM pg_auth_members m
                    JOIN pg_roles roleid ON roleid.oid = m.roleid
                    JOIN pg_roles memberid ON memberid.oid = m.member
                   WHERE memberid.rolname IN ('anon', 'authenticated', 'service_role', 'postgres'))
   OR rolname IN (SELECT memberid.rolname
                    FROM pg_auth_members m
                    JOIN pg_roles roleid ON roleid.oid = m.roleid
                    JOIN pg_roles memberid ON memberid.oid = m.member
                   WHERE roleid.rolname IN ('anon', 'authenticated', 'service_role', 'postgres'))
ORDER BY rolname;

SELECT roleid.rolname AS granted_role,
       memberid.rolname AS member_role,
       grantor.rolname AS grantor_role,
       m.admin_option,
       m.inherit_option,
       m.set_option
FROM pg_auth_members m
JOIN pg_roles roleid ON roleid.oid = m.roleid
JOIN pg_roles memberid ON memberid.oid = m.member
JOIN pg_roles grantor ON grantor.oid = m.grantor
WHERE roleid.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
   OR memberid.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY granted_role, member_role;

-- 10. Default ACLs that can affect objects created later.
SELECT n.nspname AS schema_name,
       pg_get_userbyid(d.defaclrole) AS owner_role,
       d.defaclobjtype AS object_type,
       d.defaclacl AS default_acl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE d.defaclnamespace = 0 OR n.nspname = 'public'
ORDER BY schema_name, owner_role, object_type;

-- 11. Views and materialized views. Definitions are SQL metadata, not row data.
SELECT schemaname,
       viewname,
       md5(definition) AS definition_md5
FROM pg_views
WHERE schemaname = 'public'
UNION ALL
SELECT schemaname,
       matviewname,
       md5(definition) AS definition_md5
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY 1, 2;

-- 12. Public routine identities and execution properties. Body text is not emitted.
SELECT n.nspname AS schema_name,
       p.proname AS routine_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS result_type,
       l.lanname AS language,
       p.prokind AS routine_kind,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proparallel AS parallel_safety,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_arguments;

-- 13. Public triggers and the routines they invoke.
SELECT n.nspname AS schema_name,
       r.relname AS table_name,
       t.tgname AS trigger_name,
       t.tgenabled AS enabled_state,
       pg_get_triggerdef(t.oid, true) AS definition,
       pn.nspname AS routine_schema,
       p.proname AS routine_name,
       pg_get_function_identity_arguments(p.oid) AS routine_arguments
FROM pg_trigger t
JOIN pg_class r ON r.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY r.relname, t.tgname;

-- 14. Installed extensions and their schemas/versions.
SELECT e.extname,
       e.extversion,
       n.nspname AS extension_schema,
       e.extrelocatable
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

-- 15. Dependencies touching public relations; names only, never referenced rows.
SELECT pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object,
       pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) AS referenced_object,
       d.deptype AS dependency_type
FROM pg_depend d
LEFT JOIN pg_class dep_rel
       ON d.classid = 'pg_class'::regclass AND dep_rel.oid = d.objid
LEFT JOIN pg_namespace dep_ns ON dep_ns.oid = dep_rel.relnamespace
LEFT JOIN pg_class ref_rel
       ON d.refclassid = 'pg_class'::regclass AND ref_rel.oid = d.refobjid
LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref_rel.relnamespace
WHERE dep_ns.nspname = 'public' OR ref_ns.nspname = 'public'
ORDER BY dependent_object, referenced_object, dependency_type;

-- 16. Migration-ledger presence and structure only. Do not read unrelated ledger data.
SELECT to_regclass('public.schema_migrations') AS public_schema_migrations_relation;

SELECT table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'schema_migrations'
ORDER BY ordinal_position;
