import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const VERSION = 66;
const NAME = '066_subject_class_assignments_reconciliation.sql';
const APPLY_TOKEN = 'APPLY_SUBJECT_CLASS_ASSIGNMENTS_066';
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const mode = process.argv[2] ?? 'dry-run';
const executionToken = process.env.EXECUTION_TOKEN ?? 'DRY_RUN_ONLY';
const backupConfirmation = process.env.BACKUP_CONFIRMATION ?? '';
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_066_PREFLIGHT_FAILED', message: cause?.message ?? String(cause), details: cause?.details ?? null } });
const rows = (value) => Array.isArray(value) ? value : [];
const field = (row, name) => row?.[name] ?? row?.[name.toUpperCase()] ?? row?.[name.toLowerCase()];

function fail(code, message, details = null) { throw Object.assign(new Error(message), { code, details }); }
function requireColumn(columns, table, column) {
  const found = columns.some((row) => field(row, 'tableName') === table && field(row, 'columnName') === column);
  if (!found) fail('MIGRATION_066_REQUIRED_COLUMN_MISSING', `${table}.${column} is required.`, { table, column });
}
function hasColumn(columns, table, column) { return columns.some((row) => field(row, 'tableName') === table && field(row, 'columnName') === column); }

async function databaseIdentity(adapter) {
  const result = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0];
  const database = field(result, 'databaseName');
  if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database });
  return database;
}

async function snapshot(adapter) {
  const names = ['schema_migrations', 'schema_baselines', 'schema_migration_lock', 'schools', 'classes', 'subjects', 'academic_years', 'class_subjects', 'subject_class_assignments', 'academic_score_records', 'result_signatures'];
  const placeholders = names.map(() => '?').join(',');
  const tables = rows(await adapter.query(`SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`, names));
  const present = new Set(tables.map((row) => field(row, 'tableName')));
  const columns = rows(await adapter.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME, ORDINAL_POSITION`, names));
  const indexes = rows(await adapter.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, names));
  const foreignKeys = rows(await adapter.query(`SELECT k.TABLE_NAME AS tableName, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.DELETE_RULE AS deleteRule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${placeholders}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, names));
  return { tables, present, columns, indexes, foreignKeys };
}

async function ledger(adapter) {
  await adapter.ensureMetadata({ create: false });
  const migrationRows = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations ORDER BY version'));
  const baselineRows = rows(await adapter.query('SELECT id,canonical_database AS canonicalDatabase,baseline_at AS baselineAt,repository_commit AS repositoryCommit,schema_fingerprint AS schemaFingerprint,reconciliation_migration AS reconciliationMigration,workflow_provenance AS workflowProvenance,baseline_type AS baselineType,historical_migrations_executed AS historicalMigrationsExecuted,created_at AS createdAt FROM schema_baselines ORDER BY baseline_at'));
  return { migrationRows, baselineRows };
}

