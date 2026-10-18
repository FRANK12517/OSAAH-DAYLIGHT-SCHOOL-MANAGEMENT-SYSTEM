import { createHash } from 'node:crypto';

export const CAPTURED_SCHEMA = 'osaah_recovery_20261018';
export const CAPTURED_MIGRATION_VERSION = 20261018;

const expectedUdtNames = new Map([
  ['bigint', 'int8'], ['integer', 'int4'], ['uuid', 'uuid'], ['text', 'text'],
  ['date', 'date'], ['timestamptz', 'timestamptz'], ['boolean', 'bool'], ['numeric', 'numeric']
]);

function parseCapturedColumns(auditMarkdown) {
  const result = [];
  for (const line of auditMarkdown.split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim());
    const tableMatch = cells[1]?.match(/^`([^`]+)`$/);
    if (!tableMatch || !cells[2]) continue;
    const tableName = tableMatch[1];
    const definitions = cells[2];
    for (const definition of definitions.split(';')) {
      const column = definition.trim().replace(/^`|`$/g, '').match(/^([^ ]+) ([^ ]+(?:\([^)]*\))?)(.*)$/);
      if (!column) continue;
      const [, columnName, declaredType, attributes] = column;
      const baseType = declaredType.replace(/\(.*/, '');
      const udtName = expectedUdtNames.get(baseType);
      if (!udtName) throw new Error(`Unsupported catalog type in captured audit: ${declaredType}`);
      const precision = declaredType.match(/^numeric\((\d+),(\d+)\)$/);
      result.push({
        tableName, columnName, udtName,
        precision: precision ? Number(precision[1]) : baseType === 'bigint' ? 64 : baseType === 'integer' ? 32 : null,
        scale: precision ? Number(precision[2]) : baseType === 'bigint' || baseType === 'integer' ? 0 : null,
        notNull: /\bNOT NULL\b/.test(attributes),
        identity: /\bIDENTITY ALWAYS\b/.test(attributes)
      });
    }
  }
  if (result.length !== 77) throw new Error(`Expected 77 captured columns, found ${result.length}`);
  return result;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function preflightSql(columns) {
  const tableRows = [...new Set(columns.map(({ tableName }) => tableName))]
    .sort().map((table) => `    ${sqlLiteral(table)}`).join(',\n');
  const columnRows = columns.map(({ tableName, columnName, udtName, precision, scale, notNull, identity }) =>
    `    (${sqlLiteral(tableName)}, ${sqlLiteral(columnName)}, ${sqlLiteral(udtName)}, ${precision ?? 'null'}, ${scale ?? 'null'}, ${notNull}, ${identity})`
  ).join(',\n');
  return `-- Fail closed unless the source matches the captured public catalog exactly.\nDO $$\nDECLARE actual_tables text[];\nBEGIN\n  IF to_regnamespace('${CAPTURED_SCHEMA}') IS NOT NULL THEN\n    RAISE EXCEPTION 'Structural migration target schema already exists; inspect its schema_migrations ledger';\n  END IF;\n  IF to_regclass('public.schema_migrations') IS NOT NULL THEN\n    RAISE EXCEPTION 'Captured source precondition changed: public.schema_migrations exists';\n  END IF;\n  SELECT array_agg(tablename ORDER BY tablename) INTO actual_tables\n    FROM pg_tables WHERE schemaname='public';\n  IF actual_tables IS DISTINCT FROM ARRAY[\n${tableRows}\n  ]::text[] THEN\n    RAISE EXCEPTION 'Captured source table set does not match the approved 12-table profile';\n  END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public') THEN\n    RAISE EXCEPTION 'Captured source unexpectedly contains public views';\n  END IF;\n  IF (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace\n      WHERE n.nspname='public' AND c.contype='p') <> 12\n     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace\n         WHERE n.nspname='public' AND c.contype='u') <> 11\n     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace\n         WHERE n.nspname='public' AND c.contype='f') <> 15\n     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace\n         WHERE n.nspname='public' AND c.contype='c') <> 8 THEN\n    RAISE EXCEPTION 'Captured source constraint counts changed; review before structural preparation';\n  END IF;\n  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace\n      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) <> 12 THEN\n    RAISE EXCEPTION 'Captured source RLS state changed';\n  END IF;\nEND $$;\n\nCREATE TEMP TABLE osaah_captured_expected_columns (\n  table_name text, column_name text, udt_name text, numeric_precision integer, numeric_scale integer,\n  is_not_null boolean, is_identity boolean, PRIMARY KEY (table_name, column_name)\n) ON COMMIT DROP;\nINSERT INTO pg_temp.osaah_captured_expected_columns VALUES\n${columnRows};\nDO $$\nBEGIN\n  IF EXISTS (\n    (SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,\n            is_not_null, is_identity\n       FROM pg_temp.osaah_captured_expected_columns\n     EXCEPT\n     SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,\n            is_nullable='NO', is_identity='YES'\n       FROM information_schema.columns WHERE table_schema='public')\n    UNION ALL\n    (SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,\n            is_nullable='NO', is_identity='YES'\n       FROM information_schema.columns WHERE table_schema='public'\n     EXCEPT\n     SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,\n            is_not_null, is_identity\n       FROM pg_temp.osaah_captured_expected_columns)\n  ) THEN\n    RAISE EXCEPTION 'Captured source columns, types, nullability, or identity attributes changed';\n  END IF;\n  IF EXISTS (SELECT 1 FROM public.users GROUP BY email HAVING count(*) > 1)\n     OR EXISTS (SELECT 1 FROM public.roles GROUP BY name HAVING count(*) > 1)\n     OR EXISTS (SELECT 1 FROM public.user_roles GROUP BY user_id, role_id HAVING count(*) > 1) THEN\n    RAISE EXCEPTION 'Duplicate source account, role, or assignment keys require owner review';\n  END IF;\nEND $$;\n\nCREATE TEMP TABLE osaah_captured_source_counts (table_name text PRIMARY KEY, row_count bigint) ON COMMIT DROP;\nDO $$\nDECLARE table_name text; row_total bigint;\nBEGIN\n  FOREACH table_name IN ARRAY ARRAY[${[...new Set(columns.map(({ tableName }) => tableName))].sort().map(sqlLiteral).join(', ')}] LOOP\n    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_total;\n    INSERT INTO pg_temp.osaah_captured_source_counts VALUES (table_name, row_total);\n  END LOOP;\nEND $$;\n\n`;
}

