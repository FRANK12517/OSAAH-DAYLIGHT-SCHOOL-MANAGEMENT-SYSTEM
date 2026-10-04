import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 65;
const NAME = '065_subject_assessment_components.sql';
const PREDECESSOR_VERSION = 64;
const PREDECESSOR_NAME = '064_academic_result_blocking.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_SUBJECT_ASSESSMENT_065';
const REQUIRED_PREREQUISITE_TABLES = [
  'schools',
  'subjects',
  'subject_class_assignments',
  'schema_migrations',
  'schema_migration_lock',
  'schema_baselines'
];
const EXPECTED_COLUMNS = [
  { table: 'subjects', column: 'assessment_components_json', type: /^json$/i, nullable: 'YES' },
  { table: 'subjects', column: 'is_active', type: /^tinyint\(1\)/i, nullable: 'NO', defaultValue: '1' },
  { table: 'subject_class_assignments', column: 'configuration_version', type: /^varchar\(32\)/i, nullable: 'YES' }
];
const ALLOWED_PREEXISTING_COLUMNS = new Set(['subject_class_assignments.configuration_version']);
const mode = process.argv[2] ?? 'dry-run';
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
let adapter;
const safeError = (cause) => ({
  ok: false,
  error: {
    code: cause?.code ?? 'MIGRATION_065_FAILED',
    message: cause?.code ? cause.message : 'Migration 065 failed safely.',
    details: cause?.details ?? null
  }
});

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) {
    throw Object.assign(new Error('Unexpected production database target.'), {
      code: 'DATABASE_TARGET_MISMATCH',
      details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database }
    });
  }
  return database;
}

async function verifyPrerequisites(database = adapter) {
  const rows = await database.query(
    'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?, ?, ?, ?) ORDER BY TABLE_NAME',
    REQUIRED_PREREQUISITE_TABLES
  );
  const present = new Set(rows.map((row) => row.tableName));
  const missing = REQUIRED_PREREQUISITE_TABLES.filter((table) => !present.has(table));
  if (missing.length) {
    throw Object.assign(new Error('Migration 065 prerequisites are missing.'), {
      code: 'MIGRATION_065_PREREQUISITE_MISSING',
      details: { missing }
    });
  }
  return { required: REQUIRED_PREREQUISITE_TABLES, present: [...present] };
}

async function schemaSnapshot(database = adapter) {
  const tables = await database.query(
    'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?) ORDER BY TABLE_NAME',
    ['subjects', 'subject_class_assignments']
  );
  const columns = await database.query(
    'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = ? AND COLUMN_NAME IN (?, ?)) OR (TABLE_NAME = ? AND COLUMN_NAME = ?)) ORDER BY TABLE_NAME, COLUMN_NAME',
    ['subjects', 'assessment_components_json', 'is_active', 'subject_class_assignments', 'configuration_version']
  );
  return { tables: tables.map((row) => row.tableName), columns };
}

function verifySchema(snapshot) {
  const presentTables = new Set(snapshot.tables);
  const missingTables = ['subjects', 'subject_class_assignments'].filter((table) => !presentTables.has(table));
  if (missingTables.length) {
    throw Object.assign(new Error('Migration 065 subject tables are missing.'), {
      code: 'MIGRATION_065_SCHEMA_VERIFICATION_FAILED',
      details: { missingTables }
    });
  }
  const missing = [];
  const mismatched = [];
  for (const expected of EXPECTED_COLUMNS) {
    const column = snapshot.columns.find((row) => row.tableName === expected.table && row.columnName === expected.column);
    if (!column) {
      missing.push(`${expected.table}.${expected.column}`);
      continue;
    }
    if (!expected.type.test(String(column.columnType ?? '')) || column.nullable !== expected.nullable) {
      mismatched.push({ table: expected.table, column: expected.column, actualType: column.columnType, actualNullable: column.nullable });
      continue;
    }
    if (expected.defaultValue !== undefined && String(column.defaultValue) !== expected.defaultValue) {
      mismatched.push({ table: expected.table, column: expected.column, actualDefault: column.defaultValue });
    }
  }
  if (missing.length || mismatched.length) {
    throw Object.assign(new Error('Migration 065 schema verification failed.'), {
      code: 'MIGRATION_065_SCHEMA_VERIFICATION_FAILED',
      details: { missing, mismatched }
    });
  }
}

async function migrationLedger() {
  await adapter.ensureMetadata({ create: false });
  return adapter.query(
    'SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version IN (?, ?) ORDER BY version',
    [PREDECESSOR_VERSION, VERSION]
  );
}

async function historicalRecordCounts(database = adapter) {
  const rows = await database.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (LOWER(TABLE_NAME) LIKE '%subject%' OR LOWER(TABLE_NAME) LIKE '%mark%' OR LOWER(TABLE_NAME) LIKE '%score%' OR LOWER(TABLE_NAME) LIKE '%result%' OR LOWER(TABLE_NAME) LIKE '%assessment%' OR LOWER(TABLE_NAME) LIKE '%register%' OR LOWER(TABLE_NAME) LIKE '%student%') ORDER BY TABLE_NAME"
  );
  const counts = {};
  for (const row of rows) {
    const table = String(row.tableName);
    if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
    const result = await database.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``);
    counts[table] = Number(result[0]?.rowCount ?? 0);
  }
  return counts;
}

