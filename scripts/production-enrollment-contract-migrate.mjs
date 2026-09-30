import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 59;
const NAME = '059_backward_compatible_enrollment_contract.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const mode = process.argv[2] ?? 'apply';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });

const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_059_FAILED', message: cause?.code ? cause.message : 'Migration 059 failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}

async function schemaSnapshot() {
  const tables = await adapter.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('students','student_enrollments')");
  const tableNames = new Set(tables.map((row) => row.TABLE_NAME));
  if (!tableNames.has('students') || !tableNames.has('student_enrollments')) throw Object.assign(new Error('Required enrollment tables are missing.'), { code: 'MIGRATION_059_TABLES_MISSING' });
  const columns = await adapter.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('students','student_enrollments') AND COLUMN_NAME IN ('school_id','term_id') ORDER BY TABLE_NAME,COLUMN_NAME");
  const enrollmentCount = await adapter.query('SELECT COUNT(*) AS row_count FROM student_enrollments');
  const orphanCount = await adapter.query('SELECT COUNT(*) AS row_count FROM student_enrollments e LEFT JOIN students s ON s.id=e.student_id WHERE s.id IS NULL');
  const nullSchoolCount = await adapter.query("SELECT COUNT(*) AS row_count FROM student_enrollments e JOIN students s ON s.id=e.student_id WHERE s.school_id IS NULL OR TRIM(CAST(s.school_id AS CHAR))=''");
  const schoolColumnPresent = columns.some((row) => row.TABLE_NAME === 'student_enrollments' && row.COLUMN_NAME === 'school_id');
  const nonNullEnrollmentSchoolCount = schoolColumnPresent ? await adapter.query('SELECT COUNT(*) AS row_count FROM student_enrollments WHERE school_id IS NOT NULL') : [{ row_count: 0 }];
  const indexes = await adapter.query("SELECT INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' GROUP BY INDEX_NAME");
  return {
    columns,
    enrollmentCount: Number(enrollmentCount[0]?.row_count ?? 0),
    orphanCount: Number(orphanCount[0]?.row_count ?? 0),
    nullSchoolCount: Number(nullSchoolCount[0]?.row_count ?? 0),
    nonNullEnrollmentSchoolCount: Number(nonNullEnrollmentSchoolCount[0]?.row_count ?? 0),
    compatibilityIndex: indexes.find((row) => row.INDEX_NAME === 'idx_student_enrollments_compat_scope') ?? null
  };
}

async function ledgerState() {
  await adapter.ensureMetadata({ create: false });
  const rows = await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]);
  return rows[0] ?? null;
}

function column(snapshot, table, name) {
  return snapshot.columns.find((item) => item.TABLE_NAME === table && item.COLUMN_NAME === name) ?? null;
}
function assertPostSchema(snapshot, migration) {
  const school = column(snapshot, 'student_enrollments', 'school_id');
  const term = column(snapshot, 'student_enrollments', 'term_id');
  if (!school || String(school.COLUMN_TYPE).toLowerCase() !== 'varchar(191)' || String(school.IS_NULLABLE).toUpperCase() !== 'YES' || school.COLUMN_DEFAULT !== null) throw Object.assign(new Error('Migration 059 school_id definition is incompatible.'), { code: 'MIGRATION_059_SCHEMA_VERIFICATION_FAILED', details: { school } });
  if (!term || String(term.COLUMN_TYPE).toLowerCase() !== 'varchar(64)' || String(term.IS_NULLABLE).toUpperCase() !== 'YES' || term.COLUMN_DEFAULT !== null) throw Object.assign(new Error('Migration 059 term_id definition is incompatible.'), { code: 'MIGRATION_059_SCHEMA_VERIFICATION_FAILED', details: { term } });
  if (!snapshot.compatibilityIndex) throw Object.assign(new Error('Migration 059 compatibility index is missing.'), { code: 'MIGRATION_059_INDEX_VERIFICATION_FAILED' });
  return migration;
}

async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_059_FILE_MISSING' });
  const beforeSchema = await schemaSnapshot();
  const beforeLedger = await ledgerState();
  if (beforeSchema.orphanCount !== 0 || beforeSchema.nullSchoolCount !== 0) throw Object.assign(new Error('Enrollment provenance preflight failed.'), { code: 'MIGRATION_059_PREFLIGHT_FAILED', details: { orphanCount: beforeSchema.orphanCount, nullSchoolCount: beforeSchema.nullSchoolCount } });
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, beforeLedger, pending: dryRun.pending };
  const result = await runner.applyVersions({ versions: [VERSION], dryRun: false, verifyMigration: async ({ adapter: tx }) => {
    const rows = await tx.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND COLUMN_NAME IN ('school_id','term_id')");
    const school = rows.find((item) => item.COLUMN_NAME === 'school_id');
    const term = rows.find((item) => item.COLUMN_NAME === 'term_id');
    if (!school || String(school.COLUMN_TYPE).toLowerCase() !== 'varchar(191)' || String(school.IS_NULLABLE).toUpperCase() !== 'YES' || school.COLUMN_DEFAULT !== null || !term || String(term.COLUMN_TYPE).toLowerCase() !== 'varchar(64)' || String(term.IS_NULLABLE).toUpperCase() !== 'YES' || term.COLUMN_DEFAULT !== null) throw Object.assign(new Error('Migration 059 schema verification failed inside transaction.'), { code: 'MIGRATION_059_SCHEMA_VERIFICATION_FAILED' });
    const indexes = await tx.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND INDEX_NAME='idx_student_enrollments_compat_scope'");
    if (!indexes.length) throw Object.assign(new Error('Migration 059 index verification failed inside transaction.'), { code: 'MIGRATION_059_INDEX_VERIFICATION_FAILED' });
  } });
  const afterSchema = await schemaSnapshot();
  const afterLedger = await ledgerState();
  assertPostSchema(afterSchema, migration);
  if (beforeSchema.enrollmentCount !== afterSchema.enrollmentCount || beforeSchema.orphanCount !== afterSchema.orphanCount || beforeSchema.nullSchoolCount !== afterSchema.nullSchoolCount) throw Object.assign(new Error('Migration 059 changed enrollment aggregates unexpectedly.'), { code: 'MIGRATION_059_DATA_PRESERVATION_FAILED', details: { before: beforeSchema, after: afterSchema } });
  if (!afterLedger || Number(afterLedger.version) !== VERSION || afterLedger.name !== NAME || afterLedger.checksum !== migration.checksum) throw Object.assign(new Error('Migration 059 ledger verification failed.'), { code: 'MIGRATION_059_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, afterSchema, beforeLedger, afterLedger, rowsAffectedBySchoolBackfill: afterSchema.nonNullEnrollmentSchoolCount - beforeSchema.nonNullEnrollmentSchoolCount, historicalTermsFabricated: 0, applied: result.applied };
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; }
finally { await adapter.close?.(); }
