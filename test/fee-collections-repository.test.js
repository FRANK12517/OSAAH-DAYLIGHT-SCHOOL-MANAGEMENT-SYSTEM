import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeCollectionsRepository } from '../src/fee-collections-repository.js';

const actor = (schoolId = 'school-a') => ({ id: 'user-1', schoolId, roleKey: 'PROPRIETOR', permissions: new Set(['*']) });

function adapter({ students = [], fees = [{ id: 'fee-1', schoolId: 'school-a' }], failOnInsert = false } = {}) {
  const state = { students: structuredClone(students), fees: structuredClone(fees), obligations: [], rollbackCount: 0 };
  return {
    state,
    async query(sql, params = []) {
      if (sql.includes('FROM fee_structures')) return state.fees.filter((f) => f.id === params[0] && f.schoolId === params[1]);
      if (sql.includes('FROM students')) {
        return state.students.filter((s) => s.schoolId === params[0] && (params[1] == null || s.classId === params[1]) && !['INACTIVE', 'TRANSFERRED_OUT', 'WITHDRAWN', 'DELETED', 'ARCHIVED'].includes(String(s.status ?? 'ACTIVE').toUpperCase()));
      }
      if (sql.includes('FROM fee_obligations') && sql.includes('idempotency_key')) return state.obligations.filter((o) => o.schoolId === params[0] && o.idempotencyKey === params[1]);
      if (sql.includes('FROM fee_obligations')) return state.obligations.filter((o) => o.schoolId === params[0]);
      return [];
    },
    async execute(sql, params = []) {
      if (failOnInsert && sql.startsWith('INSERT INTO fee_obligations')) throw new Error('persistence failed');
      if (sql.startsWith('INSERT INTO fee_obligations')) state.obligations.push({ id: params[0], schoolId: params[1], feeStructureId: params[2], studentId: params[7], idempotencyKey: params[13] });
      return { affectedRows: 1 };
    },
    async transaction(work) {
      const before = structuredClone(state.obligations);
      try { return await work(this); } catch (error) { state.obligations = before; state.rollbackCount++; throw error; }
    }
  };
}

const publish = (repo, a, extra = {}) => repo.publishFeeObligations({ feeStructureId: 'fee-1', scope: 'ALL_STUDENTS', amountMinor: 100, academicYearId: '2026', termId: '1', ...extra }, a);

test('publication is atomic and rolls back partial inserts', async () => {
  const db = adapter({ students: [{ id: 's1', schoolId: 'school-a', status: 'ACTIVE' }, { id: 's2', schoolId: 'school-a', status: 'ACTIVE' }], failOnInsert: true });
  const repo = createFeeCollectionsRepository({ adapter: db });
  await assert.rejects(() => publish(repo, actor()), /persistence failed/);
  assert.equal(db.state.rollbackCount, 1);
  assert.equal(db.state.obligations.length, 0);
});

test('repeat publication is idempotent with canonical counts', async () => {
  const db = adapter({ students: [{ id: 's1', schoolId: 'school-a', status: 'ACTIVE' }, { id: 's2', schoolId: 'school-a', status: 'ACTIVE' }] });
  const repo = createFeeCollectionsRepository({ adapter: db });
  assert.deepEqual(await publish(repo, actor()), { eligible_count: 2, created_count: 2, skipped_count: 0 });
  assert.deepEqual(await publish(repo, actor()), { eligible_count: 2, created_count: 0, skipped_count: 2 });
  assert.equal(db.state.obligations.length, 2);
});

test('eligibility is tenant-, class-, and status-scoped', async () => {
  const excluded = ['INACTIVE', 'TRANSFERRED_OUT', 'WITHDRAWN', 'DELETED', 'ARCHIVED'];
  const db = adapter({ students: [{ id: 'a1', schoolId: 'school-a', classId: 'A', status: 'ACTIVE' }, { id: 'a2', schoolId: 'school-a', classId: 'A', status: 'ACTIVE' }, { id: 'b', schoolId: 'school-a', classId: 'B', status: 'ACTIVE' }, { id: 'other', schoolId: 'school-b', classId: 'A', status: 'ACTIVE' }, ...excluded.map((status, i) => ({ id: `x${i}`, schoolId: 'school-a', classId: 'A', status }))] });
  const repo = createFeeCollectionsRepository({ adapter: db });
  const result = await publish(repo, actor(), { scope: 'SPECIFIC_CLASS', classId: 'A' });
  assert.deepEqual(result, { eligible_count: 2, created_count: 2, skipped_count: 0 });
  assert.deepEqual(db.state.obligations.map((o) => o.studentId).sort(), ['a1', 'a2']);
});

test('publication never creates obligations for another school', async () => {
  const db = adapter({ students: [{ id: 'a', schoolId: 'school-a', status: 'ACTIVE' }, { id: 'b', schoolId: 'school-b', status: 'ACTIVE' }] });
  const repo = createFeeCollectionsRepository({ adapter: db });
  await publish(repo, actor('school-a'));
  assert.deepEqual(db.state.obligations.map((o) => o.studentId), ['a']);
});

test('fee ownership and existence are tenant-safe', async () => {
  const db = adapter({ students: [{ id: 'a', schoolId: 'school-a', status: 'ACTIVE' }], fees: [{ id: 'fee-b', schoolId: 'school-b' }] });
  const repo = createFeeCollectionsRepository({ adapter: db });
  await assert.rejects(() => publish(repo, actor(), { feeStructureId: 'fee-b' }), /Fee structure not found/);
  await assert.rejects(() => publish(repo, actor(), { feeStructureId: 'missing' }), /Fee structure not found/);
  assert.equal(db.state.obligations.length, 0);
});

test('eligibility and inserts use the transaction client', async () => {
  const db = adapter({ students: [{ id: 'a', schoolId: 'school-a', status: 'ACTIVE' }] });
  const calls = [];
  const rootQuery = db.query.bind(db), rootExecute = db.execute.bind(db);
  db.query = async (...args) => { calls.push('root-query'); return rootQuery(...args); };
  db.execute = async (...args) => { calls.push('root-execute'); return rootExecute(...args); };
  const tx = { query: async (...args) => { calls.push('tx-query'); return rootQuery(...args); }, execute: async (...args) => { calls.push('tx-execute'); return rootExecute(...args); } };
  db.transaction = async (work) => work(tx);
  await publish(createFeeCollectionsRepository({ adapter: db }), actor());
  assert.deepEqual(calls, ['tx-query', 'tx-query', 'tx-query', 'tx-execute']);
});

test('unrelated database errors propagate instead of being swallowed', async () => {
  const db = adapter({ students: [{ id: 'a', schoolId: 'school-a', status: 'ACTIVE' }] });
  db.execute = async () => { throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }); };
  await assert.rejects(() => publish(createFeeCollectionsRepository({ adapter: db }), actor()), (error) => error.code === 'ER_LOCK_DEADLOCK');
});
