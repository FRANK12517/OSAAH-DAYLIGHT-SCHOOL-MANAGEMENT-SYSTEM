import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 64;
const NAME = '064_academic_result_blocking.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_RESULT_BLOCKING_064';
const TABLES = ['academic_result_blocks', 'academic_result_unblock_requests'];
const BLOCK_COLUMNS = ['id', 'school_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope', 'status', 'reason', 'blocked_by', 'blocked_by_role', 'blocked_at', 'unblocked_by', 'unblocked_at'];
const REQUEST_COLUMNS = ['id', 'school_id', 'block_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope', 'reason', 'requested_by', 'requested_by_role', 'status', 'requested_at', 'decided_by', 'decided_at'];
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
    const count = await database.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    result[table] = { rowCount: Number(count[0]?.rowCount ?? 0) };
  }
  return result;
}

async function academicRecordCounts(database = adapter) {
  const rows = await database.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (LOWER(TABLE_NAME) LIKE '%academic%' OR LOWER(TABLE_NAME) LIKE '%result%' OR LOWER(TABLE_NAME) LIKE '%score%' OR LOWER(TABLE_NAME) LIKE '%student%' OR LOWER(TABLE_NAME) LIKE '%parent%' OR LOWER(TABLE_NAME) LIKE '%term%' OR LOWER(TABLE_NAME) LIKE '%year%') ORDER BY TABLE_NAME");
  const counts = {};
  for (const row of rows) {
    const table = String(row.tableName);
    if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
    const result = await database.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    counts[table] = Number(result[0]?.rowCount ?? 0);
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
  const beforeSchema = await schemaSnapshot();
  const beforeAcademicCounts = await academicRecordCounts();
  const preexisting = beforeSchema.tables.length > 0;
  const recorded = beforeLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum);
  if (preexisting && !recorded) throw Object.assign(new Error('Migration 064 objects already exist without the matching ledger row; refusing ambiguous apply.'), { code: 'MIGRATION_064_PREEXISTING_OBJECTS', details: { tables: beforeSchema.tables, ledger: beforeLedger } });
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeLedger, beforeSchema, beforeAcademicCounts, pending: dryRun.pending, productionWrites: 'NONE' };
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63], dryRun: false, verifyMigration: async ({ adapter: tx }) => verifySnapshot(await schemaSnapshot(tx)) });
  const afterLedger = await migrationLedger();
  const afterSchema = await schemaSnapshot();
  const afterAcademicCounts = await academicRecordCounts();
  verifySnapshot(afterSchema);
  if (!afterLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) throw Object.assign(new Error('Migration 064 ledger verification failed.'), { code: 'MIGRATION_064_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  if (JSON.stringify(beforeAcademicCounts) !== JSON.stringify(afterAcademicCounts)) throw Object.assign(new Error('Migration 064 changed protected academic record counts.'), { code: 'MIGRATION_064_ACADEMIC_RECORD_COUNT_CHANGED', details: { beforeAcademicCounts, afterAcademicCounts } });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeLedger, afterLedger, beforeSchema, afterSchema, beforeAcademicCounts, afterAcademicCounts, applied: result.applied, productionWrites: 'SCHEMA_ONLY' };
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; } finally { await adapter.close?.(); }
