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
const safeError = (error) => ({ code: error?.code ?? 'GLOBAL_STUDENT_ID_MIGRATION_FAILED', message: error?.code ? error.message : 'Migration 085 failed safely.' });

async function snapshot(adapter) {
  const databaseName = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('students','schema_migrations')"));
  const columns = rows(await adapter.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND COLUMN_NAME='permanent_student_id'"));
  const duplicateGroupCount = Number(rows(await adapter.query('SELECT COUNT(*) AS duplicateGroupCount FROM (SELECT permanent_student_id FROM students WHERE permanent_student_id IS NOT NULL GROUP BY permanent_student_id HAVING COUNT(*)>1) duplicates'))[0]?.duplicateGroupCount ?? NaN);
  const indexes = rows(await adapter.query("SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND INDEX_NAME='uq_students_permanent_student_id_global' ORDER BY SEQ_IN_INDEX"));
  const ledger = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION]));
  return { databaseName, tables: tables.map((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase()), hasPermanentIdColumn: columns.length > 0, duplicateGroupCount, indexes: indexes.map((row) => ({ indexName: String(row.indexName ?? row.INDEX_NAME), nonUnique: Number(row.nonUnique ?? row.NON_UNIQUE), columnName: String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), sequence: Number(row.sequence ?? row.SEQ_IN_INDEX) })), ledger };
}

function assertSafe(snapshotValue) {
  if (snapshotValue.databaseName !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
  for (const table of ['students', 'schema_migrations']) if (!snapshotValue.tables.includes(table)) throw Object.assign(new Error(`Required table ${table} is missing.`), { code: 'MIGRATION_085_SCHEMA_PREREQUISITE_MISSING' });
  if (!snapshotValue.hasPermanentIdColumn) throw Object.assign(new Error('The authoritative students.permanent_student_id column is missing.'), { code: 'MIGRATION_085_SCHEMA_PREREQUISITE_MISSING' });
  if (!Number.isSafeInteger(snapshotValue.duplicateGroupCount) || snapshotValue.duplicateGroupCount !== 0) throw Object.assign(new Error('Global permanent student ID duplicates must be resolved before adding the unique index.'), { code: 'MIGRATION_085_DUPLICATE_IDS', details: { duplicateGroupCount: snapshotValue.duplicateGroupCount } });
  if (snapshotValue.indexes.length && (snapshotValue.indexes.some((index) => index.nonUnique !== 0 || index.columnName !== 'permanent_student_id' || index.sequence !== 1) || snapshotValue.indexes.length !== 1)) throw Object.assign(new Error('The global permanent student ID index name is already used by an incompatible index.'), { code: 'MIGRATION_085_INDEX_INCOMPATIBLE' });
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
  const result = await runner.applyVersions({ versions: [VERSION], verifyMigration: async ({ adapter: transaction }) => assertSafe(await snapshot(transaction)) });
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
