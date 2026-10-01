import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationRunner, discoverMigrations } from './platform/migration-runner.js';
import { detectAcademicYearNameUniqueIndexes, THREE_TERM_CONFIGURATION } from './production-three-term-config.js';

export const TERMS_UNIQUE_MIGRATION = Object.freeze({
  version: 60,
  name: '060_terms_academic_year_name_unique.sql',
  indexName: 'uq_terms_academic_year_name',
  columns: Object.freeze(['academic_year_id', 'name'])
});

const EXPECTED_DATABASE = 'osaahdaylightschool';
const MAX_TIDB_INDEX_BYTES = 3072;
const MIGRATIONS_DIRECTORY = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };
const normalized = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const canonicalTermName = (value) => new Map([
  ['first term', 'first term'], ['1st term', 'first term'],
  ['second term', 'second term'], ['2nd term', 'second term'],
  ['third term', 'third term'], ['3rd term', 'third term']
]).get(normalized(value)) ?? normalized(value);

const columnDefinitionSql = `SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
    IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault,
    CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength, CHARACTER_SET_NAME AS characterSetName,
    COLLATION_NAME AS collationName, ORDINAL_POSITION AS ordinalPosition
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'terms'
  ORDER BY ORDINAL_POSITION`;

const indexMetadataSql = `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName,
    INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex,
    COLUMN_NAME AS columnName, SUB_PART AS subPart
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'terms'
  ORDER BY INDEX_NAME, SEQ_IN_INDEX`;

const duplicateRowsSql = `SELECT t.id, t.academic_year_id AS academicYearId, t.name,
    d.duplicateCount
  FROM terms t
  JOIN (
    SELECT academic_year_id, name, COUNT(*) AS duplicateCount
    FROM terms
    GROUP BY academic_year_id, name
    HAVING COUNT(*) > 1
  ) d ON d.academic_year_id = t.academic_year_id AND d.name = t.name
  ORDER BY t.academic_year_id, t.name, t.id`;

const allTermRowsSql = `SELECT id, school_id AS schoolId, academic_year_id AS academicYearId,
    name, term_number AS termNumber, starts_on AS startsOn, ends_on AS endsOn,
    is_current AS isCurrent, created_at AS createdAt
  FROM terms
  ORDER BY academic_year_id, name, id`;

function charsetMaxBytes(charset) {
  const value = normalized(charset);
  if (value === 'utf8mb4') return 4;
  if (value === 'utf8' || value === 'utf8mb3') return 3;
  if (['ascii', 'latin1', 'binary', 'cp1250', 'cp1251', 'cp1252'].includes(value)) return 1;
  return null;
}

function columnContract(columnRows) {
  const byName = new Map(columnRows.map((row) => [normalized(row.columnName ?? row.COLUMN_NAME), row]));
  const year = byName.get('academic_year_id') ?? null;
  const name = byName.get('name') ?? null;
  const details = [year, name].filter(Boolean).map((row) => ({
    name: row.columnName ?? row.COLUMN_NAME,
    dataType: row.dataType ?? row.DATA_TYPE,
    type: row.columnType ?? row.COLUMN_TYPE,
    nullable: row.isNullable ?? row.IS_NULLABLE,
    default: row.columnDefault ?? row.COLUMN_DEFAULT ?? null,
    characterMaximumLength: Number(row.characterMaximumLength ?? row.CHARACTER_MAXIMUM_LENGTH),
    characterSet: row.characterSetName ?? row.CHARACTER_SET_NAME ?? null,
    collation: row.collationName ?? row.COLLATION_NAME ?? null
  }));
  const byteSizes = [year, name].map((row) => {
    if (!row) return null;
    const length = Number(row.characterMaximumLength ?? row.CHARACTER_MAXIMUM_LENGTH);
    const bytes = charsetMaxBytes(row.characterSetName ?? row.CHARACTER_SET_NAME);
    return Number.isFinite(length) && bytes ? length * bytes : null;
  });
  const keyBytes = byteSizes.every(Number.isFinite) ? byteSizes.reduce((sum, value) => sum + value, 0) : null;
  const validType = (row) => {
    const dataType = normalized(row?.dataType ?? row?.DATA_TYPE);
    return dataType === 'varchar' || dataType === 'char';
  };
  const valid = Boolean(year && name)
    && [year, name].every((row) => normalized(row.isNullable ?? row.IS_NULLABLE) === 'no')
    && [year, name].every(validType)
    && byteSizes.every((value) => Number.isFinite(value) && value > 0)
    && keyBytes <= MAX_TIDB_INDEX_BYTES;
  return {
    ok: valid,
    columns: details,
    maximumCompositeKeyBytes: keyBytes,
    TiDBMaximumIndexBytes: MAX_TIDB_INDEX_BYTES,
    expectedOrderedColumns: [...TERMS_UNIQUE_MIGRATION.columns],
    reason: valid ? null : 'Required columns must be NOT NULL full-length CHAR/VARCHAR values within the TiDB index key limit; no column alterations are attempted.'
  };
}

function uniqueKeyConflictGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const year = String(row.academicYearId ?? row.academic_year_id ?? '');
    const name = String(row.name ?? '');
    const key = `${year}\u0000${normalized(name)}`;
    const group = groups.get(key) ?? {
      academicYearId: year,
      name,
      duplicateCount: Number(row.duplicateCount ?? row.duplicate_count ?? 0),
      rows: []
    };
    group.rows.push({ id: row.id, academicYearId: year, name });
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, duplicateCount: group.duplicateCount || group.rows.length }));
}

function exactLiteralGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${String(row.academicYearId ?? '')}\u0000${String(row.name ?? '')}`;
    const group = groups.get(key) ?? { academicYearId: row.academicYearId, name: row.name, rows: [] };
    group.rows.push({ id: row.id, academicYearId: row.academicYearId, name: row.name });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.rows.length > 1).map((group) => ({ ...group, duplicateCount: group.rows.length }));
}

function equivalentNameGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const canonicalName = canonicalTermName(row.name);
    if (!['first term', 'second term', 'third term'].includes(canonicalName)) continue;
    const key = `${String(row.academicYearId ?? '')}\u0000${canonicalName}`;
    const group = groups.get(key) ?? { academicYearId: row.academicYearId, canonicalName, rows: [] };
    group.rows.push({ id: row.id, name: row.name, termNumber: Number(row.termNumber), startsOn: row.startsOn, endsOn: row.endsOn });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.rows.length > 1);
}

function stableTermSnapshot(rows) {
  const values = rows.map((row) => ({
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    name: row.name,
    termNumber: Number(row.termNumber),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    isCurrent: Number(row.isCurrent),
    createdAt: row.createdAt
  }));
  return { rowCount: values.length, sha256: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
}

function normalizeIndexRows(rows) {
  return rows.map((row) => ({
    tableSchema: row.tableSchema ?? row.TABLE_SCHEMA,
    tableName: row.tableName ?? row.TABLE_NAME,
    indexName: row.indexName ?? row.INDEX_NAME,
    nonUnique: Number(row.nonUnique ?? row.NON_UNIQUE),
    seqInIndex: Number(row.seqInIndex ?? row.SEQ_IN_INDEX),
    columnName: row.columnName ?? row.COLUMN_NAME,
    subPart: row.subPart ?? row.SUB_PART ?? null
  }));
}

export async function inspectTermsUniquenessPreflight(adapter, { expectedDatabase = EXPECTED_DATABASE } = {}) {
  if (!adapter?.query) fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.');
  const [databaseRows, tableRows, columns, indexes, duplicateRows, termRows] = await Promise.all([
    adapter.query('SELECT DATABASE() AS databaseName'),
    adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'terms'"),
    adapter.query(columnDefinitionSql),
    adapter.query(indexMetadataSql),
    adapter.query(duplicateRowsSql),
    adapter.query(allTermRowsSql)
  ]);
  const database = databaseRows[0]?.databaseName ?? databaseRows[0]?.database_name ?? null;
  const termsTablePresent = tableRows.some((row) => (row.tableName ?? row.TABLE_NAME) === 'terms');
  const uniqueIndexRows = normalizeIndexRows(indexes);
  const matchingUniqueIndexes = detectAcademicYearNameUniqueIndexes(uniqueIndexRows, { schemaName: expectedDatabase });
  const exactDuplicateGroups = uniqueKeyConflictGroups(duplicateRows);
  const literalExactDuplicateGroups = exactLiteralGroups(termRows);
  const canonicalNameConflicts = equivalentNameGroups(termRows);
  const databaseDuplicateRowCount = duplicateRows.length;
  const termDataSnapshot = stableTermSnapshot(termRows);
  const targetYearTerms = termRows
    .filter((row) => String(row.academicYearId) === THREE_TERM_CONFIGURATION.academicYearId)
    .map((row) => ({
      id: row.id,
      schoolId: row.schoolId,
      academicYearId: row.academicYearId,
      name: row.name,
      termNumber: Number(row.termNumber),
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      isCurrent: Number(row.isCurrent),
      createdAt: row.createdAt
    }));
  const uniqueColumns = columnContract(columns);
  const presentColumnNames = new Set(columns.map((row) => normalized(row.columnName ?? row.COLUMN_NAME)));
  const productionRunnerColumns = ['id', 'school_id', 'academic_year_id', 'name', 'term_number', 'starts_on', 'ends_on', 'is_current', 'created_at'];
  const productionRunnerContract = {
    ok: productionRunnerColumns.every((name) => presentColumnNames.has(name)),
    requiredColumns: productionRunnerColumns,
    missingColumns: productionRunnerColumns.filter((name) => !presentColumnNames.has(name))
  };
  const safeToApplyMigration = database === expectedDatabase
    && termsTablePresent
    && uniqueColumns.ok
    && databaseDuplicateRowCount === 0;
  return {
    ok: true,
    mode: 'READ_ONLY_TERMS_UNIQUENESS_PREFLIGHT',
    database,
    expectedDatabase,
    termsTablePresent,
    columns: columns.map((row) => ({
      name: row.columnName ?? row.COLUMN_NAME,
      dataType: row.dataType ?? row.DATA_TYPE,
      type: row.columnType ?? row.COLUMN_TYPE,
      nullable: row.isNullable ?? row.IS_NULLABLE,
      default: row.columnDefault ?? row.COLUMN_DEFAULT ?? null,
      characterMaximumLength: row.characterMaximumLength ?? row.CHARACTER_MAXIMUM_LENGTH ?? null,
      characterSet: row.characterSetName ?? row.CHARACTER_SET_NAME ?? null,
      collation: row.collationName ?? row.COLLATION_NAME ?? null,
      ordinalPosition: row.ordinalPosition ?? row.ORDINAL_POSITION
    })),
    uniqueColumnContract: uniqueColumns,
    productionRunnerContract,
    indexes: uniqueIndexRows,
    uniquenessAlreadyPresent: matchingUniqueIndexes.length > 0,
    matchingUniqueIndexes,
    exactDuplicateGroups,
    literalExactDuplicateGroups,
    databaseDuplicateGroupCount: exactDuplicateGroups.length,
    databaseDuplicateRowCount,
    databaseDuplicateRows: duplicateRows.map((row) => ({
      id: row.id,
      academicYearId: row.academicYearId ?? row.academic_year_id,
      name: row.name,
      duplicateCount: Number(row.duplicateCount ?? row.duplicate_count)
    })),
    canonicalTermNameConflicts: canonicalNameConflicts,
    termDataSnapshot,
    targetYearTerms,
    productionWrites: 'NONE',
    safeToApplyMigration
  };
}

async function ledgerRow(adapter) {
  await adapter.ensureMetadata({ create: false });
  const rows = await adapter.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version = ?', [TERMS_UNIQUE_MIGRATION.version]);
  return rows[0] ?? null;
}

function assertUniqueIndex(indexRows) {
  const matches = detectAcademicYearNameUniqueIndexes(indexRows, { schemaName: EXPECTED_DATABASE });
  if (!matches.length) fail('MIGRATION_060_INDEX_VERIFICATION_FAILED', 'Migration 060 did not establish full-column uniqueness on terms(academic_year_id, name).', { indexRows: normalizeIndexRows(indexRows) });
  return matches;
}

export async function runTermsUniquenessMigration({ adapter, directory = MIGRATIONS_DIRECTORY, mode = 'dry-run' } = {}) {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MIGRATION_MODE', 'Only dry-run or apply is allowed.');
  if (!adapter?.query) fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.');
  const before = await inspectTermsUniquenessPreflight(adapter);
  if (!before.safeToApplyMigration && !(mode === 'dry-run' && before.uniquenessAlreadyPresent)) {
    const code = before.databaseDuplicateRowCount ? 'MIGRATION_060_DUPLICATE_TERMS' : 'MIGRATION_060_PREFLIGHT_FAILED';
    fail(code, 'Terms uniqueness preflight failed; no schema or term data was changed.', { preflight: before });
  }
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === TERMS_UNIQUE_MIGRATION.version && item.name === TERMS_UNIQUE_MIGRATION.name);
  if (!migration) fail('MIGRATION_060_FILE_MISSING', `Required migration ${TERMS_UNIQUE_MIGRATION.name} is missing.`);
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const plan = await runner.applyVersions({ versions: [TERMS_UNIQUE_MIGRATION.version], dryRun: true });
  const beforeLedger = await ledgerRow(adapter);
  const alreadyApplied = plan.pending.length === 0;
  if (alreadyApplied) {
    const matches = assertUniqueIndex(before.indexes);
    if (!beforeLedger || Number(beforeLedger.version) !== TERMS_UNIQUE_MIGRATION.version || beforeLedger.name !== migration.name || beforeLedger.checksum !== migration.checksum) {
      fail('MIGRATION_060_LEDGER_VERIFICATION_FAILED', 'Migration 060 is recorded inconsistently with the checked-in migration.', { beforeLedger, expected: { version: migration.version, name: migration.name, checksum: migration.checksum } });
    }
    if (mode === 'apply') return { ok: true, mode, database: before.database, migration: { version: migration.version, name: migration.name, checksum: migration.checksum }, alreadyApplied: true, before, after: before, beforeLedger, afterLedger: beforeLedger, uniqueIndexes: matches, productionWrites: 'NONE' };
    return { ok: true, mode, database: before.database, migration: { version: migration.version, name: migration.name, checksum: migration.checksum }, alreadyApplied: true, pending: [], before, beforeLedger, uniqueIndexes: matches, productionWrites: 'NONE' };
  }
  if (!before.safeToApplyMigration || before.uniquenessAlreadyPresent) {
    fail('MIGRATION_060_PREFLIGHT_FAILED', 'Migration 060 is not safe to apply in the current production state.', { preflight: before, pending: plan.pending });
  }
  if (mode === 'dry-run') {
    return {
      ok: true,
      mode,
      database: before.database,
      migration: { version: migration.version, name: migration.name, checksum: migration.checksum },
      before,
      beforeLedger,
      pending: plan.pending,
      productionWrites: 'NONE'
    };
  }

  const applied = await runner.applyVersions({
    versions: [TERMS_UNIQUE_MIGRATION.version],
    beforeApply: async ({ adapter: lockedAdapter }) => {
      const lockedPreflight = await inspectTermsUniquenessPreflight(lockedAdapter);
      if (!lockedPreflight.safeToApplyMigration || lockedPreflight.uniquenessAlreadyPresent) {
        fail('MIGRATION_060_LOCKED_PREFLIGHT_FAILED', 'The locked production preflight no longer matches the reviewed safe state.', { preflight: lockedPreflight });
      }
      if (lockedPreflight.termDataSnapshot.rowCount !== before.termDataSnapshot.rowCount || lockedPreflight.termDataSnapshot.sha256 !== before.termDataSnapshot.sha256) {
        fail('MIGRATION_060_DATA_CHANGED_DURING_PREFLIGHT', 'Term rows changed after the read-only preflight; no migration was applied.', { before: before.termDataSnapshot, current: lockedPreflight.termDataSnapshot });
      }
    },
    verifyMigration: async ({ adapter: transaction }) => {
      const currentIndexes = await transaction.query(indexMetadataSql);
      assertUniqueIndex(currentIndexes);
      const currentColumns = await transaction.query(columnDefinitionSql);
      const verifiedColumnContract = columnContract(currentColumns);
      if (!verifiedColumnContract.ok) fail('MIGRATION_060_COLUMN_VERIFICATION_FAILED', 'The terms identity columns changed during the migration.', { columnContract: verifiedColumnContract });
    }
  });

  const after = await inspectTermsUniquenessPreflight(adapter);
  const afterLedger = await ledgerRow(adapter);
  const uniqueIndexes = assertUniqueIndex(after.indexes);
  if (after.databaseDuplicateRowCount !== 0) fail('MIGRATION_060_POSTCHECK_DUPLICATE_TERMS', 'Unexpected term duplicate detected after migration.', { duplicateGroups: after.exactDuplicateGroups });
  if (before.termDataSnapshot.rowCount !== after.termDataSnapshot.rowCount || before.termDataSnapshot.sha256 !== after.termDataSnapshot.sha256) {
    fail('MIGRATION_060_DATA_PRESERVATION_FAILED', 'Term rows changed during the schema-only migration.', { before: before.termDataSnapshot, after: after.termDataSnapshot });
  }
  if (!afterLedger || Number(afterLedger.version) !== migration.version || afterLedger.name !== migration.name || afterLedger.checksum !== migration.checksum) {
    fail('MIGRATION_060_LEDGER_VERIFICATION_FAILED', 'Migration 060 ledger verification failed.', { afterLedger, expected: { version: migration.version, name: migration.name, checksum: migration.checksum } });
  }
  return {
    ok: true,
    mode,
    database: before.database,
    migration: { version: migration.version, name: migration.name, checksum: migration.checksum },
    before,
    after,
    beforeLedger,
    afterLedger,
    uniqueIndexes,
    applied: applied.applied,
    termDataUnchanged: true,
    productionWrites: 'SCHEMA_ONLY_TERMS_UNCHANGED'
  };
}
