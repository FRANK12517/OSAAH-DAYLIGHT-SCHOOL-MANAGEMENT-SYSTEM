import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 73;
const NAME = '073_subject_updated_at.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_SUBJECT_UPDATED_AT_073';
const REQUIRED_MIGRATIONS = [63, 65, 66];
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const mode = process.argv[2] ?? 'dry-run';
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_073_FAILED', message: cause?.message ?? 'Migration 073 failed safely.', details: cause?.details ?? null } });

async function schemaSnapshot(adapter) {
  const tables = rows(await adapter.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subjects'"
  ));
  const columns = rows(await adapter.query(
    "SELECT COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,COLUMN_DEFAULT AS columnDefault FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subjects' ORDER BY ORDINAL_POSITION"
  ));
  return { tableExists: tables.length === 1, columns };
}

function verifySubjectBaseSchema(snapshot) {
  if (!snapshot.tableExists) fail('MIGRATION_073_SUBJECTS_TABLE_MISSING', 'The canonical subjects table is required.');
  const names = new Set(snapshot.columns.map((column) => column.columnName));
  const missing = ['id', 'school_id', 'created_at'].filter((column) => !names.has(column));
  if (missing.length) fail('MIGRATION_073_SUBJECTS_BASE_SCHEMA_MISSING', 'The subjects table does not match the verified migration prerequisites.', { missingColumns: missing });
}

async function main() {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) fail('MIGRATION_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A recent recoverable backup confirmation is required.');

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) fail('MIGRATION_073_FILE_MISSING', `Required migration ${NAME} is unavailable or mismatched.`);

  const adapter = createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });

    const beforeSchema = await schemaSnapshot(adapter);
    verifySubjectBaseSchema(beforeSchema);
    const hasUpdatedAt = beforeSchema.columns.some((column) => column.columnName === 'updated_at');

    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    const appliedVersions = new Set(before.applied.map((item) => Number(item.version)));
    const missingPredecessors = REQUIRED_MIGRATIONS.filter((version) => !appliedVersions.has(version));
    if (missingPredecessors.length) fail('MIGRATION_073_PREDECESSOR_MISSING', 'Required subject migrations are not recorded.', { missingPredecessors });
    const ledger73 = before.applied.find((item) => Number(item.version) === VERSION);
    if (ledger73 && !hasUpdatedAt) fail('MIGRATION_073_LEDGER_SCHEMA_MISMATCH', 'Migration 073 is recorded but subjects.updated_at is absent.');
    if (!ledger73 && hasUpdatedAt) fail('MIGRATION_073_PREEXISTING_COLUMN', 'subjects.updated_at exists without the Migration 073 ledger row; refusing ambiguous adoption.');

    const pendingMigrationsOutsideScope = before.pending.filter((item) => Number(item.version) !== VERSION).map((item) => Number(item.version));
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: REQUIRED_MIGRATIONS, dryRun: true });
    if (mode === 'dry-run') return {
      ok: true, mode, database,
      migration: { version: VERSION, name: migration.name, checksum: migration.checksum },
      beforeSchema,
      pendingMigrationsOutsideScope,
      productionWrites: 'NONE',
      result: plan
    };

    const result = await runner.applyVersions({
      versions: [VERSION],
      requiredAppliedVersions: REQUIRED_MIGRATIONS,
      verifyMigration: async ({ adapter: transaction }) => {
        const afterSchema = await schemaSnapshot(transaction);
        verifySubjectBaseSchema(afterSchema);
        const column = afterSchema.columns.find((item) => item.columnName === 'updated_at');
        if (!column || !/^varchar\(50\)$/i.test(String(column.columnType)) || column.isNullable !== 'YES') {
          fail('MIGRATION_073_SCHEMA_VERIFY_FAILED', 'subjects.updated_at does not match the nullable VARCHAR(50) contract.', { actual: column ?? null });
        }
      }
    });

    const afterSchema = await schemaSnapshot(adapter);
    const ledgerRows = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]));
    const afterLedger = ledgerRows[0] ?? null;
    const verifiedColumn = afterSchema.columns.find((column) => column.columnName === 'updated_at');
    if (!verifiedColumn || !afterLedger || afterLedger.name !== NAME || afterLedger.checksum !== migration.checksum) {
      fail('MIGRATION_073_POST_APPLY_VERIFICATION_FAILED', 'Migration 073 schema or ledger verification failed.', { column: verifiedColumn ?? null, ledger: afterLedger });
    }
    return {
      ok: true, mode, database,
      migration: { version: VERSION, name: migration.name, checksum: migration.checksum },
      afterSchema: { updatedAt: verifiedColumn },
      pendingMigrationsOutsideScope,
      productionWrites: 'MIGRATION_073_ONLY',
      result
    };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; }
