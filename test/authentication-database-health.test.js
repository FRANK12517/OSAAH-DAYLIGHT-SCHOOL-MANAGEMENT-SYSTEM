import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAuthenticationDatabaseHealth } from '../src/server.mjs';

test('health checks the shared adapter database and unqualified durable session table', async () => {
  const queries = [];
  const health = await checkAuthenticationDatabaseHealth({
    supportsDurableAuthSessions: true,
    async query(sql) { queries.push(sql); return []; }
  });
  assert.deepEqual(queries, ['SELECT 1', 'SELECT id FROM auth_sessions LIMIT 0']);
  assert.deepEqual(health, { db: 'up', sessionStore: 'up' });
});

test('health reports a missing session store as unavailable without exposing database details', async () => {
  const health = await checkAuthenticationDatabaseHealth({
    supportsDurableAuthSessions: true,
    async query(sql) {
      if (sql.includes('auth_sessions')) throw Object.assign(new Error('private SQL detail'), { code: 'ER_NO_SUCH_TABLE' });
      return [];
    }
  });
  assert.deepEqual(health, { db: 'up', sessionStore: 'down', sessionErrorCode: 'ER_NO_SUCH_TABLE' });
});

test('health does not report ready when database or durable-session capability is unavailable', async () => {
  assert.deepEqual(await checkAuthenticationDatabaseHealth({
    supportsDurableAuthSessions: true,
    async query() { throw Object.assign(new Error('private connection detail'), { code: 'ENOTFOUND' }); }
  }), { db: 'down', sessionStore: 'down', databaseErrorCode: 'ENOTFOUND' });
  assert.deepEqual(await checkAuthenticationDatabaseHealth({ async query() { return []; } }), { db: 'up', sessionStore: 'unsupported' });
});