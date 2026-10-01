import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 62;
const NAME = '062_assignments.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_ASSIGNMENTS_062';
const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
if (mode === 'apply' && process.env.EXECUTION_TOKEN !== EXECUTION_TOKEN) throw Object.assign(new Error('Exact assignment migration approval token is required.'), { code: 'MIGRATION_APPROVAL_REQUIRED' });

const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_062_FAILED', message: cause?.code ? cause.message : 'Assignment migration failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}
async function schemaSnapshot() {
  const tables = await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('assignments','assignment_files') ORDER BY TABLE_NAME");
  const columns = await adapter.query("SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('assignments','assignment_files') ORDER BY TABLE_NAME, ORDINAL_POSITION");
  const indexes = await adapter.query("SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('assignments','assignment_files') ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
  const constraints = await adapter.query("SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn, COLUMN_NAME AS columnName, DELETE_RULE AS deleteRule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r USING (CONSTRAINT_SCHEMA, CONSTRAINT_NAME) WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN ('assignments','assignment_files') ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION");
  return { tables, columns, indexes, constraints };
}
async function ledgerState() {
  await adapter.ensureMetadata({ create: false });
  return adapter.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version IN (?, ?) ORDER BY version', [61, VERSION]);
}
async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_062_FILE_MISSING' });
  const beforeSchema = await schemaSnapshot();
  const beforeLedger = await ledgerState();
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [61], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, beforeLedger, pending: dryRun.pending, productionWrites: 'NONE' };
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [61], dryRun: false, verifyMigration: async ({ adapter: tx }) => {
    const tables = await tx.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('assignments','assignment_files')");
    if (tables.length !== 2) throw Object.assign(new Error('Assignment migration did not create both required tables.'), { code: 'MIGRATION_062_SCHEMA_VERIFICATION_FAILED' });
  } });
  const afterSchema = await schemaSnapshot();
  const afterLedger = await ledgerState();
  if (afterSchema.tables.length !== 2 || !afterLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) throw Object.assign(new Error('Assignment migration postcondition failed.'), { code: 'MIGRATION_062_POSTCONDITION_FAILED' });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, afterSchema, beforeLedger, afterLedger, applied: result.applied };
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; } finally { await adapter.close?.(); }
