import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 63;
const NAME = '063_subject_classification.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_SUBJECT_CLASSIFICATION_063';
const SUBJECT_COLUMNS = ['id', 'school_id', 'name', 'code', 'department_id', 'is_elective', 'created_at'];
const mode = process.argv[2] ?? 'dry-run';

if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
if (mode === 'apply' && process.env.EXECUTION_TOKEN !== EXECUTION_TOKEN) throw Object.assign(new Error('Exact Migration 063 production approval token is required.'), { code: 'MIGRATION_APPROVAL_REQUIRED' });

const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({
  ok: false,
  error: {
    code: cause?.code ?? 'MIGRATION_063_FAILED',
    message: cause?.code ? cause.message : 'Migration 063 failed safely.',
    details: cause?.details ?? null
  }
});

async function databaseIdentity(database = adapter) {
  const rows = await database.query('SELECT DATABASE() AS database_name');
  const databaseName = rows[0]?.database_name ?? null;
  if (databaseName !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), {
    code: 'DATABASE_TARGET_MISMATCH',
    details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: databaseName }
  });
  return databaseName;
}

async function migrationLedger(database = adapter) {
  await database.ensureMetadata({ create: false });
  return database.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version = ?', [VERSION]);
}

async function subjectSnapshot(database = adapter) {
  const columns = await database.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
            IS_NULLABLE AS nullable, COLUMN_DEFAULT AS columnDefault, COLUMN_KEY AS columnKey,
            ORDINAL_POSITION AS ordinalPosition
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subjects'
     ORDER BY ORDINAL_POSITION`
  );
  const tables = await database.query(
    `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subjects'`
  );
  const subjects = tables.length
    ? await database.query(`SELECT ${SUBJECT_COLUMNS.map((column) => `\`${column}\``).join(', ')} FROM subjects ORDER BY id`)
    : [];
  return {
    table: tables[0] ?? null,
    columns,
    subjects,
    rowCount: subjects.length
  };
}

function column(snapshot, name) {
  return snapshot.columns.find((item) => item.columnName === name) ?? null;
}

function verifyMigration063Schema(snapshot) {
  if (!snapshot.table) throw Object.assign(new Error('The subjects table is missing.'), { code: 'MIGRATION_063_SCHEMA_VERIFICATION_FAILED' });
  const subjectType = column(snapshot, 'subject_type');
  const isScoring = column(snapshot, 'is_scoring');
  const valid = subjectType?.columnType?.toLowerCase() === 'varchar(32)' &&
    subjectType.nullable === 'NO' && subjectType.columnDefault === 'ELECTIVE' &&
    isScoring?.columnType?.toLowerCase() === 'tinyint' &&
    isScoring.nullable === 'NO' && String(isScoring.columnDefault) === '1';
  if (!valid) throw Object.assign(new Error('Migration 063 schema verification failed.'), {
    code: 'MIGRATION_063_SCHEMA_VERIFICATION_FAILED',
    details: { subjectType, isScoring }
  });
}

function verifyPreservedSubjects(before, after) {
  if (before.rowCount !== after.rowCount || JSON.stringify(before.subjects) !== JSON.stringify(after.subjects)) {
    throw Object.assign(new Error('Existing subject identifiers or values changed.'), {
      code: 'MIGRATION_063_SUBJECT_DATA_CHANGED',
      details: { beforeRowCount: before.rowCount, afterRowCount: after.rowCount }
    });
  }
}

async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_063_FILE_MISSING' });
  const beforeLedger = await migrationLedger();
  const beforeSchema = await subjectSnapshot();
  const recorded = beforeLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum);
  const targetColumns = { subjectType: column(beforeSchema, 'subject_type'), isScoring: column(beforeSchema, 'is_scoring') };
  const anyClassificationColumn = Boolean(targetColumns.subjectType || targetColumns.isScoring);

  if (beforeLedger.length && !recorded) throw Object.assign(new Error('Migration 063 has a ledger row that does not match the reviewed file.'), { code: 'MIGRATION_063_LEDGER_MISMATCH', details: { beforeLedger } });
  if (anyClassificationColumn && !recorded) throw Object.assign(new Error('Migration 063 has a partial physical schema without its verified ledger row.'), { code: 'MIGRATION_063_PARTIAL_SCHEMA', details: { targetColumns } });
  if (recorded) verifyMigration063Schema(beforeSchema);

  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') {
    return {
      ok: true,
      mode,
      database,
      migration: { version: VERSION, name: NAME, checksum: migration.checksum },
      beforeLedger,
      beforeSchema,
      pending: dryRun.pending,
      status: recorded ? 'ALREADY_APPLIED' : 'PENDING',
      productionWrites: 'NONE'
    };
  }

  const result = await runner.applyVersions({
    versions: [VERSION],
    dryRun: false,
    beforeApply: async () => {
      const lockedLedger = await migrationLedger();
      const lockedSchema = await subjectSnapshot();
      if (lockedLedger.length || column(lockedSchema, 'subject_type') || column(lockedSchema, 'is_scoring')) {
        throw Object.assign(new Error('Migration 063 precondition changed before lock-protected execution.'), {
          code: 'MIGRATION_063_PREFLIGHT_STATE_CHANGED',
          details: { lockedLedger, targetColumns: { subjectType: column(lockedSchema, 'subject_type'), isScoring: column(lockedSchema, 'is_scoring') } }
        });
      }
    },
    verifyMigration: async ({ adapter: transaction }) => {
      const afterSchema = await subjectSnapshot(transaction);
      verifyMigration063Schema(afterSchema);
      verifyPreservedSubjects(beforeSchema, afterSchema);
    }
  });
  const afterLedger = await migrationLedger();
  const afterSchema = await subjectSnapshot();
  verifyMigration063Schema(afterSchema);
  verifyPreservedSubjects(beforeSchema, afterSchema);
  if (!afterLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) {
    throw Object.assign(new Error('Migration 063 ledger verification failed.'), { code: 'MIGRATION_063_LEDGER_VERIFICATION_FAILED', details: { afterLedger } });
  }
  return {
    ok: true,
    mode,
    database,
    migration: { version: VERSION, name: NAME, checksum: migration.checksum },
    beforeLedger,
    afterLedger,
    beforeSchema,
    afterSchema,
    applied: result.applied,
    productionWrites: 'SCHEMA_ONLY'
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (cause) {
  process.stderr.write(`${JSON.stringify(safeError(cause))}\n`);
  process.exitCode = 1;
} finally {
  await adapter.close?.();
}
