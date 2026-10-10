import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = 80;
const NAME = '080_restore_student_enrollment_is_current.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_ENROLLMENT_IS_CURRENT_080';
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];

function isCurrentColumn(columns) {
  return rows(columns).find((item) => String(item.columnName ?? item.COLUMN_NAME).toLowerCase() === 'is_current') ?? null;
}

function assertColumnCompatible(column) {
  if (!column) return;
  const type = String(column.columnType ?? column.COLUMN_TYPE ?? '').toLowerCase();
  const nullable = String(column.isNullable ?? column.IS_NULLABLE ?? '').toUpperCase();
  const defaultValue = String(column.columnDefault ?? column.COLUMN_DEFAULT ?? '').replace(/^['"]|['"]$/g, '');
  if (type !== 'tinyint(1)' || nullable !== 'NO' || defaultValue !== '1') {
    throw Object.assign(new Error('Existing student_enrollments.is_current has an incompatible definition; refusing to alter it.'), { code: 'MIGRATION_080_COLUMN_INCOMPATIBLE' });
  }
}

async function snapshot(adapter) {
  const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments'"));
  if (!tables.some((item) => String(item.tableName ?? item.TABLE_NAME).toLowerCase() === 'student_enrollments')) {
    throw Object.assign(new Error('Canonical student_enrollments table is missing; refusing to create a parallel table.'), { code: 'MIGRATION_080_TABLE_MISSING' });
  }
  const columns = rows(await adapter.query("SELECT COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,COLUMN_DEFAULT AS columnDefault FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND COLUMN_NAME='is_current'"));
  const currentColumn = isCurrentColumn(columns);
  assertColumnCompatible(currentColumn);
  const rawCount = rows(await adapter.query('SELECT COUNT(*) AS rowCount FROM student_enrollments'))[0]?.rowCount;
  const count = rawCount === null || rawCount === undefined || rawCount === '' ? NaN : Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) throw Object.assign(new Error('Enrollment row count could not be verified.'), { code: 'MIGRATION_080_COUNT_INVALID' });
  const ledger = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]));
  return { enrollmentRowCount: count, isCurrent: currentColumn ? { type: String(currentColumn.columnType ?? currentColumn.COLUMN_TYPE).toLowerCase(), nullable: String(currentColumn.isNullable ?? currentColumn.IS_NULLABLE).toUpperCase(), default: String(currentColumn.columnDefault ?? currentColumn.COLUMN_DEFAULT).replace(/^['"]|['"]$/g, '') } : null, ledger };
}

export async function runProductionEnrollmentIsCurrentMigration080({ adapter, mode = 'dry-run', executionToken, backupConfirmation, directory: migrationDirectory = directory, baselineRequired = true } = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use dry-run or apply.');
  if (!adapter?.query || !adapter?.close) throw new Error('A closable production database adapter is required.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) throw new Error('Explicit Migration 080 apply authorization is required.');
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') throw new Error('A recent recoverable backup confirmation is required.');
  const migrations = await discoverMigrations(migrationDirectory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) throw new Error('Migration 080 definition is unavailable or mismatched.');
  const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
  const before = await snapshot(adapter);
  const runner = createMigrationRunner({ adapter, directory: migrationDirectory, baselineRequired });
  const status = await runner.status();
  const baselineMigration = status.baseline && migrations.find((item) => item.name === status.baseline.reconciliationMigration);
  if (!status.baseline || !baselineMigration) throw Object.assign(new Error('A verified production schema baseline is required.'), { code: 'MIGRATION_BASELINE_REQUIRED' });
  if (status.baseline.canonicalDatabase !== EXPECTED_DATABASE) throw new Error('Production migration baseline targets a different database.');
  if (status.baseline.baselineType !== 'HISTORICAL_BASELINE'
    || Number(status.baseline.historicalMigrationsExecuted) !== 0
    || !/^[0-9a-f]{40}$/i.test(String(status.baseline.repositoryCommit ?? ''))
    || !/^[0-9a-f]{64}$/i.test(String(status.baseline.schemaFingerprint ?? ''))
    || !String(status.baseline.workflowProvenance ?? '').trim()) {
    throw Object.assign(new Error('Migration 080 requires the verified historical baseline that explicitly records pre-baseline migrations as unexecuted.'), { code: 'MIGRATION_BASELINE_INCOMPATIBLE' });
  }
  if (status.historicalUntracked.some((item) => item.version >= baselineMigration.version)) {
    throw Object.assign(new Error('An untracked migration is at or after the recorded baseline boundary.'), { code: 'HISTORICAL_MIGRATIONS_UNTRACKED' });
  }
  // Migration 080 is a standalone, additive compatibility repair. Keep execution
  // explicitly scoped to version 080; leave all other pending migrations queued.
  const deferredPendingMigrations = status.pending.filter((item) => item.version !== VERSION);
  const plan = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, plan, deferredPendingMigrations, productionWrites: 'NONE' };
  const result = await runner.applyVersions({ versions: [VERSION], verifyMigration: async ({ adapter: tx }) => {
    const afterDdl = await snapshot(tx);
    if (!afterDdl.isCurrent) throw Object.assign(new Error('Migration 080 did not restore student_enrollments.is_current.'), { code: 'MIGRATION_080_SCHEMA_VERIFICATION_FAILED' });
    if (afterDdl.enrollmentRowCount !== before.enrollmentRowCount) throw Object.assign(new Error('Migration 080 changed the enrollment row count.'), { code: 'MIGRATION_080_DATA_PRESERVATION_FAILED' });
  } });
  const after = await snapshot(adapter);
  if (!after.isCurrent || after.enrollmentRowCount !== before.enrollmentRowCount) throw Object.assign(new Error('Migration 080 postconditions failed.'), { code: 'MIGRATION_080_POSTCONDITION_FAILED' });
  if (!after.ledger.some((item) => Number(item.version) === VERSION && item.name === NAME && item.checksum === migration.checksum)) throw Object.assign(new Error('Migration 080 ledger record was not verified.'), { code: 'MIGRATION_080_LEDGER_VERIFICATION_FAILED' });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, after, result, deferredPendingMigrations, productionWrites: result.applied.length ? 'MIGRATION_080_ONLY' : 'NONE_ALREADY_APPLIED' };
}

async function main() {
  const adapter = createDatabaseAdapter({ environment: process.env });
  try {
    return await runProductionEnrollmentIsCurrentMigration080({ adapter, mode: process.argv[2] ?? 'dry-run', executionToken: process.env.EXECUTION_TOKEN, backupConfirmation: process.env.BACKUP_CONFIRMATION });
  } finally { await adapter.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
  catch (cause) { process.stderr.write(`${JSON.stringify({ ok: false, error: { code: cause?.code ?? 'MIGRATION_080_FAILED', message: cause?.code ? cause.message : 'Migration 080 failed safely.' } })}\n`); process.exitCode = 1; }
}
