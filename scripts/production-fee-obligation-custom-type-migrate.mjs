import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 57;
const NAME = '057_fee_obligation_custom_type.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const REQUIRED_COLUMN = 'custom_fee_type_name';
const mode = process.argv[2] ?? 'apply';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });

const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_057_FAILED', message: cause?.code ? cause.message : 'Migration 057 failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}

async function feeObligationsSnapshot() {
  const tableRows = await adapter.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_obligations'");
  if (!tableRows.length) throw Object.assign(new Error('fee_obligations table is missing.'), { code: 'FEE_OBLIGATIONS_TABLE_MISSING' });
  const columns = await adapter.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_obligations' AND COLUMN_NAME = ?", [REQUIRED_COLUMN]);
  const column = columns[0] ?? null;
  const rows = await adapter.query('SELECT COUNT(*) AS row_count, COALESCE(SUM(amount_minor), 0) AS amount_minor_sum FROM fee_obligations');
  return { column, rowCount: Number(rows[0]?.row_count ?? 0), amountMinorSum: String(rows[0]?.amount_minor_sum ?? '0') };
}

async function ledgerState() {
  await adapter.ensureMetadata({ create: false });
  const rows = await adapter.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version = ?', [VERSION]);
  return rows[0] ?? null;
}

async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_057_FILE_MISSING' });
  const beforeSchema = await feeObligationsSnapshot();
  const beforeLedger = await ledgerState();
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, beforeLedger, pending: dryRun.pending };

  const result = await runner.applyVersions({ versions: [VERSION], dryRun: false, verifyMigration: async ({ adapter: tx }) => {
    const columns = await tx.query("SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fee_obligations' AND COLUMN_NAME = ?", [REQUIRED_COLUMN]);
    const column = columns[0] ?? null;
    if (!column || String(column.COLUMN_TYPE).toLowerCase() !== 'varchar(128)' || String(column.IS_NULLABLE).toUpperCase() !== 'YES' || column.COLUMN_DEFAULT !== null) {
      throw Object.assign(new Error('Migration 057 column definition is incompatible.'), { code: 'MIGRATION_057_SCHEMA_VERIFICATION_FAILED', details: { column } });
    }
  } });
  const afterSchema = await feeObligationsSnapshot();
  const afterLedger = await ledgerState();
  if (!afterSchema.column || String(afterSchema.column.COLUMN_TYPE).toLowerCase() !== 'varchar(128)' || String(afterSchema.column.IS_NULLABLE).toUpperCase() !== 'YES' || afterSchema.column.COLUMN_DEFAULT !== null) throw Object.assign(new Error('Post-migration column verification failed.'), { code: 'MIGRATION_057_SCHEMA_VERIFICATION_FAILED', details: { column: afterSchema.column } });
  if (beforeSchema.rowCount !== afterSchema.rowCount || beforeSchema.amountMinorSum !== afterSchema.amountMinorSum) throw Object.assign(new Error('Existing fee obligation aggregate changed.'), { code: 'MIGRATION_057_DATA_PRESERVATION_FAILED', details: { before: { rowCount: beforeSchema.rowCount, amountMinorSum: beforeSchema.amountMinorSum }, after: { rowCount: afterSchema.rowCount, amountMinorSum: afterSchema.amountMinorSum } } });
  if (!afterLedger || Number(afterLedger.version) !== VERSION || afterLedger.name !== NAME || afterLedger.checksum !== migration.checksum) throw Object.assign(new Error('Migration 057 ledger verification failed.'), { code: 'MIGRATION_057_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, afterSchema, beforeLedger, afterLedger, applied: result.applied };
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; }
finally { await adapter.close?.(); }
