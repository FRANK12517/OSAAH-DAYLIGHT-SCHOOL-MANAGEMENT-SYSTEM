import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 61;
const NAME = '061_durable_sample_data_fixtures.sql';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));

export async function runSampleFixturePreflight({ adapter, expectedDatabase = 'osaahdaylightschool' } = {}) {
  if (!adapter?.query) throw new Error('A read-only database adapter is required.');
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error('Migration 061 is missing.'), { code: 'MIGRATION_061_FILE_MISSING' });
  const database = (await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName ?? (await adapter.query('SELECT DATABASE() AS database_name'))[0]?.database_name;
  if (expectedDatabase && database !== expectedDatabase) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
  const tables = await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sample_data_fixtures'");
  const columns = tables.length ? await adapter.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sample_data_fixtures' ORDER BY ORDINAL_POSITION") : [];
  const ledger = await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]);
  const forbiddenOfficialTables = await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('students','student_attendance','canonical_academic_scores','student_fee_payments','student_fee_receipts') ORDER BY TABLE_NAME");
  return { ok: true, mode: 'read-only', database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, fixtureTable: { exists: tables.length === 1, columns: columns.map((item) => item.columnName) }, ledger: ledger[0] ?? null, officialTablesObserved: forbiddenOfficialTables.map((item) => item.tableName), applyExecuted: false };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null);
  if (!modulePath) { console.error(JSON.stringify({ ok: false, error: 'DATABASE_ADAPTER_REQUIRED' })); process.exitCode = 1; }
  else {
    const loaded = await import(pathToFileURL(modulePath));
    const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
    try { console.log(JSON.stringify(await runSampleFixturePreflight({ adapter }))); }
    finally { await adapter?.close?.(); }
  }
}
