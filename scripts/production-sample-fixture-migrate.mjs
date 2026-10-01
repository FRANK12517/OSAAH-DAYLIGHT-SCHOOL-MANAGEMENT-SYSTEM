import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { runSampleFixturePreflight } from './production-sample-fixture-preflight.mjs';

const VERSION = 61;
const NAME = '061_durable_sample_data_fixtures.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const mode = process.argv[2] ?? 'apply';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_061_FAILED', message: cause?.code ? cause.message : 'Migration 061 failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}
async function ledgerState() {
  await adapter.ensureMetadata({ create: false });
  const rows = await adapter.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version = ?', [VERSION]);
  return rows[0] ?? null;
}
async function verifyFixtureSchema(tx, migration) {
  const tables = await tx.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sample_data_fixtures'");
  if (tables.length !== 1) throw Object.assign(new Error('Sample fixture table was not created.'), { code: 'MIGRATION_061_SCHEMA_VERIFICATION_FAILED' });
  const columns = await tx.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sample_data_fixtures'");
  const required = ['fixture_id', 'school_id', 'sample_student_id', 'academic_year_id', 'term_id', 'class_id', 'fixture_type', 'fixture_payload', 'fixture_version', 'created_at', 'updated_at'];
  const actual = new Set(columns.map((row) => row.columnName));
  if (required.some((column) => !actual.has(column))) throw Object.assign(new Error('Sample fixture table is missing required columns.'), { code: 'MIGRATION_061_SCHEMA_VERIFICATION_FAILED' });
  return { table: 'sample_data_fixtures', columns: required, checksum: migration.checksum };
}
async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_061_FILE_MISSING' });
  const beforeLedger = await ledgerState();
  const preflight = await runSampleFixturePreflight({ adapter, expectedDatabase: EXPECTED_DATABASE });
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, preflight, beforeLedger, pending: dryRun.pending, applyExecuted: false };
  const result = await runner.applyVersions({ versions: [VERSION], dryRun: false, verifyMigration: async ({ adapter: tx }) => verifyFixtureSchema(tx, migration) });
  const afterLedger = await ledgerState();
  const afterPreflight = await runSampleFixturePreflight({ adapter, expectedDatabase: EXPECTED_DATABASE });
  if (!afterLedger || Number(afterLedger.version) !== VERSION || afterLedger.name !== NAME || afterLedger.checksum !== migration.checksum) throw Object.assign(new Error('Migration 061 ledger verification failed.'), { code: 'MIGRATION_061_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  if (!afterPreflight.fixtureTable.exists) throw Object.assign(new Error('Migration 061 table verification failed.'), { code: 'MIGRATION_061_SCHEMA_VERIFICATION_FAILED' });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, preflight, beforeLedger, applied: result.applied, afterLedger, afterPreflight, applyExecuted: true };
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; } finally { await adapter.close?.(); }
