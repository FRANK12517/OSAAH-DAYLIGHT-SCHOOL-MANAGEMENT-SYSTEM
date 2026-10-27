import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { checkAuthenticationDatabaseHealth, createApp } from '../src/server.mjs';

const SESSION_QUERY = 'SELECT id, user_id, school_id, token_hash, created_at, expires_at, revoked_at, last_used_at FROM auth_sessions LIMIT 0';

function get(server, path) {
  return new Promise((resolve, reject) => {
    httpRequest({ port: server.address().port, path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject).end();
  });
}

test('authentication health check verifies the durable session columns after database connectivity', async () => {
  const statements = [];
  const database = {
    supportsDurableAuthSessions: true,
    async query(sql) { statements.push(sql); return []; }
  };

  assert.deepEqual(await checkAuthenticationDatabaseHealth(database), { db: 'up', sessionStore: 'up' });
  assert.deepEqual(statements, ['SELECT 1', SESSION_QUERY]);
});

test('authentication health endpoint reports session-store failure without exposing driver details', async () => {
  const database = {
    supportsDurableAuthSessions: true,
    async query(sql) {
      if (sql === SESSION_QUERY) throw Object.assign(new Error('private connection detail'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
      return [];
    }
  };
  const logged = [];
  const previousError = console.error;
  console.error = (...args) => logged.push(args);
  const server = createServer(createApp({ database }));
  try {
    await new Promise((resolve) => server.listen(0, resolve));
    const response = await get(server, '/api/health');
    assert.equal(response.status, 503);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.equal(body.db, 'up');
    assert.equal(body.sessionStore, 'down');
    assert.equal(typeof body.latencyMs, 'number');
    assert.equal(Object.hasOwn(body, 'sessionErrorCode'), false);
    assert.doesNotMatch(response.body, /ER_TABLEACCESS_DENIED_ERROR|private connection detail/);
    assert.deepEqual(logged.at(-1), ['Authentication health check failed', {
      component: 'application_database', operation: 'session_store_check', code: 'ER_TABLEACCESS_DENIED_ERROR'
    }]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    console.error = previousError;
  }
});
