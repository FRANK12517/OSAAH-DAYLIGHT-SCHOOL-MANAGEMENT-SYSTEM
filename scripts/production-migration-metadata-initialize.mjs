import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

const DATABASE = 'osaahdaylightschool';
const REQUIRED_EXISTING_TABLES = ['schema_migrations', 'schema_migration_lock', 'schema_baselines'];
const RUNS_TABLE = 'schema_migration_runs';
const METADATA_TABLES = [...REQUIRED_EXISTING_TABLES, RUNS_TABLE];
const EXPECTED_COLUMNS = [
  ['version', 'int', null, 'NO', null],
  ['name', 'varchar', null, 'NO', 255],
  ['checksum', 'char', null, 'NO', 64],
  ['state', 'enum', "enum('running','failed','completed')", 'NO', null],
  ['started_at', 'datetime', null, 'NO', null],
  ['completed_at', 'datetime', null, 'YES', null],
  ['error_code', 'varchar', null, 'YES', 80]
];

function failure(code, message) { throw Object.assign(new Error(message), { code }); }
function field(row, upper, lower = upper.toLowerCase()) { return row?.[upper] ?? row?.[lower]; }
function rows(value, label) {
  if (!Array.isArray(value)) failure('METADATA_INITIALIZATION_QUERY_FAILED', `${label} returned an invalid result.`);
  return value;
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function recordSnapshot(recordRows) {
  return fingerprint(recordRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]))));
}

async function tableNames(adapter) {
  const result = rows(await adapter.query(
    'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)',
    METADATA_TABLES
  ), 'Platform metadata table inspection');
  return result.map((row) => String(field(row, 'tableName', 'TABLE_NAME'))).sort();
}

async function tableDefinition(adapter, table) {
  const result = rows(await adapter.query(`SHOW CREATE TABLE \`${table}\``), `Definition for ${table}`);
  const definition = result[0]?.['Create Table'] ?? result[0]?.CreateTable ?? result[0]?.['Create View'];
  if (typeof definition !== 'string' || !definition) failure('METADATA_INITIALIZATION_QUERY_FAILED', `Could not verify the existing ${table} definition.`);
  return definition;
}

async function historySnapshot(adapter) {
  const ledger = rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations ORDER BY version'), 'Migration ledger inspection');
  const baselines = rows(await adapter.query('SELECT id,canonical_database AS canonicalDatabase,baseline_at AS baselineAt,repository_commit AS repositoryCommit,schema_fingerprint AS schemaFingerprint,reconciliation_migration AS reconciliationMigration,workflow_provenance AS workflowProvenance,baseline_type AS baselineType,historical_migrations_executed AS historicalMigrationsExecuted,created_at AS createdAt FROM schema_baselines ORDER BY id'), 'Baseline history inspection');
  return { ledger: recordSnapshot(ledger), ledgerCount: ledger.length, baseline: recordSnapshot(baselines), baselineCount: baselines.length };
}

async function lockState(adapter) {
  const result = rows(await adapter.query('SELECT lock_id AS lockId,locked,acquired_at AS acquiredAt FROM schema_migration_lock ORDER BY lock_id'), 'Migration lock inspection');
  if (result.length !== 1 || Number(field(result[0], 'lockId', 'lock_id')) !== 1) failure('MIGRATION_LOCK_STATE_INVALID', 'Expected the existing single migration lock row.');
  return { lockId: 1, locked: Number(field(result[0], 'locked')), acquiredAt: field(result[0], 'acquiredAt', 'acquired_at') ?? null };
}

