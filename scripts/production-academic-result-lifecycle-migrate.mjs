import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const VERSION = 67;
const NAME = '067_academic_result_lifecycle.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_ACADEMIC_RESULT_LIFECYCLE_067';
const migrationDirectory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use dry-run or apply.');
  if (!process.env.DATABASE_URL) throw new Error('Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) throw new Error('Explicit Migration 067 apply authorization is required.');
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') throw new Error('A recent recoverable backup confirmation is required.');
  const migrations = await discoverMigrations(migrationDirectory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) throw new Error('Migration 067 definition is unavailable or mismatched.');
  const scoreFoundation = migrations.find((item) => item.version === 68);
  if (!scoreFoundation || scoreFoundation.name !== '068_academic_score_records_foundation.sql') throw new Error('Checksum-verified Migration 068 score foundation is unavailable or mismatched.');
  assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: VERSION });
  const loaded = await import(pathToFileURL(resolve(process.cwd(), 'src/ai/tidb-database-adapter.js')));
  const adapter = await loaded.createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) throw new Error(`Unexpected production database target: ${database ?? 'unknown'}.`);
    const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('academic_score_records','academic_result_records','canonical_academic_scores') ORDER BY TABLE_NAME")).map((row) => row.tableName);
    if (!tables.includes('academic_score_records')) throw new Error('Authoritative academic_score_records is absent; refusing lifecycle migration.');
    if (tables.includes('canonical_academic_scores')) throw new Error('Competing canonical_academic_scores exists; refusing lifecycle migration.');
    if (tables.includes('academic_result_records')) throw new Error('Migration 067 target already exists; refusing ambiguous partial execution.');
    const runner = createMigrationRunner({ adapter, directory: migrationDirectory, baselineRequired: true });
    const result = mode === 'dry-run'
      ? await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63, 64, 65, 66, 68], dryRun: true })
      : await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63, 64, 65, 66, 68] });
    if (mode === 'apply') {
      const verified = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='academic_result_records'"));
      if (!verified.length) throw new Error('Migration 067 completed without creating academic_result_records.');
      const competing = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canonical_academic_scores'"));
      if (competing.length) throw new Error('Competing canonical_academic_scores appeared during verification.');
    }
    return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, productionWrites: mode === 'apply' ? 'MIGRATION_067_ONLY' : 'NONE', result };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (error) {
  const details = error?.details;
  const diagnostic = details ? Object.fromEntries(['migration', 'version', 'statementIndex', 'operation', 'databaseCode', 'sqlState', 'databaseMessage'].filter((key) => details[key] !== undefined && details[key] !== null).map((key) => [key, details[key]])) : null;
  process.stderr.write(`${JSON.stringify({ error: error.message, ...(diagnostic ? { diagnostic } : {}) })}\n`);
  process.exitCode = 1;
}
