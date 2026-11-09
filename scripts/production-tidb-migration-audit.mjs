import { discoverMigrations } from '../src/platform/migration-runner.js';

export const PRODUCTION_REPOSITORY = 'FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM';
export const PRODUCTION_DATABASE = 'osaahdaylightschool';
export const PRODUCTION_SCHOOL_ID = 'sch_default_01';
export const PRODUCTION_DEPLOYMENT = 'dpl_4jT69Hvt8opZbLUhXFvAk99xWkNH';

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const METADATA_TABLES = ['schema_migrations', 'schema_migration_lock', 'schema_migration_runs', 'schema_baselines'];
const PARENT_TABLES = ['parent_auth_rate_limits', 'parent_auth_challenges'];
const auditError = (code, message) => Object.assign(new Error(message), { code });
const array = (value) => Array.isArray(value) ? value : [];
const value = (row, camel, snake = camel) => row?.[camel] ?? row?.[snake];
const safeErrorCode = (input) => input == null || input === '' ? null : /^[A-Z0-9_:-]{1,80}$/.test(String(input)) ? String(input) : 'REDACTED';

export function validateReleaseIdentity({ releaseRef, checkedOutCommit, repository }) {
  const ref = String(releaseRef ?? '').trim();
  const checkedOut = String(checkedOutCommit ?? '').trim();
  if (!SHA_PATTERN.test(ref) || !SHA_PATTERN.test(checkedOut) || ref.toLowerCase() !== checkedOut.toLowerCase()) {
    throw auditError('RELEASE_COMMIT_INVALID', 'The supplied release SHA is invalid or does not match the checked out commit.');
  }
  if (repository !== PRODUCTION_REPOSITORY) {
    throw auditError('REPOSITORY_MISMATCH', 'The audit checkout is not from the approved repository.');
  }
  return ref.toLowerCase();
}

async function select(adapter, sql, parameters = [], code = 'DATABASE_QUERY_FAILED') {
  try {
    const rows = await adapter.query(sql, parameters);
    if (!Array.isArray(rows)) throw new Error('Unexpected database result.');
    return rows;
  } catch {
    throw auditError(code, 'A read-only production database query failed.');
  }
}

function normalizeMigration(row) {
  return {
    version: Number(value(row, 'version')),
    name: String(value(row, 'name') ?? ''),
    checksum: String(value(row, 'checksum') ?? '').toLowerCase(),
    appliedAt: value(row, 'appliedAt', 'applied_at') ?? null
  };
}

function normalizeRun(row) {
  return {
    version: Number(value(row, 'version')),
    name: String(value(row, 'name') ?? ''),
    checksum: String(value(row, 'checksum') ?? '').toLowerCase(),
    state: String(value(row, 'state') ?? '').toUpperCase(),
    startedAt: value(row, 'startedAt', 'started_at') ?? null,
    completedAt: value(row, 'completedAt', 'completed_at') ?? null,
    errorCode: safeErrorCode(value(row, 'errorCode', 'error_code'))
  };
}

function normalizeBaseline(row) {
  return {
    canonicalDatabase: String(value(row, 'canonicalDatabase', 'canonical_database') ?? ''),
    baselineAt: value(row, 'baselineAt', 'baseline_at') ?? null,
    repositoryCommit: String(value(row, 'repositoryCommit', 'repository_commit') ?? ''),
    schemaFingerprint: String(value(row, 'schemaFingerprint', 'schema_fingerprint') ?? ''),
    reconciliationMigration: String(value(row, 'reconciliationMigration', 'reconciliation_migration') ?? ''),
    baselineType: String(value(row, 'baselineType', 'baseline_type') ?? ''),
    historicalMigrationsExecuted: Boolean(Number(value(row, 'historicalMigrationsExecuted', 'historical_migrations_executed')))
  };
}

