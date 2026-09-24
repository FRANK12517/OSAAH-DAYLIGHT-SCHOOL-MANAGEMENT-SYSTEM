import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createForwardOnlyFinanceRunner } from '../src/platform/forward-finance-migration.js';

const sql050 = 'CREATE TABLE budgets (id VARCHAR(64) NOT NULL);';
const sql051 = 'CREATE TABLE general_income (id TEXT NOT NULL); CREATE TABLE general_expenses (id TEXT NOT NULL);';

async function migrationDirectory(files = { '050_budget_management.sql': sql050, '051_income_expense_management.sql': sql051 }) {
  const directory = await mkdtemp(join(tmpdir(), 'forward-finance-'));
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(join(directory, name), sql)));
  return directory;
}

function adapterFactory({ database = 'osaahdaylightschool', tables = ['schools', 'users', 'academic_years', 'terms', 'financial_audit_history'], applied = [], baselines = [{ reconciliationMigration: '049_production_schema_reconciliation.sql' }], locked = false, failVersion = null } = {}) {
  const state = { database, tables: new Set(tables), applied: structuredClone(applied), baselines: structuredClone(baselines), locked, writes: [], executed: [] };
  const adapter = {
    state,
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata() { return { created: false }; },
    async listApplied() { return structuredClone(state.applied); },
    async listBaselines() { return structuredClone(state.baselines); },
    async acquireLock() { if (state.locked) return false; state.locked = true; return true; },
    async releaseLock() { state.locked = false; },
    async executeMigrationSql() {},
    async query(sql) {
      if (sql.includes('information_schema.TABLES')) return [...state.tables].map((TABLE_NAME) => ({ TABLE_NAME }));
      if (sql.includes('DATABASE()')) return [{ database_name: state.database }];
      if (sql.includes('schema_migration_lock')) return [{ lock_id: 1, locked: state.locked ? 1 : 0, acquired_at: null }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async transaction(work) {
      const snapshot = { tables: new Set(state.tables), applied: structuredClone(state.applied), writes: [...state.writes] };
      try { return await work({ executeMigrationSql: async (sql, context) => { if (context.version === failVersion) throw Object.assign(new Error('private database error'), { code: 'MIGRATION_STATEMENT_FAILED', details: { statementIndex: 1 } }); state.executed.push(context.version); state.writes.push(sql); if (context.version === 50) { state.tables.add('budgets'); state.tables.add('budget_items'); } if (context.version === 51) { state.tables.add('general_income'); state.tables.add('general_expenses'); } }, recordApplied: async (record) => state.applied.push(structuredClone(record)) }); } catch (error) { state.tables = snapshot.tables; state.applied = snapshot.applied; state.writes = snapshot.writes; throw error; }
    }
  };
  return adapter;
}

const names = (result) => result.exactSequence.map((item) => item.name);

test('dry-run is exact 050 then 051 and performs no writes', async () => {
  const adapter = adapterFactory();
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory: await migrationDirectory() });
  const result = await runner.apply({ dryRun: true });
  assert.deepEqual(names(result), ['050_budget_management.sql', '051_income_expense_management.sql']);
  assert.deepEqual(adapter.state.executed, []);
  assert.deepEqual(adapter.state.applied, []);
});

test('049 and arbitrary migration filenames cannot enter the allowlist', async () => {
  const directory = await migrationDirectory({ '049_production_schema_reconciliation.sql': 'SELECT 1;', ...{ '050_budget_management.sql': sql050, '051_income_expense_management.sql': sql051 }, '052_future.sql': 'SELECT 1;' });
  const runner = await createForwardOnlyFinanceRunner({ adapter: adapterFactory(), directory });
  assert.deepEqual(runner.migrations.map((item) => item.version), [50, 51]);
  assert.deepEqual(runner.migrations.map((item) => item.name), ['050_budget_management.sql', '051_income_expense_management.sql']);
});

test('wrong database fails closed before any write', async () => {
  const adapter = adapterFactory({ database: 'wrong_database' });
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory: await migrationDirectory() });
  await assert.rejects(() => runner.preflight(), (error) => error.code === 'DATABASE_TARGET_MISMATCH');
  assert.deepEqual(adapter.state.writes, []);
});

test('active lock fails closed', async () => {
  const adapter = adapterFactory({ locked: true });
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory: await migrationDirectory() });
  await assert.rejects(() => runner.preflight(), (error) => error.code === 'MIGRATION_LOCKED');
});

test('missing prerequisite contract fails closed', async () => {
  const adapter = adapterFactory({ tables: ['schools', 'users'] });
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory: await migrationDirectory() });
  await assert.rejects(() => runner.preflight(), (error) => error.code === 'PRODUCTION_CONTRACT_UNSATISFIED');
});

test('050 failure prevents 051 and releases lock', async () => {
  const adapter = adapterFactory({ failVersion: 50 });
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory: await migrationDirectory() });
  await assert.rejects(() => runner.apply(), (error) => error.code === 'MIGRATION_STATEMENT_FAILED');
  assert.deepEqual(adapter.state.executed, []);
  assert.deepEqual(adapter.state.applied, []);
  assert.equal(adapter.state.locked, false);
});

test('successful apply records truthful checksums and can be safely repeated', async () => {
  const adapter = adapterFactory();
  const directory = await migrationDirectory();
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory, clock: () => '2026-09-24T00:00:00.000Z' });
  const first = await runner.apply();
  assert.deepEqual(first.applied.map((item) => item.version), [50, 51]);
  assert.equal(adapter.state.applied.length, 2);
  assert.deepEqual(adapter.state.tables.has('general_expenses'), true);
  const second = await runner.apply();
  assert.deepEqual(second.applied, []);
  assert.equal(adapter.state.executed.length, 2);
  assert.equal(adapter.state.locked, false);
});

test('checksum mismatch for an already-applied allowlisted migration fails closed', async () => {
  const directory = await migrationDirectory();
  const adapter = adapterFactory({ applied: [{ version: 50, name: '050_budget_management.sql', checksum: '0'.repeat(64), appliedAt: '2026-09-24T00:00:00.000Z' }] });
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory });
  await assert.rejects(() => runner.preflight(), (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH');
});

test('missing migration file fails closed', async () => {
  const adapter = adapterFactory();
  const directory = await migrationDirectory({ '050_budget_management.sql': sql050 });
  await assert.rejects(() => createForwardOnlyFinanceRunner({ adapter, directory }), (error) => error.code === 'FORWARD_MIGRATION_FILE_MISSING');
});

test('migration 051 uses bounded types for keys and indexed columns', async () => {
  const sql = await readFile(new URL('../schema/051_income_expense_management.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:id|school_id|transaction_date|academic_year|term|budget_id|budget_item_id|created_by|updated_by|voided_by|created_at|updated_at|voided_at)\s+TEXT\b/);
  assert.match(sql, /id VARCHAR\(191\) PRIMARY KEY/);
  assert.match(sql, /budget_id VARCHAR\(64\).*REFERENCES budgets\(id\)/);
});
