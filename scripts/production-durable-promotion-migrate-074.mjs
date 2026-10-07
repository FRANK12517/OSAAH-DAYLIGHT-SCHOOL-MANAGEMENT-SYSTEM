import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 74;
const NAME = '074_durable_promotion_rollover.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_DURABLE_PROMOTION_074';
const REQUIRED_MIGRATIONS = [73];
const ADDED_COLUMNS = ['class_id', 'term_id', 'to_class_id', 'next_academic_year_id', 'next_term_id', 'completion_year', 'source_enrollment_id', 'idempotency_key'];
const REQUIRED_INDEXES = ['uq_promotion_decision_idempotency', 'idx_promotion_decision_context'];
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const mode = process.argv[2] ?? 'dry-run';
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_074_FAILED', message: cause?.message ?? 'Migration 074 failed safely.', details: cause?.details ?? null } });

async function snapshot(adapter) {
  const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotion_decisions'"));
  const columns = rows(await adapter.query("SELECT COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotion_decisions' ORDER BY ORDINAL_POSITION"));
  const indexes = rows(await adapter.query("SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotion_decisions' ORDER BY INDEX_NAME,SEQ_IN_INDEX"));
  const foreignKeys = rows(await adapter.query("SELECT COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotion_decisions' AND REFERENCED_TABLE_NAME IS NOT NULL"));
  return { tableExists: tables.length === 1, columns, indexes, foreignKeys };
}

function verifyBase(snapshotValue) {
  if (!snapshotValue.tableExists) fail('MIGRATION_074_TABLE_MISSING', 'The legacy promotion_decisions table is required; refusing to create or replace it.');
  const names = new Set(snapshotValue.columns.map((column) => column.columnName));
  const missing = ['id', 'school_id', 'student_id', 'academic_year_id', 'decision', 'decided_by', 'decided_at'].filter((name) => !names.has(name));
  if (missing.length) fail('MIGRATION_074_BASE_SCHEMA_MISMATCH', 'The legacy promotion decision schema does not match expected production prerequisites.', { missingColumns: missing });
  if (!snapshotValue.foreignKeys.some((key) => key.columnName === 'student_id' && key.referencedTable === 'student_profiles' && key.referencedColumn === 'id')) {
    fail('MIGRATION_074_STUDENT_FK_MISSING', 'The original promotion_decisions.student_id foreign key to student_profiles.id is required and must remain intact.');
  }
}

function verifyAddedSchema(snapshotValue) {
  verifyBase(snapshotValue);
  const columns = new Map(snapshotValue.columns.map((column) => [column.columnName, column]));
  const missingColumns = ADDED_COLUMNS.filter((name) => !columns.has(name));
  const indexesByName = new Map();
  for (const item of snapshotValue.indexes) indexesByName.set(item.indexName, [...(indexesByName.get(item.indexName) ?? []), item]);
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexesByName.has(name));
  if (missingColumns.length || missingIndexes.length) fail('MIGRATION_074_SCHEMA_VERIFY_FAILED', 'Migration 074 columns or indexes are missing.', { missingColumns, missingIndexes });
  const idempotencyIndex = indexesByName.get('uq_promotion_decision_idempotency');
  if (!idempotencyIndex || idempotencyIndex.some((item) => Number(item.nonUnique) !== 0) || idempotencyIndex.map((item) => item.columnName).join(',') !== 'school_id,idempotency_key') {
    fail('MIGRATION_074_IDEMPOTENCY_INDEX_INVALID', 'The school-scoped unique idempotency index does not match the reviewed contract.');
  }
  const contextIndex = indexesByName.get('idx_promotion_decision_context');
  if (!contextIndex || contextIndex.map((item) => item.columnName).join(',') !== 'school_id,academic_year_id,class_id,term_id') {
    fail('MIGRATION_074_CONTEXT_INDEX_INVALID', 'The school/year/class/term context index does not match the reviewed contract.');
  }
}

async function main() {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) fail('MIGRATION_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A recent recoverable backup confirmation is required.');
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) fail('MIGRATION_074_FILE_MISSING', `Required migration ${NAME} is unavailable or mismatched.`);
  const adapter = createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });
    const beforeSchema = await snapshot(adapter);
    verifyBase(beforeSchema);
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    const appliedVersions = new Set(before.applied.map((item) => Number(item.version)));
    const missingPredecessors = REQUIRED_MIGRATIONS.filter((version) => !appliedVersions.has(version));
    if (missingPredecessors.length) fail('MIGRATION_074_PREDECESSOR_MISSING', 'Migration 073 must be recorded before Migration 074.', { missingPredecessors });
    const existing = before.applied.find((item) => Number(item.version) === VERSION);
    if (existing) {
      verifyAddedSchema(beforeSchema);
      if (existing.name !== NAME || existing.checksum !== migration.checksum) fail('MIGRATION_074_LEDGER_MISMATCH', 'Migration 074 ledger entry does not match the reviewed migration checksum.');
    } else if (ADDED_COLUMNS.some((name) => beforeSchema.columns.some((column) => column.columnName === name)) || REQUIRED_INDEXES.some((name) => beforeSchema.indexes.some((index) => index.indexName === name))) {
      fail('MIGRATION_074_PREEXISTING_SCHEMA', 'Migration 074 schema exists without its matching ledger entry; refusing ambiguous adoption.');
    }
    const pendingMigrationsOutsideScope = before.pending.filter((item) => Number(item.version) !== VERSION).map((item) => Number(item.version));
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: REQUIRED_MIGRATIONS, dryRun: true });
    if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: migration.name, checksum: migration.checksum }, beforeSchema, pendingMigrationsOutsideScope, productionWrites: 'NONE', result: plan };
    const result = await runner.applyVersions({
      versions: [VERSION], requiredAppliedVersions: REQUIRED_MIGRATIONS,
      verifyMigration: async ({ adapter: transaction }) => verifyAddedSchema(await snapshot(transaction))
    });
    const afterSchema = await snapshot(adapter);
    verifyAddedSchema(afterSchema);
    const ledgerRows = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]));
    const afterLedger = ledgerRows[0] ?? null;
    if (!afterLedger || Number(afterLedger.version) !== VERSION || afterLedger.name !== NAME || afterLedger.checksum !== migration.checksum) fail('MIGRATION_074_POST_APPLY_VERIFICATION_FAILED', 'Migration 074 schema or ledger verification failed.', { ledger: afterLedger });
    return { ok: true, mode, database, migration: { version: VERSION, name: migration.name, checksum: migration.checksum }, afterSchema: { addedColumns: ADDED_COLUMNS, indexes: REQUIRED_INDEXES, studentForeignKeyPreserved: true }, pendingMigrationsOutsideScope, productionWrites: 'MIGRATION_074_ONLY', result };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; }
