import test from 'node:test';
import assert from 'node:assert/strict';
import { tidbInsertIfAbsent, tidbInsertOrUpdate } from '../src/tidb-conflict.js';

const duplicate = () => Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY', errno: 1062 });

test('TiDB insert-if-absent treats only a verified target-key duplicate as existing', async () => {
  const calls = [];
  const db = {
    async execute(sql) { calls.push(['execute', sql]); throw duplicate(); },
    async query(sql) { calls.push(['query', sql]); return [{ id: 'known' }]; }
  };
  assert.equal(await tidbInsertIfAbsent(db, { insertSql: 'INSERT', conflictSql: 'SELECT target' }), false);
  assert.deepEqual(calls.map(([kind]) => kind), ['execute', 'query']);
});

test('TiDB duplicate on another unique key is not swallowed', async () => {
  const db = { async execute() { throw duplicate(); }, async query() { return []; } };
  await assert.rejects(() => tidbInsertIfAbsent(db, { insertSql: 'INSERT', conflictSql: 'SELECT intended key' }), /duplicate/);
});

test('TiDB targeted upsert verifies the requested key before updating', async () => {
  const calls = [];
  const db = {
    async execute(sql) { calls.push(sql); if (sql === 'INSERT') throw duplicate(); return { affectedRows: 1 }; },
    async query(sql) { calls.push(sql); return [{ id: 1 }]; }
  };
  assert.equal(await tidbInsertOrUpdate(db, { insertSql: 'INSERT', conflictSql: 'SELECT target', updateSql: 'UPDATE' }), 'updated');
  assert.deepEqual(calls, ['INSERT', 'SELECT target', 'UPDATE']);
});

test('TiDB targeted upsert does not update on an unrelated unique-key collision', async () => {
  const calls = [];
  const db = {
    async execute(sql) { calls.push(sql); throw duplicate(); },
    async query(sql) { calls.push(sql); return []; }
  };
  await assert.rejects(() => tidbInsertOrUpdate(db, { insertSql: 'INSERT', conflictSql: 'SELECT target', updateSql: 'UPDATE' }), /duplicate/);
  assert.deepEqual(calls, ['INSERT', 'SELECT target']);
});
