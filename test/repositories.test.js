import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseRepository, createInMemoryRepository, selectRepository } from '../src/platform/repositories.js';

const record = (id, schoolId) => ({ id, schoolId, provenance: 'PRODUCTION', name: id });

test('in-memory repository is explicit, scoped, and restart-testable', async () => {
  const storage = [record('student-1', 'school-a')];
  const first = createInMemoryRepository({ initial: storage });
  await first.insert(record('student-2', 'school-a'));
  assert.equal((await first.get('student-2', 'school-b')), null);
  assert.equal((await first.list('school-a')).length, 2);
  await assert.rejects(() => first.list(), { code: 'SCHOOL_SCOPE_REQUIRED' });
  const restarted = createInMemoryRepository({ initial: [...storage, record('student-2', 'school-a')] });
  assert.equal((await restarted.get('student-2', 'school-a')).name, 'student-2');
});

test('production selection fails closed without a durable adapter', () => {
  assert.throws(() => selectRepository({ environment: 'production', memory: { allowMemory: true } }), { code: 'DURABLE_REPOSITORY_REQUIRED' });
  assert.equal(selectRepository({ environment: 'test', memory: { allowMemory: true, initial: [] } }).durable, false);
});

test('database repository parameterizes and scopes operations', async () => {
  const calls = [], rows = [ { id: 'x', school_id: 'a', name: 'X' } ];
  const adapter = { async healthCheck() { return { healthy: true }; }, async query(sql, params) { calls.push(['query', sql, params]); return rows; }, async execute(sql, params) { calls.push(['execute', sql, params]); return { affectedRows: 1 }; }, async transaction(work) { return work(this); } };
  const repo = createDatabaseRepository({ adapter, table: 'student_profiles', serialize: (value) => ({ id: value.id, school_id: value.schoolId, name: value.name }), deserialize: (row) => ({ id: row.id, schoolId: row.school_id, name: row.name }) });
  assert.equal((await repo.get('x', 'a')).schoolId, 'a'); await repo.replace('x', 'a', record('x', 'a')); assert.ok(calls.every(([, , params]) => Array.isArray(params))); await assert.rejects(() => repo.get('x', ''), { code: 'SCHOOL_SCOPE_REQUIRED' });
});
