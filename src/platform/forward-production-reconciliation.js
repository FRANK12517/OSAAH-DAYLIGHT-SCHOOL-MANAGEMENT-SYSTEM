import { discoverMigrations } from './migration-runner.js';

export const FORWARD_PRODUCTION_RECONCILIATION = Object.freeze({ version: 53, name: '053_forward_production_reconciliation.sql' });
export const EXPECTED_PRODUCTION_DATABASE = 'osaahdaylightschool';
export const REQUIRED_RECORDED_MIGRATIONS = Object.freeze([50, 51]);
export const REQUIRED_RECONCILIATION_TABLES = Object.freeze(['student_fee_receipts', 'financial_audit_history', 'auth_sessions']);

const fail = (code, message, details = undefined) => Object.assign(new Error(message), { code, details });

function validateAdapter(adapter) {
  for (const method of ['healthCheck', 'ensureMetadata', 'listApplied', 'acquireLock', 'releaseLock', 'transaction']) {
    if (typeof adapter?.[method] !== 'function') throw fail('DATABASE_ADAPTER_INVALID', `Database adapter is missing ${method}().`);
  }
  if (typeof adapter.executeMigrationSql !== 'function' && typeof adapter.execute !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql() or execute().');
  if (typeof adapter.query !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing query().');
}

async function databaseName(adapter) {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  return rows[0]?.database_name ?? null;
}

async function tableSet(adapter) {
  const rows = await adapter.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  return new Set(rows.map((row) => row.TABLE_NAME ?? row.table_name));
}

function normalizeApplied(records) {
  return records.map((record) => ({ version: Number(record.version), name: record.name, checksum: record.checksum, appliedAt: record.appliedAt ?? record.applied_at ?? null }));
}

export async function createForwardProductionReconciliationRunner({ adapter, directory, clock = () => new Date().toISOString(), expectedDatabase = EXPECTED_PRODUCTION_DATABASE } = {}) {
  validateAdapter(adapter);
  if (!directory) throw fail('MIGRATION_DIRECTORY_REQUIRED', 'Migration directory is required.');
  const discovered = await discoverMigrations(directory);
  const migration = discovered.find((item) => item.version === FORWARD_PRODUCTION_RECONCILIATION.version && item.name === FORWARD_PRODUCTION_RECONCILIATION.name);
  if (!migration) throw fail('FORWARD_RECONCILIATION_FILE_MISSING', `Required migration ${FORWARD_PRODUCTION_RECONCILIATION.name} is missing or changed in the repository.`);

  async function inspect({ requireUnlocked = true } = {}) {
    const health = await adapter.healthCheck();
    if (!health?.healthy) throw fail('DATABASE_UNAVAILABLE', 'Durable production database is unavailable.');
    await adapter.ensureMetadata({ create: false });
    const actualDatabase = await databaseName(adapter);
    if (actualDatabase !== expectedDatabase) throw fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expectedDatabase, actualDatabase });
    const lockRows = await adapter.query('SELECT lock_id, locked, acquired_at FROM schema_migration_lock WHERE lock_id = 1');
    const lock = lockRows[0] ?? null;
    if (requireUnlocked && (!lock || Number(lock.locked) !== 0)) throw fail('MIGRATION_LOCKED', 'Production migration lock is not safely unlocked.', { lock });
    const applied = normalizeApplied(await adapter.listApplied());
    const byVersion = new Map(applied.map((record) => [record.version, record]));
    if (byVersion.has(49)) throw fail('HISTORICAL_REPLAY_FORBIDDEN', 'Migration 049 is absent from the approved forward-only production path and must not be replayed.', { appliedVersions: applied.map((record) => record.version) });
    for (const version of REQUIRED_RECORDED_MIGRATIONS) {
      if (!byVersion.has(version)) throw fail('DIVERGENT_LEDGER_PRECONDITION_FAILED', `Required recorded migration ${version} is missing.`, { appliedVersions: applied.map((record) => record.version) });
      const expected = discovered.find((item) => item.version === version);
      const actual = byVersion.get(version);
      if (!expected || actual.name !== expected.name || actual.checksum !== expected.checksum) throw fail('MIGRATION_CHECKSUM_MISMATCH', `Recorded migration ${version} does not match the repository.`, { actual, expected: expected ? { version: expected.version, name: expected.name, checksum: expected.checksum } : null });
    }
    const tables = await tableSet(adapter);
    const missing = REQUIRED_RECONCILIATION_TABLES.filter((table) => !tables.has(table));
    return { database: actualDatabase, lock, applied, tables: [...tables].sort(), missing, pending: !byVersion.has(migration.version) ? [migration] : [], exactSequence: [{ version: migration.version, name: migration.name, checksum: migration.checksum }] };
  }

  async function preflight() { return inspect(); }

  async function apply({ dryRun = false } = {}) {
    const before = await inspect();
    if (dryRun) return Object.freeze({ dryRun: true, productionWrites: 'NONE', ...before, exactSequence: before.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) });
    if (!before.pending.length) {
      const missing = REQUIRED_RECONCILIATION_TABLES.filter((table) => !before.tables.includes(table));
      if (missing.length) throw fail('RECONCILIATION_LEDGER_ALREADY_RECORDED_BUT_SCHEMA_MISSING', 'Forward reconciliation is recorded but required objects are missing.', { missing });
      return Object.freeze({ dryRun: false, productionWrites: 'NONE', applied: [], final: before, exactSequence: [] });
    }
    if (!await adapter.acquireLock()) throw fail('MIGRATION_LOCKED', 'Another migration execution is already active.');
    try {
      const applied = [];
      await adapter.transaction(async (transaction) => {
        const executor = transaction?.executeMigrationSql ?? adapter.executeMigrationSql;
        if (typeof executor !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql().');
        await executor.call(transaction ?? adapter, migration.sql, { migrationName: migration.name, version: migration.version });
        const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() };
        if (typeof transaction?.recordApplied === 'function') await transaction.recordApplied(record); else await adapter.recordApplied(record);
        applied.push(record);
      });
      const final = await inspect({ requireUnlocked: false });
      const missing = REQUIRED_RECONCILIATION_TABLES.filter((table) => !final.tables.includes(table));
      if (missing.length) throw fail('FORWARD_RECONCILIATION_VERIFICATION_FAILED', 'Forward reconciliation completed without all required objects.', { missing });
      return Object.freeze({ dryRun: false, productionWrites: '053_ONLY', applied, final, exactSequence: before.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) });
    } catch (cause) {
      if (cause.code) throw cause;
      throw fail('FORWARD_RECONCILIATION_FAILED', 'Forward production reconciliation failed safely.');
    } finally { await adapter.releaseLock(); }
  }

  return Object.freeze({ preflight, apply, migration: { version: migration.version, name: migration.name, checksum: migration.checksum } });
}
