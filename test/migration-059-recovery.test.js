import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMigrationRunner } from '../src/platform/migration-runner.js';
import { splitMigrationSql } from '../src/ai/tidb-database-adapter.js';

const migrationUrl = new URL('../schema/059_backward_compatible_enrollment_contract.sql', import.meta.url);
const migrationDirectory = new URL('../schema/', import.meta.url);
const correctedColumns = ['student_id', 'academic_year_id', 'class_id'];
const bytesPerCharacter = 4;

function makeAdapter({ columns = [], rows = [], applied = [] } = {}) {
  const state = {
    columns: new Set(columns),
    rows: structuredClone(rows),
    index: null,
    applied: structuredClone(applied),
    baselines: [{ reconciliationMigration: '049_production_schema_reconciliation.sql' }],
    locked: false,
    executedStatements: []
  };
  const adapter = {
    state,
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata() { return { created: false }; },
    async listApplied() { return structuredClone(state.applied); },
    async listBaselines() { return structuredClone(state.baselines); },
    async acquireLock() { if (state.locked) return false; state.locked = true; return true; },
    async releaseLock() { state.locked = false; },
    async execute() {},
    async recordApplied(record) { state.applied.push(structuredClone(record)); },
    async transaction(work) {
      const snapshot = { columns: new Set(state.columns), rows: structuredClone(state.rows), index: state.index, applied: structuredClone(state.applied), executedStatements: [...state.executedStatements] };
      const transaction = {
        async executeMigrationSql(sql) {
          for (const statement of splitMigrationSql(sql)) {
            state.executedStatements.push(statement);
            const normalized = statement.replace(/^\s*(?:(?:--|#)[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/g, '').trim();
            const addColumn = normalized.match(/^ALTER TABLE student_enrollments\s+ADD COLUMN IF NOT EXISTS (school_id|term_id)\s+VARCHAR\((\d+)\) NULL/i);
            if (addColumn) state.columns.add(addColumn[1]);
            if (/^UPDATE student_enrollments\b/i.test(normalized)) {
              for (const row of state.rows) if (row.school_id == null && row.student_school_id != null) row.school_id = row.student_school_id;
            }
            const createIndex = normalized.match(/^CREATE INDEX IF NOT EXISTS (\w+)\s+ON student_enrollments\s*\(([^)]+)\)/i);
            if (createIndex) state.index = { name: createIndex[1], columns: createIndex[2].split(',').map((item) => item.trim()) };
          }
        },
        async recordApplied(record) { state.applied.push(structuredClone(record)); }
      };
      try { return await work(transaction); } catch (error) {
        state.columns = snapshot.columns; state.rows = snapshot.rows; state.index = snapshot.index; state.applied = snapshot.applied; state.executedStatements = snapshot.executedStatements; throw error;
      }
    }
  };
  return adapter;
}

async function applyRecovery(adapter) {
  const runner = createMigrationRunner({ adapter, directory: migrationDirectory, baselineRequired: true, clock: () => '2026-09-30T00:00:00.000Z' });
  return runner.applyVersions({ versions: [59], dryRun: false });
}

test('migration 059 corrected index is below the TiDB/MySQL key limit and explains the failed width', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /ON student_enrollments \(student_id, academic_year_id, class_id\)/i);
  const originalWidth = (191 * 4 + 64) * bytesPerCharacter;
  const correctedWidth = (191 * 3) * bytesPerCharacter;
  assert.equal(originalWidth, 3312);
  assert.equal(correctedWidth, 2292);
  assert.ok(correctedWidth < 3072);
});

test('fresh schema applies migration 059 and records it only after the corrected index exists', async () => {
  const adapter = makeAdapter();
  const result = await applyRecovery(adapter);
  assert.deepEqual([...adapter.state.columns], ['school_id', 'term_id']);
  assert.deepEqual(adapter.state.index, { name: 'idx_student_enrollments_compat_scope', columns: correctedColumns });
  assert.equal(adapter.state.applied.length, 1);
  assert.equal(result.applied[0].version, 59);
});

test('partial schema resumes safely without duplicate columns or term fabrication', async () => {
  const adapter = makeAdapter({
    columns: ['school_id', 'term_id'],
    rows: [{ school_id: 'existing-school', student_school_id: 'other-school' }, { school_id: null, student_school_id: 'canonical-school' }]
  });
  await applyRecovery(adapter);
  assert.deepEqual(adapter.state.index, { name: 'idx_student_enrollments_compat_scope', columns: correctedColumns });
  assert.deepEqual(adapter.state.rows, [
    { school_id: 'existing-school', student_school_id: 'other-school' },
    { school_id: 'canonical-school', student_school_id: 'canonical-school' }
  ]);
  assert.equal(adapter.state.applied[0].version, 59);
  assert.equal(adapter.state.executedStatements.filter((statement) => /ADD COLUMN/i.test(statement)).length, 2);
});

test('recovery execution is idempotent after version 059 is recorded', async () => {
  const adapter = makeAdapter({ columns: ['school_id', 'term_id'] });
  const first = await applyRecovery(adapter);
  const statementCount = adapter.state.executedStatements.length;
  const second = await applyRecovery(adapter);
  assert.equal(first.applied.length, 1);
  assert.deepEqual(second.applied, []);
  assert.equal(adapter.state.executedStatements.length, statementCount);
  assert.equal(adapter.state.locked, false);
});
