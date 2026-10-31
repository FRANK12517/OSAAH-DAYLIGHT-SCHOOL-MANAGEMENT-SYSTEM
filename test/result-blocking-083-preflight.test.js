import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightResultBlocking083, RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL, verifyResultBlocking083Statement } from '../src/platform/result-blocking-083-preflight.js';

test('083 duplicate preflight is read-only and checks the unique index scope including normalized mock label', async () => {
  let calls = 0;
  const result = await preflightResultBlocking083({ async query(sql) { calls += 1; assert.equal(sql, RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL); return []; } });
  assert.deepEqual(result, { ready: true, duplicateGroupCount: 0 });
  assert.equal(calls, 1);
  assert.match(RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL, /GROUP BY school_id, academic_year, term, class_id, result_type,[\s\S]*IFNULL\(mock_examination, ''\), student_id/);
  assert.doesNotMatch(RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
});

test('083 duplicate preflight reports actionable scopes and stops without modifying rows', async () => {
  await assert.rejects(preflightResultBlocking083({ async query() { return [{ school_id: 'school-1', academic_year: '2026', term: '1', class_id: 'class-1', result_type: 'MOCK', mock_examination_key: 'MIDTERM', student_id: 'student-1', duplicate_count: '2' }]; } }), (error) => {
    assert.equal(error.code, 'MIGRATION_083_DUPLICATE_SCOPES');
    assert.match(error.message, /reconcile rows before retrying/);
    assert.equal(error.duplicates[0].duplicateCount, 2);
    assert.equal(error.duplicates[0].studentId, 'student-1');
    return true;
  });
});

test('083 verifier reruns the duplicate preflight and checks exact unique index columns', async () => {
  const calls = [];
  const adapter = { async query(sql) {
    calls.push(sql);
    if (sql === RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL) return [];
    return ['school_id','academic_year','term','class_id','result_type','mock_examination_key','student_id'].map((columnName, index) => ({ indexName: 'uq_academic_result_block_tidb_scope', nonUnique: 0, columnName, sequence: index + 1 }));
  } };
  await verifyResultBlocking083Statement({ adapter, statement: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_result_block_tidb_scope ON academic_result_blocks (school_id, academic_year, term, class_id, result_type, mock_examination_key, student_id)', statementIndex: 2 });
  assert.deepEqual(calls, [RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL, calls[1]]);
  assert.match(calls[1], /information_schema\.STATISTICS/);
});