async function counts(adapter, present) {
  const count = async (table) => present.has(table) ? Number(field(rows(await adapter.query(`SELECT COUNT(*) AS rowCount FROM \`${table}\``))[0], 'rowCount') ?? 0) : null;
  const result = {};
  for (const table of ['subjects', 'classes', 'class_subjects', 'academic_score_records', 'result_signatures', 'subject_class_assignments']) result[table] = await count(table);
  if (present.has('class_subjects') && present.has('classes') && present.has('subjects')) {
    result.orphanClassSubjectRows = Number(field(rows(await adapter.query('SELECT COUNT(*) AS rowCount FROM class_subjects cs LEFT JOIN classes c ON c.id=cs.class_id LEFT JOIN subjects s ON s.id=cs.subject_id WHERE c.id IS NULL OR s.id IS NULL'))[0], 'rowCount') ?? 0);
    result.crossSchoolClassSubjectRows = hasColumn(await adapter.query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('classes','subjects')"), 'classes', 'school_id')
      ? Number(field(rows(await adapter.query('SELECT COUNT(*) AS rowCount FROM class_subjects cs JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id WHERE c.school_id <> s.school_id'))[0], 'rowCount') ?? 0)
      : null;
    result.duplicateClassSubjectRows = Number(field(rows(await adapter.query('SELECT COUNT(*) AS rowCount FROM (SELECT class_id,subject_id,COUNT(*) AS n FROM class_subjects GROUP BY class_id,subject_id HAVING COUNT(*) > 1) duplicates'))[0], 'rowCount') ?? 0);
  } else {
    result.orphanClassSubjectRows = null; result.crossSchoolClassSubjectRows = null; result.duplicateClassSubjectRows = null;
  }
  return result;
}

async function main() {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) fail('MIGRATION_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A recent recoverable backup confirmation is required.');
  const adapter = await createDatabaseAdapter({ environment: process.env });
  try {
    const database = await databaseIdentity(adapter);
    const migrations = await discoverMigrations(directory);
    const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
    if (!migration) fail('MIGRATION_066_FILE_MISSING', `Required migration ${NAME} is missing.`);
    const migration063 = migrations.find((item) => item.version === 63);
    const migration064 = migrations.find((item) => item.version === 64);
    if (!migration063 || !migration064) fail('MIGRATION_063_064_FILES_MISSING', 'Migration 063 and 064 definitions are required.');
    const beforeLedger = await ledger(adapter);
    const applied = new Map(beforeLedger.migrationRows.map((row) => [Number(field(row, 'version')), row]));
    for (const target of [migration063, migration064]) {
      const row = applied.get(target.version);
      if (!row || field(row, 'name') !== target.name || field(row, 'checksum') !== target.checksum) fail(`MIGRATION_${target.version}_CHECKSUM_MISMATCH`, `Migration ${target.version} ledger checksum is not verified.`, { expected: target, actual: row ?? null });
    }
    const baseline = beforeLedger.baselineRows.at(-1);
    if (!baseline || field(baseline, 'canonicalDatabase') !== EXPECTED_DATABASE) fail('MIGRATION_BASELINE_REQUIRED', 'A matching production migration baseline is required.');
    const schema = await snapshot(adapter);
    for (const table of ['schools', 'classes', 'subjects', 'academic_years', 'class_subjects']) if (!schema.present.has(table)) fail('MIGRATION_066_PREREQUISITE_TABLE_MISSING', `${table} is required for reconciliation.`, { table });
    for (const [table, column] of [['classes', 'id'], ['classes', 'school_id'], ['subjects', 'id'], ['subjects', 'school_id'], ['class_subjects', 'class_id'], ['class_subjects', 'subject_id']]) requireColumn(schema.columns, table, column);
    const beforeCounts = await counts(adapter, schema.present);
    if (beforeCounts.orphanClassSubjectRows !== 0 || beforeCounts.crossSchoolClassSubjectRows !== 0 || beforeCounts.duplicateClassSubjectRows !== 0) fail('MIGRATION_066_LEGACY_MAPPING_INVALID', 'Legacy class_subjects contains invalid, cross-school, or duplicate relationships.', { beforeCounts });
    if (schema.present.has('subject_class_assignments')) fail('MIGRATION_066_ALREADY_PRESENT', 'subject_class_assignments already exists; refusing an ambiguous reconciliation.', { beforeCounts });
    if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, verifiedPredecessors: [63, 64], baseline, schema: { presentTables: [...schema.present].sort(), classSubjectColumns: schema.columns.filter((row) => field(row, 'tableName') === 'class_subjects'), referencedForeignKeys: schema.foreignKeys.filter((row) => ['classes', 'subjects', 'academic_years', 'schools'].includes(field(row, 'referencedTable'))) }, beforeCounts, backupRecoveryReadiness: { status: 'REQUIRES_OPERATOR_CONFIRMATION_BEFORE_APPLY', productionWrites: 'NONE' }, pending: [{ version: VERSION, name: NAME, checksum: migration.checksum }] };
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [64], dryRun: false, verifyMigration: async ({ adapter: transaction }) => {
      const check = await transaction.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subject_class_assignments'");
      if (!check.length) fail('MIGRATION_066_SCHEMA_VERIFICATION_FAILED', 'subject_class_assignments was not created.');
    } });
    return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeCounts, applied: result.applied, productionWrites: 'SCHEMA_AND_LEGACY_MAPPING_COPY_ONLY' };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; }