const isolatedSecurity = `-- Keep the prepared application schema private until a reviewed runtime role and policies exist.\nDO $$ DECLARE t record; BEGIN\n  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='${CAPTURED_SCHEMA}' LOOP\n    EXECUTE format('ALTER TABLE ${CAPTURED_SCHEMA}.%I ENABLE ROW LEVEL SECURITY', t.tablename);\n  END LOOP;\nEND $$;\nREVOKE ALL ON SCHEMA ${CAPTURED_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;\nREVOKE ALL ON ALL TABLES IN SCHEMA ${CAPTURED_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;\nREVOKE ALL ON ALL SEQUENCES IN SCHEMA ${CAPTURED_SCHEMA} FROM PUBLIC, anon, authenticated, service_role;\n`;

const postconditions = `-- Structural postconditions; source rows and public objects remain untouched.\nDO $$\nDECLARE actual_count bigint;\nBEGIN\n  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='${CAPTURED_SCHEMA}' AND table_type='BASE TABLE') <> 159\n     OR (SELECT count(*) FROM information_schema.views WHERE table_schema='${CAPTURED_SCHEMA}') <> 6\n     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace\n         WHERE n.nspname='${CAPTURED_SCHEMA}' AND c.contype='f') <> 448\n     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace\n         WHERE n.nspname='${CAPTURED_SCHEMA}' AND c.relkind IN ('r','p') AND c.relrowsecurity) <> 159 THEN\n    RAISE EXCEPTION 'Canonical schema postcondition failed';\n  END IF;\n  IF has_schema_privilege('anon','${CAPTURED_SCHEMA}','USAGE')\n     OR has_schema_privilege('authenticated','${CAPTURED_SCHEMA}','USAGE')\n     OR has_schema_privilege('service_role','${CAPTURED_SCHEMA}','USAGE') THEN\n    RAISE EXCEPTION 'Prepared schema unexpectedly grants API-role schema access';\n  END IF;\n  IF (SELECT count(*) FROM ${CAPTURED_SCHEMA}.schema_migrations) <> 1\n     OR NOT EXISTS (SELECT 1 FROM ${CAPTURED_SCHEMA}.schema_migrations\n                    WHERE version=${CAPTURED_MIGRATION_VERSION} AND name='captured-12-table-structural-stage'\n                      AND checksum='__STRUCTURAL_SHA256__') THEN\n    RAISE EXCEPTION 'Structural migration ledger postcondition failed';\n  END IF;\n  IF (SELECT count(*) FROM ${CAPTURED_SCHEMA}.schools) <> 0\n     OR (SELECT count(*) FROM ${CAPTURED_SCHEMA}.users) <> 0\n     OR (SELECT count(*) FROM ${CAPTURED_SCHEMA}.roles) <> 0\n     OR (SELECT count(*) FROM ${CAPTURED_SCHEMA}.user_roles) <> 0\n     OR (SELECT count(*) FROM ${CAPTURED_SCHEMA}.parent_student_links) <> 0\n     OR (SELECT count(*) FROM ${CAPTURED_SCHEMA}.auth_sessions) <> 0 THEN\n    RAISE EXCEPTION 'Structural stage must not create school, account, role, Parent, or session data';\n  END IF;\n  FOR actual_count IN SELECT row_count FROM pg_temp.osaah_captured_source_counts LOOP\n    NULL;\n  END LOOP;\nEND $$;\nDO $$ DECLARE t record; observed bigint; BEGIN\n  FOR t IN SELECT table_name, row_count FROM pg_temp.osaah_captured_source_counts LOOP\n    EXECUTE format('SELECT count(*) FROM public.%I', t.table_name) INTO observed;\n    IF observed <> t.row_count THEN\n      RAISE EXCEPTION 'Source row count changed for public.%', t.table_name;\n    END IF;\n  END LOOP;\n  IF to_regclass('public.schema_migrations') IS NOT NULL THEN\n    RAISE EXCEPTION 'Structural stage unexpectedly modified the public migration ledger';\n  END IF;\nEND $$;\n`;

