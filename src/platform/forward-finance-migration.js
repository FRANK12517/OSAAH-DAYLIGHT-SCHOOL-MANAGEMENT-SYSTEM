import { discoverMigrations } from './migration-runner.js';

export const FORWARD_FINANCE_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 50, name: '050_budget_management.sql' }),
  Object.freeze({ version: 51, name: '051_income_expense_management.sql' })
]);
export const EXPECTED_PRODUCTION_DATABASE = 'osaahdaylightschool';
// The authoritative Part 5F-E1 diagnostic classifies financial_audit_history
// as a separate historical/runtime difference, not a blocking prerequisite
// for migration 050 or the post-050 contract for migration 051.
export const REQUIRED_PRE_050_TABLES = Object.freeze(['schools', 'users', 'academic_years', 'terms']);
export const REQUIRED_POST_050_TABLES = Object.freeze(['budgets', 'budget_items']);
export const REQUIRED_POST_051_TABLES = Object.freeze(['general_income', 'general_expenses']);

const fail = (code, message, details = undefined) => Object.assign(new Error(message), { code, details });
const allowlistedNames = new Set(FORWARD_FINANCE_MIGRATIONS.map((item) => item.name));

function assertExactMigrationSet(migrations) {
  const actual = migrations.map(({ version, name }) => `${version}:${name}`);
  const expected = FORWARD_FINANCE_MIGRATIONS.map(({ version, name }) => `${version}:${name}`);
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw fail('FORWARD_MIGRATION_ALLOWLIST_MISMATCH', 'Repository forward migration set is not exactly 050 followed by 051.', { expected, actual });
  }
  if (migrations.some((migration) => migration.version < 50 || migration.version > 51 || !allowlistedNames.has(migration.name))) {
    throw fail('FORWARD_MIGRATION_ALLOWLIST_MISMATCH', 'A migration outside the fixed 050/051 allowlist was discovered.');
  }
}

function validateAdapter(adapter) {
  for (const method of ['healthCheck', 'ensureMetadata', 'listApplied', 'listBaselines', 'acquireLock', 'releaseLock', 'transaction']) {
    if (typeof adapter?.[method] !== 'function') throw fail('DATABASE_ADAPTER_INVALID', `Database adapter is missing ${method}().`);
  }
  if (typeof adapter.executeMigrationSql !== 'function' && typeof adapter.execute !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql() or execute().');
  if (typeof adapter.query !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing query().');
}

async function tableSet(adapter) {
  const rows = await adapter.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  return new Set(rows.map((row) => row.TABLE_NAME ?? row.table_name));
}

async function assertDatabaseAndContracts(adapter, { expectedDatabase = EXPECTED_PRODUCTION_DATABASE, phase = 'preflight' } = {}) {
  const databaseRows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = databaseRows[0]?.database_name;
  if (database !== expectedDatabase) throw fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expectedDatabase, actualDatabase: database ?? null });
  const tables = await tableSet(adapter);
  const required = phase === 'preflight' ? REQUIRED_PRE_050_TABLES : [...REQUIRED_PRE_050_TABLES, ...REQUIRED_POST_050_TABLES];
  const missing = required.filter((table) => !tables.has(table));
  if (missing.length) throw fail('PRODUCTION_CONTRACT_UNSATISFIED', 'Required production contract tables are missing.', { phase, missing });
  return { database, tables: [...tables].sort(), missing };
}

function normalizeApplied(records) {
  return records.map((record) => ({ version: Number(record.version), name: record.name, checksum: record.checksum, appliedAt: record.appliedAt ?? record.applied_at ?? null }));
}