export async function runProductionTiDBMigrationAudit({
  adapter,
  directory,
  discoverMigrations: discover = discoverMigrations,
  releaseRef,
  checkedOutCommit,
  repository,
  deploymentReference = PRODUCTION_DEPLOYMENT
} = {}) {
  const releaseCommit = validateReleaseIdentity({ releaseRef, checkedOutCommit, repository });
  if (adapter?.dialect !== 'tidb' || typeof adapter?.verifyReadiness !== 'function' || typeof adapter?.query !== 'function') {
    throw auditError('TIDB_ADAPTER_REQUIRED', 'The audit requires the production TiDB adapter.');
  }

  let readiness;
  try { readiness = await adapter.verifyReadiness(); }
  catch { throw auditError('TIDB_CONNECTION_FAILED', 'TiDB connection or identity verification failed.'); }
  if (readiness?.ready !== true || readiness.engine !== 'TiDB' || readiness.database !== PRODUCTION_DATABASE) {
    throw auditError('DATABASE_IDENTITY_MISMATCH', 'The connected server is not the canonical TiDB production database.');
  }

  const schoolRows = await select(adapter, 'SELECT id FROM schools WHERE id=? LIMIT 2', [PRODUCTION_SCHOOL_ID], 'SCHOOL_IDENTITY_QUERY_FAILED');
  if (schoolRows.length !== 1 || String(value(schoolRows[0], 'id')) !== PRODUCTION_SCHOOL_ID) {
    throw auditError('SCHOOL_IDENTITY_MISMATCH', 'The canonical production school ID could not be verified.');
  }

  const metadataRows = await select(adapter,
    'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)',
    METADATA_TABLES,
    'MIGRATION_METADATA_QUERY_FAILED');
  const presentMetadata = new Set(metadataRows.map((row) => String(value(row, 'tableName', 'TABLE_NAME'))));
  const missingMetadata = METADATA_TABLES.filter((name) => !presentMetadata.has(name));
  if (missingMetadata.length) {
    throw auditError('MIGRATION_METADATA_MISSING', `Required migration metadata is missing: ${missingMetadata.join(', ')}. No ledger was treated as empty.`);
  }

  const migrations = await discover(directory);
  const [appliedRows, baselineRows, runRows, lockRows] = await Promise.all([
    select(adapter, 'SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations ORDER BY version ASC', [], 'MIGRATION_LEDGER_QUERY_FAILED'),
    select(adapter, 'SELECT canonical_database AS canonicalDatabase,baseline_at AS baselineAt,repository_commit AS repositoryCommit,schema_fingerprint AS schemaFingerprint,reconciliation_migration AS reconciliationMigration,baseline_type AS baselineType,historical_migrations_executed AS historicalMigrationsExecuted FROM schema_baselines ORDER BY baseline_at DESC', [], 'MIGRATION_BASELINE_QUERY_FAILED'),
    select(adapter, 'SELECT version,name,checksum,state,started_at AS startedAt,completed_at AS completedAt,error_code AS errorCode FROM schema_migration_runs ORDER BY version ASC', [], 'MIGRATION_RUN_QUERY_FAILED'),
    select(adapter, 'SELECT lock_id AS lockId,locked,acquired_at AS acquiredAt FROM schema_migration_lock ORDER BY lock_id ASC', [], 'MIGRATION_LOCK_QUERY_FAILED')
  ]);
  const [parentTableRows] = await Promise.all([
    select(adapter, 'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)', PARENT_TABLES, 'MIGRATION_082_SCHEMA_QUERY_FAILED')
  ]);

  const sourceByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const applied = appliedRows.map(normalizeMigration);
  const appliedByVersion = new Map(applied.map((record) => [record.version, record]));
  const runs = runRows.map(normalizeRun);
  const issues = [];
  for (const record of applied) {
    const source = sourceByVersion.get(record.version);
    if (!source) issues.push({ code: 'APPLIED_MIGRATION_SOURCE_MISSING', version: record.version });
    else if (source.name !== record.name || source.checksum !== record.checksum) issues.push({ code: 'MIGRATION_CHECKSUM_MISMATCH', version: record.version, name: source.name, expectedChecksum: source.checksum, recordedChecksum: record.checksum });
  }

  const baseline = baselineRows.length ? normalizeBaseline(baselineRows[0]) : null;
  if (baseline && baseline.canonicalDatabase !== PRODUCTION_DATABASE) issues.push({ code: 'BASELINE_DATABASE_MISMATCH' });
  const baselineMigration = baseline ? migrations.find((migration) => migration.name === baseline.reconciliationMigration) : null;
  if (baseline && !baselineMigration) issues.push({ code: 'BASELINE_MIGRATION_SOURCE_MISSING' });
  const baselineVersion = baselineMigration?.version ?? 0;
  const appliedVersions = new Set(applied.map((record) => record.version));
  const historicalUntracked = baselineMigration
    ? migrations.filter((migration) => migration.version < baselineVersion && !appliedVersions.has(migration.version))
    : [];
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version) && (!baselineMigration || migration.version >= baselineVersion));
  const maxApplied = applied.length ? Math.max(...applied.map((record) => record.version)) : 0;
  const gaps = pending.filter((migration) => migration.version <= maxApplied);
  if (gaps.length) issues.push({ code: 'MIGRATION_LEDGER_GAP', versions: gaps.map(({ version }) => version) });

  for (const run of runs) {
    const source = sourceByVersion.get(run.version);
    const appliedRecord = appliedByVersion.get(run.version);
    if (!source || source.name !== run.name || source.checksum !== run.checksum) {
      issues.push({ code: 'MIGRATION_RUN_SOURCE_MISMATCH', version: run.version, name: run.name });
    }
    if (run.state === 'RUNNING' || run.state === 'FAILED') issues.push({ code: 'MIGRATION_RECOVERY_REQUIRED', version: run.version, name: run.name, state: run.state });
    if (!['RUNNING', 'FAILED', 'COMPLETED'].includes(run.state)) issues.push({ code: 'MIGRATION_RUN_STATE_INVALID', version: run.version, name: run.name });
    if (run.state === 'COMPLETED' && (!appliedRecord || appliedRecord.checksum !== run.checksum || appliedRecord.name !== run.name)) {
      issues.push({ code: 'COMPLETED_RUN_LEDGER_MISMATCH', version: run.version, name: run.name });
    }
  }

  const lock = lockRows.find((row) => Number(value(row, 'lockId', 'lock_id')) === 1);
  if (!lock) issues.push({ code: 'MIGRATION_LOCK_ROW_MISSING' });
  else if (Number(value(lock, 'locked')) !== 0) issues.push({ code: 'MIGRATION_LOCK_ACTIVE' });

  const migration082 = sourceByVersion.get(82);
  if (!migration082 || migration082.name !== '082_parent_sms_auth.sql') issues.push({ code: 'MIGRATION_082_SOURCE_MISSING' });
  const applied082 = appliedByVersion.get(82);
  const pending082 = pending.find((migration) => migration.version === 82);
  const presentParentTables = new Set(parentTableRows.map((row) => String(value(row, 'tableName', 'TABLE_NAME'))));
  const existingParentTables = PARENT_TABLES.filter((name) => presentParentTables.has(name));
  let migration082Status;
  if (applied082 && existingParentTables.length === PARENT_TABLES.length && migration082?.checksum === applied082.checksum && migration082?.name === applied082.name) {
    migration082Status = 'RECORDED_APPLIED_AND_SCHEMA_PRESENT';
  } else if (!applied082 && pending082 && existingParentTables.length === 0) {
    migration082Status = 'PENDING_AND_SCHEMA_ABSENT';
  } else if (applied082 && existingParentTables.length < PARENT_TABLES.length) {
    migration082Status = 'RECORDED_APPLIED_BUT_SCHEMA_PARTIAL_OR_MISSING';
    issues.push({ code: 'MIGRATION_082_SCHEMA_INCONSISTENT', existingTables: existingParentTables });
  } else if (!applied082 && existingParentTables.length > 0) {
    migration082Status = 'SCHEMA_PRESENT_WITHOUT_LEDGER_RECORD';
    issues.push({ code: 'MIGRATION_082_SCHEMA_INCONSISTENT', existingTables: existingParentTables });
  } else if (!applied082 && !pending082) {
    migration082Status = 'NOT_APPLIED_AND_NOT_PENDING';
    issues.push({ code: 'MIGRATION_082_STATUS_INCONSISTENT' });
  } else {
    migration082Status = 'LEDGER_OR_CHECKSUM_INCONSISTENT';
    issues.push({ code: 'MIGRATION_082_STATUS_INCONSISTENT' });
  }

  return {
    status: issues.length ? 'AUDIT_BLOCKED' : 'AUDIT_COMPLETE',
    repository,
    releaseCommit,
    deploymentReference,
    database: { engine: 'TiDB', name: PRODUCTION_DATABASE, connectivity: 'VERIFIED', canonicalSchoolId: PRODUCTION_SCHOOL_ID, schoolIdMatch: true },
    baseline,
    applied,
    pending: pending.map(({ version, name, checksum }) => ({ version, name, checksum })),
    historicalUntracked: historicalUntracked.map(({ version, name, checksum }) => ({ version, name, checksum })),
    migrationRuns: runs,
    migrationLock: lock ? { locked: Number(value(lock, 'locked')) !== 0, acquiredAt: value(lock, 'acquiredAt', 'acquired_at') ?? null } : null,
    migration082: {
      status: migration082Status,
      recordedApplied: Boolean(applied082),
      pending: Boolean(pending082),
      sourceChecksumMatches: Boolean(applied082 && migration082?.name === applied082.name && migration082?.checksum === applied082.checksum),
      existingTables: existingParentTables,
      requiredTables: PARENT_TABLES
    },
    ledger: { checksumConsistent: !issues.some((item) => ['MIGRATION_CHECKSUM_MISMATCH', 'MIGRATION_RUN_SOURCE_MISMATCH', 'COMPLETED_RUN_LEDGER_MISMATCH'].includes(item.code)), gaps: gaps.map(({ version, name, checksum }) => ({ version, name, checksum })) },
    blockingIssues: issues
  };
}