export function renderCapturedStructuralMigration(canonicalSql, auditMarkdown) {
  const columns = parseCapturedColumns(auditMarkdown);
  let body = canonicalSql.replace(/\r\n/g, '\n').replace(/^\s*begin;\s*/i, '');
  body = body.replace(/-- Preserve the production school identifier[\s\S]*?on conflict \(id\) do nothing;\s*/i, '');
  body = body.replace(/-- Migration 078 permissions:[\s\S]*?on conflict \(role_id,permission_id\) do nothing;\s*/i, '');
  body = body.replace(/-- Remove browser\/API roles' table grants[\s\S]*?COMMIT;\s*$/i, '');
  body = body.replaceAll('public.', `${CAPTURED_SCHEMA}.`).replaceAll("'public'", `'${CAPTURED_SCHEMA}'`);
  if (/\b(?:insert into|INSERT INTO)\s+osaah_recovery_20261018\.(?:schools|users|roles|permissions|role_permissions|user_roles|parent_student_links|auth_sessions)\b/i.test(body)) {
    throw new Error('Structural stage cannot seed school, identity, role, permission, Parent, or session data');
  }
  if (/\b(?:grant|GRANT)\b/.test(body) || /\bcreate policy\b/i.test(body)) {
    throw new Error('Structural stage must not assign runtime grants or policies');
  }
  body = body.replaceAll("schemaname='public'", `schemaname='${CAPTURED_SCHEMA}'`)
    .replaceAll("table_schema='public'", `table_schema='${CAPTURED_SCHEMA}'`);
  body = body.trim().replace(/\s*COMMIT;\s*$/i, '');

  let sql = `-- Versioned additive structural preparation for the captured 12-table catalog.\n-- This creates a private canonical schema; it does not rename, alter, archive, or copy public records.\n-- It retains the canonical single-school identity sch_default_01 without inserting a school row.\n-- Generated from the canonical baseline and captured catalog evidence; review the source before regeneration.\nBEGIN;\n\n${preflightSql(columns)}CREATE SCHEMA ${CAPTURED_SCHEMA};\n\n${body}\n${isolatedSecurity}\nINSERT INTO ${CAPTURED_SCHEMA}.schema_migrations(version,name,checksum,applied_at)\nVALUES (${CAPTURED_MIGRATION_VERSION},'captured-12-table-structural-stage','__STRUCTURAL_SHA256__',now());\n\n${postconditions}\nDROP TABLE pg_temp.osaah_captured_source_counts;\nDROP TABLE pg_temp.osaah_captured_expected_columns;\nCOMMIT;\n`;
  const checksum = createHash('sha256').update(sql).digest('hex');
  sql = sql.replaceAll('__STRUCTURAL_SHA256__', checksum);
  return { sql, checksum };
}
