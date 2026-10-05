import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertAcademicRecordCountsPreserved } from './academic-record-count-guard.js';

const VERSION = 64;
const NAME = '064_academic_result_blocking.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_RESULT_BLOCKING_064';
const TABLES = ['academic_result_blocks', 'academic_result_unblock_requests'];
const BLOCK_COLUMNS = ['id', 'school_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope', 'status', 'reason', 'blocked_by', 'blocked_by_role', 'blocked_at', 'unblocked_by', 'unblocked_at'];
const REQUEST_COLUMNS = ['id', 'school_id', 'block_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope', 'reason', 'requested_by', 'requested_by_role', 'status', 'requested_at', 'decided_by', 'decided_at'];
const REQUIRED_PREREQUISITE_TABLES = ['schools', 'schema_migrations', 'schema_migration_lock'];
const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
if (mode === 'apply' && process.env.EXECUTION_TOKEN !== EXECUTION_TOKEN) throw Object.assign(new Error('Exact result blocking migration approval token is required.'), { code: 'MIGRATION_APPROVAL_REQUIRED' });
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_064_FAILED', message: cause?.code ? cause.message : 'Migration 064 failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}

async function migrationLedger() {
  await adapter.ensureMetadata({ create: false });
  return adapter.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version = ?', [VERSION]);
}

async function schemaSnapshot(database = adapter) {
  const tables = await database.query('SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?) ORDER BY TABLE_NAME', TABLES);
  const columns = await database.query('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?) ORDER BY TABLE_NAME, ORDINAL_POSITION', TABLES);
  const indexes = await database.query('SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seqInIndex FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', TABLES);
  const result = { tables: tables.map((row) => row.tableName), columns, indexes };
  for (const table of TABLES) {
    if (result.tables.includes(table)) {
      const count = await database.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
      result[table] = { exists: true, rowCount: Number(count[0]?.rowCount ?? 0) };
    } else result[table] = { exists: false, rowCount: null };
  }
  return result;
}

async function verifyPrerequisites(database = adapter) {
  const rows = await database.query('SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?) ORDER BY TABLE_NAME', REQUIRED_PREREQUISITE_TABLES);
  const present = new Set(rows.map((row) => row.tableName));
  const missing = REQUIRED_PREREQUISITE_TABLES.filter((table) => !present.has(table));
  if (missing.length) throw Object.assign(new Error('Migration 064 prerequisites are missing.'), { code: 'MIGRATION_064_PREREQUISITE_MISSING', details: { missing } });
  return { required: REQUIRED_PREREQUISITE_TABLES, present: [...present] };
}

async function academicRecordCounts(database = adapter) {
  const rows = await database.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (LOWER(TABLE_NAME) LIKE '%academic%' OR LOWER(TABLE_NAME) LIKE '%result%' OR LOWER(TABLE_NAME) LIKE '%score%' OR LOWER(TABLE_NAME) LIKE '%student%' OR LOWER(TABLE_NAME) LIKE '%parent%' OR LOWER(TABLE_NAME) LIKE '%term%' OR LOWER(TABLE_NAME) LIKE '%year%') ORDER BY TABLE_NAME");
  const counts = {};
  for (const row of rows) {
    const table = String(row.tableName);
    if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
    const result = await database.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    const rowCount = result[0]?.rowCount ?? 0;
    counts[table] = typeof rowCount === 'bigint' ? rowCount.toString() : rowCount;
  }
  return counts;
}

function verifySnapshot(snapshot) {
  if (snapshot.tables.length !== TABLES.length) throw Object.assign(new Error('Migration 064 did not create both required tables.'), { code: 'MIGRATION_064_SCHEMA_VERIFICATION_FAILED', details: { tables: snapshot.tables } });
  for (const [table, required] of [['academic_result_blocks', BLOCK_COLUMNS], ['academic_result_unblock_requests', REQUEST_COLUMNS]]) {
    const actual = new Set(snapshot.columns.filter((row) => row.tableName === table).map((row) => row.columnName));
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length) throw Object.assign(new Error(`Migration 064 table ${table} is missing required columns.`), { code: 'MIGRATION_064_SCHEMA_VERIFICATION_FAILED', details: { table, missing } });
  }
  const blockIndexes = new Set(snapshot.indexes.filter((row) => row.tableName === 'academic_result_blocks').map((row) => row.indexName));
  const requestIndexes = new Set(snapshot.indexes.filter((row) => row.tableName === 'academic_result_unblock_requests').map((row) => row.indexName));
  if (!blockIndexes.has('uq_academic_result_block_scope') || !blockIndexes.has('idx_academic_result_block_lookup') || !requestIndexes.has('idx_academic_result_unblock_lookup')) throw Object.assign(new Error('Migration 064 required indexes are missing.'), { code: 'MIGRATION_064_SCHEMA_VERIFICATION_FAILED' });
}

async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_064_FILE_MISSING' });
  if (/\b(DROP|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(migration.sql)) throw Object.assign(new Error('Migration 064 contains a destructive operation.'), { code: 'MIGRATION_064_DESTRUCTIVE_SQL' });
  const beforeLedger = await migrationLedger();
  const prerequisites = await verifyPrerequisites();
  const beforeSchema = await schemaSnapshot();
  const beforeAcademicCounts = await academicRecordCounts();
  const preexisting = beforeSchema.tables.length > 0;
  const recorded = beforeLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum);
  const partial = beforeSchema.tables.length > 0 && beforeSchema.tables.length < TABLES.length;
  if (partial) throw Object.assign(new Error('Migration 064 has a partial schema without both required tables; manual reconciliation is required.'), { code: 'MIGRATION_064_PARTIAL_SCHEMA', details: { tables: beforeSchema.tables, ledger: beforeLedger } });
  if (preexisting && !recorded) throw Object.assign(new Error('Migration 064 objects already exist without the matching ledger row; refusing ambiguous apply.'), { code: 'MIGRATION_064_PREEXISTING_OBJECTS', details: { tables: beforeSchema.tables, ledger: beforeLedger } });
  if (recorded) verifySnapshot(beforeSchema);
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, prerequisites, beforeLedger, beforeSchema, beforeAcademicCounts, pending: dryRun.pending, status: recorded ? 'ALREADY_APPLIED' : 'PENDING', productionWrites: 'NONE' };
  let afterAcademicCounts = null;
  const result = await runner.applyVersions({
    versions: [VERSION],
    requiredAppliedVersions: [63],
    dryRun: false,
    verifyMigration: async ({ adapter: tx }) => {
      verifySnapshot(await schemaSnapshot(tx));
      afterAcademicCounts = await academicRecordCounts(tx);
      assertAcademicRecordCountsPreserved(beforeAcademicCounts, afterAcademicCounts, { migrationCreatedTables: TABLES });
    }
  });
  if (afterAcademicCounts === null) afterAcademicCounts = beforeAcademicCounts;
  const afterLedger = await migrationLedger();
  const afterSchema = await schemaSnapshot();
  verifySnapshot(afterSchema);
  if (!afterLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) throw Object.assign(new Error('Migration 064 ledger verification failed.'), { code: 'MIGRATION_064_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeLedger, afterLedger, beforeSchema, afterSchema, beforeAcademicCounts, afterAcademicCounts, applied: result.applied, productionWrites: result.applied.length ? 'SCHEMA_ONLY' : 'NONE' };
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; } finally { await adapter.close?.(); }
