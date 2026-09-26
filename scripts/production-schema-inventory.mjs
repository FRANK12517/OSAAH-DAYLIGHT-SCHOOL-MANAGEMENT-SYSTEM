import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

export const EXPECTED_DATABASE = 'osaahdaylightschool';
export const RESULT_SUPPORT_TABLES = Object.freeze([
  'student_attendance', 'attendance_sessions', 'attendance_audit_history', 'result_signatures',
  'staff_profiles', 'staff_assignments', 'teacher_classes', 'teachers', 'users', 'roles', 'user_roles',
  'classes', 'students', 'student_profiles', 'student_enrollments', 'academic_years', 'terms'
]);

const EXPECTED_TABLES = Object.freeze([...new Set([
  ...RESULT_SUPPORT_TABLES, 'schools', 'staff', 'permissions', 'role_permissions', 'sessions', 'levels',
  'subjects', 'class_subjects', 'subject_class_assignments', 'academic_score_records',
  'canonical_academic_scores', 'canonical_ges_assessments', 'assessment_scores', 'assessments',
  'exam_scores', 'exams', 'examination_marks', 'examinations', 'examination_subjects', 'report_cards',
  'student_assessments', 'result_publications', 'result_blocks', 'grading_scales', 'grading_systems',
  'fee_structures', 'fee_obligations', 'fee_collection_records', 'fee_payments', 'auth_sessions'
])]);

const tableNamesQuery = `SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES
  WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME`;
const allForeignKeysQuery = `SELECT k.TABLE_NAME,k.COLUMN_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,
  k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,rc.UPDATE_RULE,rc.DELETE_RULE
  FROM information_schema.KEY_COLUMN_USAGE k
  LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND rc.TABLE_NAME=k.TABLE_NAME AND rc.CONSTRAINT_NAME=k.CONSTRAINT_NAME
  WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`;

function resultRows(result) { return Array.isArray(result?.[0]) ? result[0] : Array.isArray(result) ? result : []; }
function placeholders(names) { return `(${names.map(() => '?').join(',')})`; }
function assertMetadataQuery(sql) {
  if (!/^\s*SELECT\b/i.test(sql) || !/(?:information_schema|DATABASE\s*\(\s*\))/i.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error('Production schema inventory accepts only single metadata SELECT queries.');
  }
}

async function queryMetadata(pool, sql, params = []) {
  assertMetadataQuery(sql);
  return resultRows(await pool.query(sql, params));
}

function safeFailure(error) {
  return {
    ok: false,
    ...(error?.code === 'DATABASE_NAME_MISMATCH' ? {
      connectedDatabase: error.connectedDatabase,
      expectedDatabase: error.expectedDatabase,
      databaseMatch: false
    } : {}),
    error: {
      code: error?.code ?? 'DATABASE_INVENTORY_FAILED',
      errno: error?.errno ?? null,
      sqlState: error?.sqlState ?? null
    }
  };
}

export async function collectProductionSchemaMetadata(pool, { expectedDatabase = EXPECTED_DATABASE } = {}) {
  const databaseRow = (await queryMetadata(pool, 'SELECT DATABASE() AS inspected_database'))[0];
  const connectedDatabase = databaseRow?.inspected_database ?? null;
  if (connectedDatabase !== expectedDatabase) {
    throw Object.assign(new Error('Connected database does not match the protected inventory target.'), {
      code: 'DATABASE_NAME_MISMATCH', connectedDatabase, expectedDatabase
    });
  }

  const tables = await queryMetadata(pool, tableNamesQuery);
  const tableSet = new Set(tables.map((row) => row.TABLE_NAME));
  const allForeignKeys = await queryMetadata(pool, allForeignKeysQuery);
  const relevantSet = new Set(RESULT_SUPPORT_TABLES);
  // Include tables directly joined to the requested contract tables by declared FKs.
  for (const key of allForeignKeys) {
    if (RESULT_SUPPORT_TABLES.includes(key.TABLE_NAME) || RESULT_SUPPORT_TABLES.includes(key.REFERENCED_TABLE_NAME)) {
      relevantSet.add(key.TABLE_NAME);
      relevantSet.add(key.REFERENCED_TABLE_NAME);
    }
  }
  const relevantTables = [...relevantSet].sort();
  const inClause = placeholders(relevantTables);
  const params = relevantTables;
  const columns = await queryMetadata(pool, `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,
    IS_NULLABLE,DATA_TYPE,COLUMN_TYPE,CHARACTER_MAXIMUM_LENGTH,NUMERIC_PRECISION,NUMERIC_SCALE,COLUMN_KEY,EXTRA
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ${inClause}
    ORDER BY TABLE_NAME,ORDINAL_POSITION`, params);
  const constraints = await queryMetadata(pool, `SELECT tc.TABLE_NAME,tc.CONSTRAINT_NAME,tc.CONSTRAINT_TYPE,
    k.COLUMN_NAME,k.ORDINAL_POSITION AS POSITION_IN_CONSTRAINT
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
      AND k.TABLE_NAME=tc.TABLE_NAME AND k.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME IN ${inClause}
      AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')
    ORDER BY tc.TABLE_NAME,tc.CONSTRAINT_TYPE,tc.CONSTRAINT_NAME,k.ORDINAL_POSITION`, params);
  const indexes = await queryMetadata(pool, `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,
    COLUMN_NAME,INDEX_TYPE,SUB_PART
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ${inClause}
    ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`, params);
  const foreignKeys = allForeignKeys.filter((key) => relevantSet.has(key.TABLE_NAME) && relevantSet.has(key.REFERENCED_TABLE_NAME));

  return {
    ok: true,
    connectedDatabase,
    expectedDatabase,
    databaseMatch: true,
    tableInventory: tables,
    missingExpectedTables: EXPECTED_TABLES.filter((name) => !tableSet.has(name)),
    metadataTables: relevantTables,
    columns,
    constraints,
    indexes,
    foreignKeys
  };
}

export async function runProductionSchemaInventory({ databaseUrl = process.env.DATABASE_URL, output = process.stdout } = {}) {
  if (!databaseUrl) {
    output.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
    return false;
  }
  const pool = mysql.createPool({
    uri: databaseUrl,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  try {
    const result = await collectProductionSchemaMetadata(pool);
    // Line-oriented pretty JSON keeps schema metadata readable in Actions logs.
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return true;
  } catch (error) {
    output.write(`${JSON.stringify(safeFailure(error))}\n`);
    return false;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const succeeded = await runProductionSchemaInventory();
  if (!succeeded) process.exitCode = 1;
}
