import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

const VERSION = 85;
const NAME = '085_global_student_id_unique.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_GLOBAL_STUDENT_ID_UNIQUE_085';
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];
const safeError = (error) => ({ code: error?.code ?? 'GLOBAL_STUDENT_ID_MIGRATION_FAILED', message: error?.code ? error.message : 'Migration 085 failed safely.', ...(error?.code === 'MIGRATION_085_DUPLICATE_IDS' ? { duplicateGroupCount: Number(error.details?.duplicateGroupCount), duplicateRowCount: Number(error.details?.duplicateRowCount) } : {}), ...(error?.code === 'MIGRATION_085_EQUIVALENT_INDEX_EXISTS' ? { equivalentUniqueIndexes: error.details?.indexNames ?? [] } : {}) });

const permanentIdPattern = '^OSAAH?/[0-9]{4}/[0-9]{3,}$';

async function snapshot(adapter, { readiness: verifiedReadiness } = {}) {
  const readiness = verifiedReadiness ?? await adapter.verifyReadiness?.();
  if (readiness?.ready !== true || readiness.engine !== 'TiDB' || readiness.database !== EXPECTED_DATABASE || !String(readiness.serverVersion ?? '').trim()) throw Object.assign(new Error('Canonical production TiDB identity and version could not be verified.'), { code: 'DATABASE_IDENTITY_MISMATCH' });
  const databaseName = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('students','schema_migrations')"));
  const tableRows = rows(await adapter.query("SELECT ENGINE AS engine,TABLE_COLLATION AS tableCollation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students'"));
  const columns = rows(await adapter.query("SELECT COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,CHARACTER_MAXIMUM_LENGTH AS maxLength,CHARACTER_SET_NAME AS characterSet,COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND COLUMN_NAME='permanent_student_id'"));
  const duplicateSummary = rows(await adapter.query('SELECT COUNT(*) AS duplicateGroupCount,COALESCE(SUM(duplicateRows),0) AS duplicateRowCount FROM (SELECT COUNT(*) AS duplicateRows FROM students WHERE permanent_student_id IS NOT NULL GROUP BY permanent_student_id HAVING COUNT(*)>1) duplicates'))[0] ?? {};
  const idQuality = rows(await adapter.query('SELECT COUNT(*) AS totalStudentCount,COALESCE(SUM(permanent_student_id IS NULL),0) AS nullIdCount,COALESCE(SUM(permanent_student_id IS NOT NULL AND TRIM(permanent_student_id)=\'\'),0) AS emptyIdCount,COALESCE(SUM(permanent_student_id IS NOT NULL AND TRIM(permanent_student_id)<>\'\' AND TRIM(permanent_student_id) NOT REGEXP ?),0) AS malformedIdCount FROM students', [permanentIdPattern]))[0] ?? {};
  const partitionRows = rows(await adapter.query("SELECT COUNT(DISTINCT PARTITION_NAME) AS partitionCount FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND PARTITION_NAME IS NOT NULL"));
  const indexes = rows(await adapter.query("SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND (INDEX_NAME='uq_students_permanent_student_id_global' OR COLUMN_NAME='permanent_student_id') ORDER BY INDEX_NAME,SEQ_IN_INDEX"));
  const ledger = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]));
  const column = columns[0];
  const charset = String(column?.characterSet ?? column?.CHARACTER_SET_NAME ?? '').toLowerCase();
  const bytesPerCharacter = ({ ascii: 1, latin1: 1, binary: 1, utf8: 3, utf8mb3: 3, utf8mb4: 4, gbk: 2 })[charset] ?? null;
  const maxLength = Number(column?.maxLength ?? column?.CHARACTER_MAXIMUM_LENGTH);
  const indexByteLength = Number.isFinite(maxLength) && bytesPerCharacter != null ? maxLength * bytesPerCharacter : null;
  const indexRows = indexes.map((row) => ({ indexName: String(row.indexName ?? row.INDEX_NAME), nonUnique: Number(row.nonUnique ?? row.NON_UNIQUE), columnName: String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), sequence: Number(row.sequence ?? row.SEQ_IN_INDEX), subPart: row.subPart ?? row.SUB_PART ?? null }));
  const namedIndex = indexRows.filter((index) => index.indexName === 'uq_students_permanent_student_id_global');
  const indexParts = new Map();
  for (const index of indexRows) {
    if (!indexParts.has(index.indexName)) indexParts.set(index.indexName, []);
    indexParts.get(index.indexName).push(index);
  }
  const equivalentUniqueIndexes = [...indexParts.entries()].filter(([name, parts]) => name !== 'uq_students_permanent_student_id_global' && parts.length === 1 && parts[0].nonUnique === 0 && parts[0].columnName === 'permanent_student_id' && parts[0].sequence === 1 && parts[0].subPart == null).map(([name]) => name);
  let indexUsable = false;
  if (namedIndex.length === 1 && namedIndex[0].nonUnique === 0 && namedIndex[0].columnName === 'permanent_student_id' && namedIndex[0].sequence === 1 && namedIndex[0].subPart == null) {
    const explain = rows(await adapter.query('EXPLAIN SELECT id FROM students FORCE INDEX (uq_students_permanent_student_id_global) WHERE permanent_student_id=?', ['__OSAAH_MIGRATION_085_INDEX_VERIFY__']));
    indexUsable = explain.length > 0 && JSON.stringify(explain).includes('uq_students_permanent_student_id_global');
  }
  return {
    databaseName,
    engine: readiness.engine,
    serverVersion: String(readiness.serverVersion),
    tables: tables.map((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase()),
    studentsTable: tableRows.length ? { engine: String(tableRows[0].engine ?? tableRows[0].ENGINE ?? ''), tableCollation: String(tableRows[0].tableCollation ?? tableRows[0].TABLE_COLLATION ?? '') } : null,
    permanentIdColumn: column ? { name: String(column.columnName ?? column.COLUMN_NAME), dataType: String(column.dataType ?? column.DATA_TYPE).toLowerCase(), columnType: String(column.columnType ?? column.COLUMN_TYPE).toLowerCase(), nullable: String(column.nullable ?? column.IS_NULLABLE).toUpperCase(), maxLength, characterSet: charset, collation: String(column.collationName ?? column.COLLATION_NAME ?? '') } : null,
    indexCompatibility: { estimatedMaximumKeyBytes: indexByteLength, TiDBDefaultMaximumKeyBytes: 3072, studentsTablePartitionCount: Number(partitionRows[0]?.partitionCount ?? partitionRows[0]?.PARTITION_COUNT ?? NaN) },
    totalStudentCount: Number(idQuality.totalStudentCount ?? idQuality.TOTALSTUDENTCOUNT ?? NaN),
    nullIdCount: Number(idQuality.nullIdCount ?? idQuality.NULLIDCOUNT ?? NaN),
    emptyIdCount: Number(idQuality.emptyIdCount ?? idQuality.EMPTYIDCOUNT ?? NaN),
    malformedIdCount: Number(idQuality.malformedIdCount ?? idQuality.MALFORMEDIDCOUNT ?? NaN),
    permanentIdFormatChecked: permanentIdPattern,
    duplicateGroupCount: Number(duplicateSummary.duplicateGroupCount ?? duplicateSummary.DUPLICATEGROUPCOUNT ?? NaN),
    duplicateRowCount: Number(duplicateSummary.duplicateRowCount ?? duplicateSummary.DUPLICATEROWCOUNT ?? NaN),
    indexes: namedIndex,
    indexUsable,
    equivalentUniqueIndexes,
    ledger
  };
}