export async function createForwardOnlyFinanceRunner({ adapter, directory, clock = () => new Date().toISOString(), expectedDatabase = EXPECTED_PRODUCTION_DATABASE } = {}) {
  validateAdapter(adapter);
  if (!directory) throw fail('MIGRATION_DIRECTORY_REQUIRED', 'Migration directory is required.');
  const discovered = await discoverMigrations(directory);
  const selected = FORWARD_FINANCE_MIGRATIONS.map(({ version, name }) => {
    const migration = discovered.find((item) => item.version === version && item.name === name);
    if (!migration) throw fail('FORWARD_MIGRATION_FILE_MISSING', `Required migration ${name} is missing or changed in the repository.`);
    return migration;
  });
  assertExactMigrationSet(selected);

  async function inspect({ phase = 'preflight', requireUnlocked = true } = {}) {
    const health = await adapter.healthCheck();
    if (!health?.healthy) throw fail('DATABASE_UNAVAILABLE', 'Durable production database is unavailable.');
    await adapter.ensureMetadata({ create: false });
    const contract = await assertDatabaseAndContracts(adapter, { expectedDatabase, phase });
    const lockRows = await adapter.query('SELECT lock_id, locked, acquired_at FROM schema_migration_lock WHERE lock_id = 1');
    const lock = lockRows[0] ?? null;
    if (requireUnlocked && (!lock || Number(lock.locked) !== 0)) throw fail('MIGRATION_LOCKED', 'Production migration lock is not safely unlocked.', { lock });
    const baselines = await adapter.listBaselines();
    const applied = normalizeApplied(await adapter.listApplied());
    const expectedByVersion = new Map(selected.map((item) => [item.version, item]));
    for (const record of applied) {
      const expected = expectedByVersion.get(record.version);
      if (expected && (record.name !== expected.name || record.checksum !== expected.checksum)) throw fail('MIGRATION_CHECKSUM_MISMATCH', `Applied migration ${record.version} does not match the repository.`, { record, expected: { version: expected.version, name: expected.name, checksum: expected.checksum } });
    }
    const appliedVersions = new Set(applied.map((record) => record.version));
    const pending = selected.filter((migration) => !appliedVersions.has(migration.version));
    return { database: contract.database, tables: contract.tables, lock, baselines, applied, pending, exactSequence: selected.map(({ version, name, checksum }) => ({ version, name, checksum })) };
  }

  async function preflight() { return inspect({ phase: 'preflight' }); }

  async function apply({ dryRun = false } = {}) {
    const before = await inspect({ phase: 'preflight' });
    const sequence = before.pending.map(({ version, name, checksum }) => ({ version, name, checksum }));
    if (dryRun) return Object.freeze({ dryRun: true, database: before.database, exactSequence: sequence, baselines: before.baselines, applied: before.applied });
    if (!await adapter.acquireLock()) throw fail('MIGRATION_LOCKED', 'Another migration execution is already active.');
    try {
      const applied = [];
      for (const migration of selected) {
        if (!before.pending.some((item) => item.version === migration.version)) continue;
        await adapter.transaction(async (transaction) => {
          const executor = transaction?.executeMigrationSql ?? adapter.executeMigrationSql;
          if (typeof executor !== 'function') throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql().');
          await executor.call(transaction ?? adapter, migration.sql, { migrationName: migration.name, version: migration.version });
          const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() };
          if (typeof transaction?.recordApplied === 'function') await transaction.recordApplied(record); else await adapter.recordApplied(record);
          applied.push(record);
        });
        if (migration.version === 50) await assertDatabaseAndContracts(adapter, { expectedDatabase, phase: 'post-050' });
      }
      const after = await inspect({ phase: 'post-050', requireUnlocked: false });
      const missingPost051 = REQUIRED_POST_051_TABLES.filter((table) => !after.tables.includes(table));
      if (missingPost051.length) throw fail('POST_051_SCHEMA_VERIFICATION_FAILED', 'Migration 051 completed without all expected tables.', { missingPost051 });
      return Object.freeze({ dryRun: false, database: after.database, exactSequence: sequence, applied, final: after });
    } catch (cause) {
      if (cause.code) throw cause;
      throw fail('MIGRATION_FAILED', 'Forward-only finance migration failed safely.');
    } finally { await adapter.releaseLock(); }
  }

  return Object.freeze({ preflight, apply, migrations: selected.map(({ version, name, checksum }) => ({ version, name, checksum })) });
}

export { assertExactMigrationSet };