async function main() {
  if (!['dry-run', 'apply'].includes(mode)) {
    throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
  }
  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
  }
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== EXECUTION_TOKEN) {
    throw Object.assign(new Error('Exact subject assessment migration approval token is required.'), { code: 'MIGRATION_APPROVAL_REQUIRED' });
  }
  adapter = createDatabaseAdapter({ environment: process.env });
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const predecessor = migrations.find((item) => item.version === PREDECESSOR_VERSION && item.name === PREDECESSOR_NAME);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!predecessor) throw Object.assign(new Error(`Required predecessor ${PREDECESSOR_NAME} is missing.`), { code: 'MIGRATION_065_PREDECESSOR_FILE_MISSING' });
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_065_FILE_MISSING' });
  if (/\b(DROP|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO|UPDATE\s|INSERT\s+INTO)\b/i.test(migration.sql)) {
    throw Object.assign(new Error('Migration 065 contains a non-additive or destructive operation.'), { code: 'MIGRATION_065_NON_ADDITIVE_SQL' });
  }
  const beforeLedger = await migrationLedger();
  const ledger64 = beforeLedger.find((row) => Number(row.version) === PREDECESSOR_VERSION);
  if (!ledger64 || ledger64.name !== predecessor.name || ledger64.checksum !== predecessor.checksum) {
    throw Object.assign(new Error('Migration 064 must be applied and checksum-verified before Migration 065.'), {
      code: 'MIGRATION_065_PREDECESSOR_NOT_VERIFIED',
      details: { predecessor: { version: PREDECESSOR_VERSION, name: predecessor.name, checksum: predecessor.checksum }, ledger: ledger64 ?? null }
    });
  }
  const prerequisites = await verifyPrerequisites();
  const beforeSchema = await schemaSnapshot();
  const beforeHistoricalCounts = await historicalRecordCounts();
  const ledger65 = beforeLedger.find((row) => Number(row.version) === VERSION);
  const recorded = Boolean(ledger65 && ledger65.name === migration.name && ledger65.checksum === migration.checksum);
  if (recorded) {
    verifySchema(beforeSchema);
  } else {
    const existingColumns = beforeSchema.columns.map(({ tableName, columnName }) => `${tableName}.${columnName}`);
    const ambiguousColumns = existingColumns.filter((column) => !ALLOWED_PREEXISTING_COLUMNS.has(column));
    if (ambiguousColumns.length > 0) {
      throw Object.assign(new Error('Migration 065 columns exist without the matching migration ledger record; refusing ambiguous apply.'), {
        code: 'MIGRATION_065_PREEXISTING_COLUMNS',
        details: { existingColumns: ambiguousColumns, allowedPreexistingColumns: [...ALLOWED_PREEXISTING_COLUMNS], ledger: ledger65 ?? null }
      });
    }
    const sharedColumn = beforeSchema.columns.find(({ tableName, columnName }) => `${tableName}.${columnName}` === 'subject_class_assignments.configuration_version');
    const sharedColumnSpec = EXPECTED_COLUMNS.find(({ table, column }) => `${table}.${column}` === 'subject_class_assignments.configuration_version');
    if (sharedColumn && (!sharedColumnSpec.type.test(String(sharedColumn.columnType ?? '')) || sharedColumn.nullable !== sharedColumnSpec.nullable)) {
      throw Object.assign(new Error('Migration 065 shared prerequisite column is incompatible.'), {
        code: 'MIGRATION_065_SCHEMA_VERIFICATION_FAILED',
        details: { mismatched: [{ table: sharedColumn.tableName, column: sharedColumn.columnName, actualType: sharedColumn.columnType, actualNullable: sharedColumn.nullable }] }
      });
    }
  }

  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [PREDECESSOR_VERSION], dryRun: true });
  if (mode === 'dry-run') {
    return {
      ok: true,
      mode,
      database,
      migration: { version: VERSION, name: migration.name, checksum: migration.checksum },
      prerequisites,
      beforeLedger,
      beforeSchema,
      beforeHistoricalCounts,
      pending: dryRun.pending,
      status: recorded ? 'ALREADY_APPLIED' : 'PENDING',
      productionWrites: 'NONE'
    };
  }

  const result = await runner.applyVersions({
    versions: [VERSION],
    requiredAppliedVersions: [PREDECESSOR_VERSION],
    verifyMigration: async ({ adapter: transaction }) => verifySchema(await schemaSnapshot(transaction))
  });
  const afterLedger = await migrationLedger();
  const afterSchema = await schemaSnapshot();
  const afterHistoricalCounts = await historicalRecordCounts();
  verifySchema(afterSchema);
  const matchingLedger = afterLedger.find((row) => Number(row.version) === VERSION && row.name === migration.name && row.checksum === migration.checksum);
  if (!matchingLedger) {
    throw Object.assign(new Error('Migration 065 ledger verification failed.'), {
      code: 'MIGRATION_065_LEDGER_VERIFICATION_FAILED',
      details: { afterLedger }
    });
  }
  if (JSON.stringify(beforeHistoricalCounts) !== JSON.stringify(afterHistoricalCounts)) {
    throw Object.assign(new Error('Migration 065 changed protected subject or academic record counts.'), {
      code: 'MIGRATION_065_HISTORICAL_RECORD_COUNT_CHANGED',
      details: { beforeHistoricalCounts, afterHistoricalCounts }
    });
  }
  return {
    ok: true,
    mode,
    database,
    migration: { version: VERSION, name: migration.name, checksum: migration.checksum },
    prerequisites,
    beforeLedger,
    afterLedger,
    beforeSchema,
    afterSchema,
    beforeHistoricalCounts,
    afterHistoricalCounts,
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
  await adapter?.close?.();
}
