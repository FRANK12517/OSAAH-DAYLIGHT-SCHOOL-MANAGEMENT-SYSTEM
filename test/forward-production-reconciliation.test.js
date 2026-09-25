import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { createForwardProductionReconciliationRunner } from '../src/platform/forward-production-reconciliation.js';

const fixtureFiles = {
  '050_budget_management.sql': 'CREATE TABLE budgets (id VARCHAR(64) PRIMARY KEY);',
  '051_income_expense_management.sql': 'CREATE TABLE general_income (id VARCHAR(64) PRIMARY KEY);',
  '053_forward_production_reconciliation.sql': 'CREATE TABLE IF NOT EXISTS student_fee_receipts (id VARCHAR(64) PRIMARY KEY); CREATE TABLE IF NOT EXISTS financial_audit_history (id VARCHAR(64) PRIMARY KEY); CREATE TABLE IF NOT EXISTS auth_sessions (id VARCHAR(191) PRIMARY KEY);'
};

async function migrationDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'forward-reconciliation-'));
  await Promise.all(Object.entries(fixtureFiles).map(([name, sql]) => writeFile(join(directory, name), sql)));
  return directory;
}

async function adapterFactory(directory, { database = 'osaahdaylightschool', appliedVersions = [50, 51], tables = ['schools', 'users', 'academic_years', 'terms'], locked = false } = {}) {
  const discovered = await discoverMigrations(directory);
  const byVersion = new Map(discovered.map((item) => [item.version, item]));
  const applied = appliedVersions.map((version) => ({ version, name: byVersion.get(version)?.name ?? `${String(version).padStart(3, '0')}_unknown.sql`, checksum: byVersion.get(version)?.checksum ?? 'x'.repeat(64), appliedAt: '2026-09-24T00:00:00.000Z' }));
  const state = { database, tables: new Set(tables), applied, locked, executed: [], writes: [] };
  const adapter = {
    state,
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata() { return { created: false }; },
    async listApplied() { return structuredClone(state.applied); },
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
      try {
        return await work({
          executeMigrationSql: async (sql, context) => {
            state.executed.push(context.version); state.writes.push(sql);
            state.tables.add('student_fee_receipts'); state.tables.add('financial_audit_history'); state.tables.add('auth_sessions');
          },
          recordApplied: async (record) => state.applied.push(structuredClone(record))
        });
      } catch (error) { state.tables = snapshot.tables; state.applied = snapshot.applied; state.writes = snapshot.writes; throw error; }
    }
  };
  return adapter;
}

test('dry-run requires the exact divergent ledger and does not write', async () => {
  const directory = await migrationDirectory();
  const adapter = await adapterFactory(directory);
  const runner = await createForwardProductionReconciliationRunner({ adapter, directory });
  const result = await runner.apply({ dryRun: true });
  assert.equal(result.exactSequence[0].version, 53);
  assert.deepEqual(adapter.state.executed, []);
  assert.deepEqual(adapter.state.writes, []);
});

test('049 is forbidden even when 050 and 051 are present', async () => {
  const directory = await migrationDirectory();
  const adapter = await adapterFactory(directory, { appliedVersions: [49, 50, 51] });
  const runner = await createForwardProductionReconciliationRunner({ adapter, directory });
  await assert.rejects(() => runner.preflight(), (error) => error.code === 'HISTORICAL_REPLAY_FORBIDDEN');
  assert.deepEqual(adapter.state.writes, []);
});

test('apply records only 053, creates required tables, and repeats safely', async () => {
  const directory = await migrationDirectory();
  const adapter = await adapterFactory(directory);
  const runner = await createForwardProductionReconciliationRunner({ adapter, directory });
  const result = await runner.apply();
  assert.deepEqual(result.applied.map((item) => item.version), [53]);
  assert.equal(adapter.state.applied.some((item) => item.version === 49), false);
  assert.equal(adapter.state.locked, false);
  const repeated = await runner.apply();
  assert.deepEqual(repeated.applied, []);
});
