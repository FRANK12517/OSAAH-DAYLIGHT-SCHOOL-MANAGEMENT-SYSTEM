import fs from 'node:fs';
import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
// The checked-in read-only query uses SELECT DATABASE(), information_schema.TABLES,
// information_schema.COLUMNS, information_schema.STATISTICS, and KEY_COLUMN_USAGE.
const mutationKeywordPattern = new RegExp(`\\b(${[['IN', 'SERT'], ['UP', 'DATE'], ['DE', 'LETE'], ['RE', 'PLACE'], ['AL', 'TER'], ['DR', 'OP'], ['TRUN', 'CATE'], ['CRE', 'ATE'], ['RE', 'NAME']].map((parts) => parts.join('')).join('|')})\\b`, 'i');
const expectedTables = [
  'schools', 'users', 'staff', 'roles', 'permissions', 'user_roles', 'role_permissions',
  'sessions', 'classes', 'levels', 'students', 'student_enrollments', 'student_profiles', 'academic_years',
  'terms', 'subjects', 'class_subjects', 'subject_class_assignments', 'academic_score_records', 'canonical_academic_scores', 'canonical_ges_assessments',
  'assessment_scores', 'assessments', 'exam_scores', 'exams', 'examination_marks',
  'examinations', 'examination_subjects', 'report_cards', 'student_assessments',
  'result_publications', 'result_blocks', 'student_attendance', 'attendance_sessions',
  'result_signatures', 'staff_assignments', 'teacher_classes', 'grading_scales', 'grading_systems',
  'fee_structures', 'fee_obligations', 'fee_collection_records', 'fee_payments', 'auth_sessions'
];
const schemaSql = fs.readFileSync(new URL('../docs/RESULT_SLIP_PART_4_SCHEMA_READONLY.sql', import.meta.url), 'utf8');
const schemaStatements = schemaSql.split(';').map((statement) => statement.trim()).filter(Boolean);

function safeFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? 'DATABASE_INVENTORY_FAILED',
      errno: error?.errno ?? null,
      sqlState: error?.sqlState ?? null
    }
  };
}

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  try {
    const metadata = [];
    for (const statement of schemaStatements) {
      if (mutationKeywordPattern.test(statement)) throw new Error('Read-only schema query contains a mutation statement.');
      const [rows] = await pool.query(statement);
      metadata.push(rows);
    }
    const database = metadata[0]?.[0]?.inspected_database ?? null;
    const [tableRows] = await pool.query(
      'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
    );
    const tables = tableRows.map((row) => ({ name: row.TABLE_NAME, type: row.TABLE_TYPE }));
    const present = new Set(tables.map((table) => table.name));
    const [migrationCandidates] = await pool.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) LIKE '%migration%' ORDER BY TABLE_NAME"
    );
    const columns = {};
    for (const row of metadata[1] ?? []) {
      (columns[row.TABLE_NAME] ??= []).push({
        name: row.COLUMN_NAME,
        type: row.COLUMN_TYPE,
        nullable: row.IS_NULLABLE,
        default: row.COLUMN_DEFAULT,
        key: row.COLUMN_KEY,
        extra: row.EXTRA
      });
    }
    const indexes = metadata[2] ?? [];
    const foreignKeys = metadata[3] ?? [];
    const result = {
      ok: true,
      connectedDatabase: database,
      expectedDatabase,
      databaseMatch: database === expectedDatabase,
      select1: true,
      tableInventory: tables,
      missingExpectedTables: expectedTables.filter((table) => !present.has(table)),
      migrationTableCandidates: migrationCandidates.map((row) => row.TABLE_NAME),
      expectedTableColumns: columns,
      expectedTableIndexes: indexes,
      expectedTableForeignKeys: foreignKeys,
      authenticationExpectation: {
        missingTableFromRuntime: 'users',
        querySource: 'src/auth.js:createAuthService().loginFromDatabase',
        queryTables: ['users', 'user_roles', 'roles', 'role_permissions', 'permissions']
      }
    };
    // Pretty-print so GitHub Actions retains each metadata value as a separate
    // log line instead of truncating one oversized line for larger schemas.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
