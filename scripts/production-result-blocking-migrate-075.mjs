import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';
import { assert075Postconditions, assert075SafeState, read075SchemaSnapshot } from '../src/platform/academic-result-blocking-075-schema.js';

const VERSION = 75;
const NAME = '075_result_blocking_examination_scope.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_RESULT_BLOCKING_075';
const mode = process.argv[2] ?? 'dry-run';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
let adapter;

function safeFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? 'MIGRATION_075_FAILED',
      message: error?.code ? error.message : 'Migration 075 preflight/apply failed safely.',
      details: error?.details ?? null
    }
  };
}

async function main() {
  if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required for Migration 075 preflight.'), { code: 'DATABASE_URL_MISSING' });
  if (mode === 'apply' && (process.env.EXECUTION_TOKEN !== APPLY_TOKEN || process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED')) {
    throw Object.assign(new Error('Migration 075 apply requires the protected token and backup confirmation.'), { code: 'MIGRATION_075_APPROVAL_REQUIRED' });
  }

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) throw Object.assign(new Error('Migration 075 file is missing or mismatched.'), { code: 'MIGRATION_075_FILE_MISMATCH' });
  const sql = await readFile(new URL(`../schema/${NAME}`, import.meta.url), 'utf8');
  if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw Object.assign(new Error('Migration 075 checksum mismatch.'), { code: 'MIGRATION_075_CHECKSUM_MISMATCH' });
  if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) throw Object.assign(new Error('Migration 075 is destructive.'), { code: 'MIGRATION_075_DESTRUCTIVE_SQL' });

  const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || resolve(process.cwd(), 'src/ai/tidb-database-adapter.js');
  const loaded = await import(pathToFileURL(resolve(modulePath)));
  adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
  if (!adapter) throw Object.assign(new Error('A durable production database adapter module is required.'), { code: 'DATABASE_ADAPTER_MISSING' });

  const identityRows = await adapter.query('SELECT DATABASE() AS databaseName');
  const database = identityRows[0]?.databaseName ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), {
    code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database }
  });

  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [74], dryRun: true });
  const beforeLedger = await adapter.listApplied();
  const beforeSchema = await read075SchemaSnapshot(adapter);
  const schemaState = assert075SafeState(beforeSchema, beforeLedger);

  if (mode === 'dry-run') return {
    ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum },
    schemaState, beforeLedger: beforeLedger.filter((row) => [74, 75].includes(Number(row.version))),
    beforeSchema, pending: dryRun.pending, productionWrites: 'NONE'
  };

  const result = await runner.applyVersions({
    versions: [VERSION],
    requiredAppliedVersions: [74],
    beforeApply: async ({ adapter: liveAdapter, applied }) => {
      const currentSchema = await read075SchemaSnapshot(liveAdapter);
      assert075SafeState(currentSchema, applied);
    },
    verifyMigration: async ({ adapter: transactionAdapter }) => {
      assert075Postconditions(await read075SchemaSnapshot(transactionAdapter));
    }
  });
  const afterLedger = await adapter.listApplied();
  const afterSchema = await read075SchemaSnapshot(adapter);
  const afterState = assert075SafeState(afterSchema, afterLedger);
  if (afterState !== 'ALREADY_APPLIED') throw Object.assign(new Error('Migration 075 completed without a verified ledger/schema state.'), { code: 'MIGRATION_075_FINAL_STATE_FAILED' });
  const record = afterLedger.find((row) => Number(row.version) === VERSION);
  if (!record || record.name !== NAME || record.checksum !== migration.checksum) throw Object.assign(new Error('Migration 075 ledger verification failed.'), { code: 'MIGRATION_075_LEDGER_VERIFICATION_FAILED' });
  return {
    ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum },
    result, afterLedger: afterLedger.filter((row) => [74, 75].includes(Number(row.version))),
    afterSchema, productionWrites: 'SCHEMA_ONLY'
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
  process.exitCode = 1;
} finally {
  await adapter?.close?.();
}
