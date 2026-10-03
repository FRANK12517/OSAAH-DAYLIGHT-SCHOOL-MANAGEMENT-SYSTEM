import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

export const EXPECTED_DATABASE = 'osaahdaylightschool';
export const MIGRATION_063 = Object.freeze({
  version: 63,
  name: '063_subject_classification.sql',
  checksum: '6bc83d1411f4813eadd577fa4de6c43d9e979e1baca59f4222d0689456f828e7'
});

const READ_ONLY_STATEMENT = /^\s*SELECT\b/i;
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE|CALL|SET|DO|GRANT|REVOKE)\b/i;

export function assertReadOnlyQuery(sql) {
  if (!READ_ONLY_STATEMENT.test(sql) || FORBIDDEN_SQL.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error('Migration 063 inventory accepts only one read-only SELECT statement.');
  }
}

async function query(pool, sql, params = []) {
  assertReadOnlyQuery(sql);
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function collectMigration063Inventory(pool, {
  expectedDatabase = EXPECTED_DATABASE
} = {}) {
  const [databaseRow] = await query(pool, 'SELECT DATABASE() AS database_name');
  const connectedDatabase = databaseRow?.database_name ?? null;
  if (connectedDatabase !== expectedDatabase) {
    throw Object.assign(new Error('Connected database does not match the protected inventory target.'), {
      code: 'DATABASE_TARGET_MISMATCH',
      connectedDatabase,
      expectedDatabase
    });
  }

  const tables = await query(pool, `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('schema_migrations', 'schema_baselines', 'subjects',
        'academic_score_records', 'canonical_academic_scores',
        'subject_class_assignments', 'class_subjects', 'result_signatures')
    ORDER BY TABLE_NAME`);
  const columns = await query(pool, `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
    COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
    COLUMN_KEY AS column_key, ORDINAL_POSITION AS ordinal_position
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND ((TABLE_NAME = 'subjects' AND COLUMN_NAME IN ('subject_type', 'is_scoring'))
        OR TABLE_NAME IN ('schema_migrations', 'schema_baselines'))
    ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const indexes = await query(pool, `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
    NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index, COLUMN_NAME AS column_name
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('subjects', 'schema_migrations', 'schema_baselines')
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`);
  const subjectClassification = await query(pool, `SELECT subject_type, is_scoring, COUNT(*) AS row_count
    FROM subjects
    GROUP BY subject_type, is_scoring
    ORDER BY subject_type, is_scoring`);
  const subjectCount = await query(pool, 'SELECT COUNT(*) AS row_count FROM subjects');
  const dependentCounts = {};
  for (const table of [
    'academic_score_records', 'canonical_academic_scores', 'subject_class_assignments',
    'class_subjects', 'result_signatures'
  ]) {
    const present = tables.some((row) => row.table_name === table);
    dependentCounts[table] = present
      ? Number((await query(pool, `SELECT COUNT(*) AS row_count FROM \`${table}\``))[0]?.row_count ?? 0)
      : null;
  }
  const migrationRows = await query(pool, `SELECT version, name, checksum, applied_at
    FROM schema_migrations
    WHERE version IN (63, 64, 65)
    ORDER BY version`);
  const baselineRows = await query(pool, `SELECT id, canonical_database, baseline_at, repository_commit,
    schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type,
    historical_migrations_executed, created_at
    FROM schema_baselines
    ORDER BY baseline_at`);

  return {
    ok: true,
    readOnly: true,
    productionWrites: 'NONE',
    connectedDatabase,
    expectedDatabase,
    databaseMatch: true,
    migration063: MIGRATION_063,
    tables,
    columns,
    indexes,
    subjectCount: Number(subjectCount[0]?.row_count ?? 0),
    subjectClassification,
    dependentCounts,
    migrationRows,
    baselineRows
  };
}

function safeFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? 'MIGRATION_063_INVENTORY_FAILED',
      sqlState: error?.sqlState ?? null,
      errno: error?.errno ?? null,
      connectedDatabase: error?.connectedDatabase ?? null,
      expectedDatabase: error?.expectedDatabase ?? EXPECTED_DATABASE
    }
  };
}

export async function runMigration063Inventory({
  databaseUrl = process.env.DATABASE_URL,
  output = process.stdout
} = {}) {
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
    output.write(`${JSON.stringify(await collectMigration063Inventory(pool), null, 2)}\n`);
    return true;
  } catch (error) {
    output.write(`${JSON.stringify(safeFailure(error))}\n`);
    return false;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const succeeded = await runMigration063Inventory();
  if (!succeeded) process.exitCode = 1;
}
