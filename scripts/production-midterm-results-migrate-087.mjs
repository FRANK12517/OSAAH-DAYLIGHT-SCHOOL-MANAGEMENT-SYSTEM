import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const VERSION = 87;
const NAME = '087_midterm_result_type_support.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_MIDTERM_RESULTS_087';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use dry-run or apply.');
  if (!process.env.DATABASE_URL) throw new Error('Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) throw new Error('Explicit Migration 087 apply authorization is required.');
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') throw new Error('A recent recoverable backup confirmation is required.');
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME || createHash('sha256').update(migration.sql).digest('hex') !== migration.checksum) throw new Error('Migration 087 definition or checksum is invalid.');
  assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: VERSION });
  const loaded = await import(pathToFileURL(resolve(process.cwd(), 'src/ai/tidb-database-adapter.js')));
  const adapter = await loaded.createDatabaseAdapter({ environment: process.env });
  try {
    const database = (await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) throw new Error('Unexpected production database target.');
    const tables = (await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('academic_score_records','academic_result_records','academic_result_blocks','academic_result_unblock_requests')")).map((row) => row.tableName);
    for (const table of ['academic_score_records', 'academic_result_records', 'academic_result_blocks', 'academic_result_unblock_requests']) if (!tables.includes(table)) throw new Error(`Required result lifecycle table ${table} is absent.`);
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    // The lifecycle and score foundation are deliberately applied through their
    // own guarded scripts (068 before 067); refuse 087 unless that history and
    // the later result-blocking scope migrations are already recorded.
    const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63, 64, 65, 66, 67, 68, 75, 83, 84, 85, 86], dryRun: mode === 'dry-run' });
    return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, productionWrites: mode === 'apply' ? 'SCHEMA_ONLY' : 'NONE', result };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ error: error.message })}\n`); process.exitCode = 1; }