function assertSafe(snapshotValue) {
  if (snapshotValue.databaseName !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
  for (const table of ['students', 'schema_migrations']) if (!snapshotValue.tables.includes(table)) throw Object.assign(new Error(`Required table ${table} is missing.`), { code: 'MIGRATION_085_SCHEMA_PREREQUISITE_MISSING' });
  if (!snapshotValue.studentsTable || snapshotValue.studentsTable.engine.toLowerCase() !== 'innodb') throw Object.assign(new Error('The students table engine could not be verified as TiDB InnoDB.'), { code: 'MIGRATION_085_SCHEMA_PREREQUISITE_MISSING' });
  const column = snapshotValue.permanentIdColumn;
  if (!column || column.name.toLowerCase() !== 'permanent_student_id' || column.dataType !== 'varchar' || !Number.isInteger(column.maxLength) || column.maxLength < 1 || !column.characterSet || !column.collation) throw Object.assign(new Error('The authoritative permanent student ID column definition is incompatible or incomplete.'), { code: 'MIGRATION_085_SCHEMA_PREREQUISITE_MISSING' });
  if (column.maxLength > 128) throw Object.assign(new Error('The permanent student ID column exceeds the reviewed 128-character schema contract.'), { code: 'MIGRATION_085_INDEX_INCOMPATIBLE' });
  if (snapshotValue.indexCompatibility.estimatedMaximumKeyBytes == null || snapshotValue.indexCompatibility.estimatedMaximumKeyBytes > snapshotValue.indexCompatibility.TiDBDefaultMaximumKeyBytes || snapshotValue.indexCompatibility.studentsTablePartitionCount !== 0) throw Object.assign(new Error('The permanent student ID column or students table is not compatible with the intended full-column unique index.'), { code: 'MIGRATION_085_INDEX_INCOMPATIBLE' });
  if (!Number.isSafeInteger(snapshotValue.duplicateGroupCount) || snapshotValue.duplicateGroupCount !== 0) throw Object.assign(new Error('Global permanent student ID duplicates must be resolved before adding the unique index.'), { code: 'MIGRATION_085_DUPLICATE_IDS', details: { duplicateGroupCount: snapshotValue.duplicateGroupCount, duplicateRowCount: snapshotValue.duplicateRowCount } });
  if (snapshotValue.indexes.length && (snapshotValue.indexes.some((index) => index.nonUnique !== 0 || index.columnName !== 'permanent_student_id' || index.sequence !== 1 || index.subPart != null) || snapshotValue.indexes.length !== 1)) throw Object.assign(new Error('The global permanent student ID index name is already used by an incompatible index.'), { code: 'MIGRATION_085_INDEX_INCOMPATIBLE' });
  if (snapshotValue.equivalentUniqueIndexes.length) throw Object.assign(new Error('An equivalent global unique permanent student ID index already exists under a different name; review the existing index before proceeding.'), { code: 'MIGRATION_085_EQUIVALENT_INDEX_EXISTS', details: { indexNames: snapshotValue.equivalentUniqueIndexes } });
  if (snapshotValue.indexes.length && !snapshotValue.indexUsable) throw Object.assign(new Error('The named global permanent student ID index is not usable by TiDB.'), { code: 'MIGRATION_085_INDEX_INCOMPATIBLE' });
}

export async function runGlobalStudentIdUniqueMigration085({ adapter, mode = 'dry-run', executionToken, backupConfirmation, migrationDirectory = directory, baselineRequired = true } = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use dry-run or apply.');
  if (!adapter?.query || !adapter?.close) throw new Error('A closable production TiDB adapter is required.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) throw new Error('Explicit Migration 085 apply authorization is required.');
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') throw new Error('A recent recoverable backup confirmation is required.');
  const migrations = await discoverMigrations(migrationDirectory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) throw new Error('Migration 085 definition is unavailable or mismatched.');
  const sql = await readFile(new URL(`../schema/${NAME}`, import.meta.url), 'utf8');
  if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('Migration 085 checksum mismatch.');
  if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) throw new Error('Migration 085 is destructive.');
  const preflight = await snapshot(adapter);
  assertSafe(preflight);
  if (preflight.ledger.some((item) => Number(item.version) === VERSION) && !preflight.indexes.length) throw Object.assign(new Error('Migration 085 is recorded as applied but its global unique index is missing.'), { code: 'MIGRATION_085_LEDGER_SCHEMA_MISMATCH' });
  const runner = createMigrationRunner({ adapter, directory: migrationDirectory, baselineRequired });
  const plan = await runner.applyVersions({ versions: [VERSION], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database: preflight.databaseName, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, preflight: { ...preflight, ledger: undefined }, plan, productionWrites: 'NONE' };
  const result = await runner.applyVersions({ versions: [VERSION], verifyMigration: async ({ adapter: transaction }) => assertSafe(await snapshot(transaction, { readiness: { ready: true, engine: preflight.engine, database: preflight.databaseName, serverVersion: preflight.serverVersion } })) });
  const after = await snapshot(adapter);
  assertSafe(after);
  if (!after.indexes.length) throw Object.assign(new Error('Migration 085 did not create the global unique index.'), { code: 'MIGRATION_085_INDEX_VERIFICATION_FAILED' });
  if (!after.ledger.some((item) => Number(item.version) === VERSION && item.name === NAME && item.checksum === migration.checksum)) throw Object.assign(new Error('Migration 085 ledger record was not verified.'), { code: 'MIGRATION_085_LEDGER_VERIFICATION_FAILED' });
  return { ok: true, mode, database: after.databaseName, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, preflight: { ...preflight, ledger: undefined }, after: { ...after, ledger: undefined }, result, productionWrites: result.applied.length ? 'MIGRATION_085_ONLY' : 'NONE_ALREADY_APPLIED' };
}

async function main() {
  if (String(process.env.OSAAH_DATABASE_ADAPTER ?? '').trim().toLowerCase() !== 'tidb') throw Object.assign(new Error('Production Migration 085 requires explicit TiDB selection.'), { code: 'TIDB_SELECTION_REQUIRED' });
  if (String(process.env.TIDB_SSL_REJECT_UNAUTHORIZED ?? '').trim().toLowerCase() === 'false') throw Object.assign(new Error('TiDB TLS certificate verification cannot be disabled.'), { code: 'DATABASE_TLS_VERIFICATION_REQUIRED' });
  const adapter = createDatabaseAdapter({ environment: process.env });
  try { return await runGlobalStudentIdUniqueMigration085({ adapter, mode: process.argv[2] ?? 'dry-run', executionToken: process.env.EXECUTION_TOKEN, backupConfirmation: process.env.BACKUP_CONFIRMATION }); }
  finally { await adapter.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`); process.exitCode = 1; }
}