async function verifyRunsTable(adapter) {
  const table = rows(await adapter.query(
    'SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [RUNS_TABLE]
  ), 'Migration run table inspection');
  if (table.length !== 1) failure('MIGRATION_RUN_TABLE_NOT_CREATED', 'The migration run metadata table is still missing.');

  const columnRows = rows(await adapter.query(
    'SELECT COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,CHARACTER_MAXIMUM_LENGTH AS maxLength FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
    [RUNS_TABLE]
  ), 'Migration run table columns inspection');
  const actualColumns = columnRows.map((row) => [
    String(field(row, 'columnName', 'COLUMN_NAME')).toLowerCase(),
    String(field(row, 'dataType', 'DATA_TYPE')).toLowerCase(),
    String(field(row, 'dataType', 'DATA_TYPE')).toLowerCase() === 'enum' ? String(field(row, 'columnType', 'COLUMN_TYPE')).toLowerCase() : null,
    String(field(row, 'nullable', 'IS_NULLABLE')).toUpperCase(),
    field(row, 'maxLength', 'CHARACTER_MAXIMUM_LENGTH') == null ? null : Number(field(row, 'maxLength', 'CHARACTER_MAXIMUM_LENGTH'))
  ]);
  if (JSON.stringify(actualColumns) !== JSON.stringify(EXPECTED_COLUMNS)) failure('MIGRATION_RUN_TABLE_INCOMPATIBLE', 'The migration run metadata table does not match the TiDB adapter definition.');

  const indexes = rows(await adapter.query(
    'SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',
    [RUNS_TABLE]
  ), 'Migration run table indexes inspection');
  const normalizedIndexes = indexes.map((row) => [
    String(field(row, 'indexName', 'INDEX_NAME')).toLowerCase(),
    Number(field(row, 'nonUnique', 'NON_UNIQUE')),
    String(field(row, 'columnName', 'COLUMN_NAME')).toLowerCase(),
    Number(field(row, 'sequence', 'SEQ_IN_INDEX'))
  ]);
  if (JSON.stringify(normalizedIndexes) !== JSON.stringify([['primary', 0, 'version', 1]])) failure('MIGRATION_RUN_TABLE_INCOMPATIBLE', 'The migration run metadata table primary key does not match the TiDB adapter definition.');

  const countRows = rows(await adapter.query('SELECT COUNT(*) AS runCount FROM schema_migration_runs'), 'Migration run rows inspection');
  return { engine: field(table[0], 'engine', 'ENGINE') ?? null, columns: actualColumns.length, primaryKey: 'version', runCount: Number(field(countRows[0], 'runCount', 'COUNT(*)')) };
}

