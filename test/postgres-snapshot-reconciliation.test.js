import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSnapshots } from '../scripts/reconcile-postgres-snapshots.mjs';

test('read-only snapshot reconciliation compares counts, keys, date conversions, aggregates and FK integrity', () => {
  const source = { metadata: { kind: 'source-fixture' }, tables: {
    students: { primaryKey: 'id', rows: [{ id: 's1', born: '2010-02-03', updated: '2026-01-01T00:00:00Z' }], dateColumns: ['born'], timestampColumns: ['updated'] },
    payments: { primaryKey: 'id', rows: [{ id: 'p1', student_id: 's1', amount: '10.25' }, { id: 'p2', student_id: 'missing', amount: '2.00' }], foreignKeys: [{ column: 'student_id', references: { table: 'students', column: 'id' } }], aggregateColumns: ['amount'] }
  } };
  const target = structuredClone(source);
  target.tables.students.rows[0].born = '2010-02-03T00:00:00.000Z';
  target.tables.students.rows[0].updated = '2025-12-31T19:00:00-05:00';
  target.tables.payments.rows[1].student_id = 's1';
  target.tables.payments.rows[1].amount = '3.00';
  const report = reconcileSnapshots(source, target);
  assert.equal(report.status, 'MISMATCH');
  assert.equal(report.tables.students.status, 'MATCH');
  assert.equal(report.tables.payments.aggregate.amount.matches, false);
  assert.equal(report.foreignKeys[0].status, 'MATCH');
  assert.equal(report.tables.payments.sourceRows, 2);
  assert.notEqual(report.tables.payments.missingTargetKeys[0], 'p1');
});

test('snapshot reconciliation reports unmatched and duplicate identifiers without exposing key values', () => {
  const source = { tables: { records: { primaryKey: 'id', rows: [{ id: 'private-source' }, { id: 'private-source' }, { id: 'missing-target' }] } } };
  const target = { tables: { records: { primaryKey: 'id', rows: [{ id: 'target-extra' }] } } };
  const report = reconcileSnapshots(source, target);
  assert.equal(report.status, 'MISMATCH');
  assert.equal(report.tables.records.duplicateSourceKeys.length, 1);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private-source|missing-target|target-extra/);
});

test('snapshot reconciliation reports absent tables', () => {
  const report = reconcileSnapshots({ tables: { child: { primaryKey: 'id', rows: [] } } }, { tables: {} });
  assert.equal(report.tables.child.status, 'MISMATCH');
  assert.equal(report.tables.child.reason, 'MISSING_TARGET_TABLE');
});