export async function initializeProductionMigrationMetadata({ adapter, backupConfirmation, backupCluster, backupStatus, backupRestoreAvailable, backupCompletedAt, backupExpiresAt, now = new Date() } = {}) {
  if (backupConfirmation !== 'BACKUP_CONFIRMED') failure('BACKUP_CONFIRMATION_REQUIRED', 'A confirmed current recoverable TiDB Cloud backup is required.');
  if (backupCluster !== DATABASE || backupStatus !== 'Succeeded' || backupRestoreAvailable !== true) failure('BACKUP_NOT_VERIFIED', 'The confirmed backup must be successful, restorable, and for the canonical TiDB cluster.');
  const completedAt = Date.parse(backupCompletedAt ?? '');
  const expiresAt = Date.parse(backupExpiresAt ?? '');
  if (!Number.isFinite(completedAt) || completedAt > now.getTime()) failure('BACKUP_TIME_INVALID', 'The confirmed TiDB Cloud backup completion time is invalid or in the future.');
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt <= completedAt) failure('BACKUP_EXPIRED', 'The confirmed TiDB Cloud backup is expired or its expiry time is invalid.');
  if (!adapter?.query || !adapter?.verifyReadiness || !adapter?.ensureMetadata || !adapter?.acquireLock || !adapter?.releaseLock) failure('TIDB_ADAPTER_REQUIRED', 'The existing TiDB metadata initializer is required.');

  const readiness = await adapter.verifyReadiness();
  if (readiness?.ready !== true || readiness.engine !== 'TiDB' || readiness.database !== DATABASE) failure('DATABASE_IDENTITY_MISMATCH', 'Connected server is not the canonical production TiDB database.');
  const initialTables = await tableNames(adapter);
  for (const table of REQUIRED_EXISTING_TABLES) {
    if (!initialTables.includes(table)) failure('MIGRATION_METADATA_PREREQUISITE_MISSING', `Existing metadata prerequisite ${table} is missing; no initialization was attempted.`);
  }

  const beforeHistory = await historySnapshot(adapter);
  const beforeDefinitions = {};
  for (const table of REQUIRED_EXISTING_TABLES) beforeDefinitions[table] = await tableDefinition(adapter, table);
  const beforeLock = await lockState(adapter);
  if (beforeLock.locked !== 0 || beforeLock.acquiredAt !== null) failure('MIGRATION_LOCKED', 'The existing migration lock is not idle; no initialization was attempted.');

  if (initialTables.includes(RUNS_TABLE)) {
    const verified = await verifyRunsTable(adapter);
    return { ok: true, outcome: 'ALREADY_PRESENT', database: DATABASE, serverVersion: readiness.serverVersion, metadataTables: initialTables, migrationHistoryUnchanged: true, baselineHistoryUnchanged: true, migrationLock: 'IDLE', migrationRuns: verified, migration085Executed: false, numberedMigrationsExecuted: false, studentOrGuardianRecordsChanged: false };
  }

  if (!await adapter.acquireLock()) failure('MIGRATION_LOCKED', 'Could not acquire the existing migration lock; no initialization was attempted.');
  let released = false;
  try {
    const acquiredLock = await lockState(adapter);
    if (acquiredLock.locked !== 1) failure('MIGRATION_LOCK_STATE_INVALID', 'Migration lock acquisition could not be verified.');
    await adapter.ensureMetadata({ create: true });

    const finalTables = await tableNames(adapter);
    const newlyCreated = finalTables.filter((table) => !initialTables.includes(table));
    if (JSON.stringify(newlyCreated) !== JSON.stringify([RUNS_TABLE])) failure('UNEXPECTED_METADATA_EFFECT', 'Metadata initialization created an unexpected platform table.');
    for (const table of REQUIRED_EXISTING_TABLES) {
      if (await tableDefinition(adapter, table) !== beforeDefinitions[table]) failure('UNEXPECTED_METADATA_EFFECT', `Metadata initialization changed the existing ${table} definition.`);
    }
    const afterHistory = await historySnapshot(adapter);
    if (afterHistory.ledger !== beforeHistory.ledger || afterHistory.baseline !== beforeHistory.baseline) failure('UNEXPECTED_METADATA_EFFECT', 'Metadata initialization changed existing migration or baseline history.');
    const heldLock = await lockState(adapter);
    if (heldLock.locked !== 1) failure('MIGRATION_LOCK_STATE_INVALID', 'The migration lock was unexpectedly released during metadata initialization.');
    const migrationRuns = await verifyRunsTable(adapter);
    if (migrationRuns.runCount !== 0) failure('UNEXPECTED_METADATA_EFFECT', 'The new migration run metadata table is not empty.');

    await adapter.releaseLock();
    released = true;
    const finalLock = await lockState(adapter);
    if (finalLock.locked !== 0 || finalLock.acquiredAt !== null) failure('MIGRATION_LOCK_STATE_INVALID', 'The migration lock did not return to its idle state.');
    return {
      ok: true,
      outcome: 'INITIALIZED',
      database: DATABASE,
      serverVersion: readiness.serverVersion,
      metadataTables: finalTables,
      createdTables: newlyCreated,
      migrationHistoryUnchanged: true,
      migrationHistoryRows: beforeHistory.ledgerCount,
      baselineHistoryUnchanged: true,
      baselineRows: beforeHistory.baselineCount,
      migrationLock: 'RELEASED_IDLE',
      migrationRuns,
      migration085Executed: false,
      numberedMigrationsExecuted: false,
      studentOrGuardianRecordsChanged: false
    };
  } finally {
    if (!released) await adapter.releaseLock();
  }
}

async function main() {
  if (String(process.env.OSAAH_DATABASE_ADAPTER ?? '').trim().toLowerCase() !== 'tidb') failure('TIDB_SELECTION_REQUIRED', 'Production metadata initialization requires explicit TiDB selection.');
  if (String(process.env.TIDB_SSL_REJECT_UNAUTHORIZED ?? '').trim().toLowerCase() === 'false') failure('DATABASE_TLS_VERIFICATION_REQUIRED', 'TiDB TLS certificate verification cannot be disabled.');
  const adapter = createDatabaseAdapter({ environment: process.env });
  try {
    const result = await initializeProductionMigrationMetadata({
      adapter,
      backupConfirmation: process.env.BACKUP_CONFIRMATION,
      backupCluster: process.env.BACKUP_CLUSTER,
      backupStatus: process.env.BACKUP_STATUS,
      backupRestoreAvailable: process.env.BACKUP_RESTORE_AVAILABLE === 'true',
      backupCompletedAt: process.env.BACKUP_COMPLETED_AT,
      backupExpiresAt: process.env.BACKUP_EXPIRES_AT
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await adapter.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = /^[A-Z0-9_:-]{1,80}$/.test(String(error?.code ?? '')) ? error.code : 'METADATA_INITIALIZATION_FAILED';
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message: error.code ? error.message : 'Production metadata initialization failed safely.' } })}\n`);
    process.exitCode = 1;
  });
}
