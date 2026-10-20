import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

const sessionSecret = 'parent-session-diagnostics-test-secret-0123456789';
const requestContext = { requestId: 'vercel-req-42::iad1::abc', requestPath: '/api/auth/login' };

test('parent durable-session insertion failure is logged with request correlation and safe database codes', async () => {
  const logs = [];
  const originalError = console.error;
  const insertionError = Object.assign(
    new Error('permission denied for table auth_sessions; phone=0241234567 password=never-log-this'),
    { code: '42501', sqlState: '42501', table: 'auth_sessions', parameters: ['never-log-this'] }
  );
  console.error = (...args) => logs.push(args);
  const database = {
    supportsDurableAuthSessions: true,
    async query() { return [{ id: 'parent-1', schoolId: 'school-1', username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', parentPhone: '0241234567' }]; },
    async execute(sql) {
      assert.match(sql, /^INSERT INTO auth_sessions/);
      throw insertionError;
    }
  };

  try {
    const auth = createAuthService({ database, sessionSecret });
    await assert.rejects(auth.loginByPhoneFromDatabase({ phone: '0241234567', diagnosticContext: requestContext }), (error) => error === insertionError);

    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'Durable authentication session persistence failed');
    assert.deepEqual(logs[0][1], {
      component: 'school_authentication',
      operation: 'session_persist',
      category: 'AUTH_SESSION_STORE_FAILED',
      requestId: requestContext.requestId,
      requestPath: requestContext.requestPath,
      errorName: 'Error',
      databaseCode: '42501',
      sqlState: '42501'
    });
    assert.doesNotMatch(JSON.stringify(logs), /0241234567|parent@example\.test|never-log-this|auth_sessions/);
  } finally {
    console.error = originalError;
  }
});

test('parent durable-session diagnostics omit invalid codes and request identifiers', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  const database = {
    supportsDurableAuthSessions: true,
    async query() { return [{ id: 'parent-1', schoolId: 'school-1', username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', parentPhone: '0241234567' }]; },
    async execute() { throw Object.assign(new Error('private details'), { code: 'bad code; secret=value', sqlState: 'not-a-state' }); }
  };

  try {
    const auth = createAuthService({ database, sessionSecret });
    await assert.rejects(auth.loginByPhoneFromDatabase({ phone: '0241234567', diagnosticContext: { requestId: 'bad id', requestPath: '/elsewhere' } }));
    assert.deepEqual(logs[0][1], {
      component: 'school_authentication',
      operation: 'session_persist',
      category: 'AUTH_SESSION_STORE_FAILED',
      requestId: null,
      requestPath: null,
      errorName: 'Error',
      databaseCode: null,
      sqlState: null
    });
    assert.doesNotMatch(JSON.stringify(logs), /private details|bad code|secret=value/);
  } finally {
    console.error = originalError;
  }
});

test('successful parent login persists a durable session and supports session validation', async () => {
  const statements = [];
  const loginRows = [{ id: 'parent-1', schoolId: 'school-1', username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', parentPhone: '0241234567' }];
  const database = {
    supportsDurableAuthSessions: true,
    async query(sql) {
      if (sql.includes('FROM auth_sessions s')) {
        return [{ sessionId: statements[0].values[0], userId: 'parent-1', schoolId: 'school-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', roleKey: 'PARENT', permissionKey: 'children.read' }];
      }
      return loginRows;
    },
    async execute(sql, values) { statements.push({ sql, values }); return { rowCount: 1 }; }
  };
  const auth = createAuthService({ database, sessionSecret });
  const result = await auth.loginByPhoneFromDatabase({ phone: '0241234567', diagnosticContext: requestContext });

  assert.equal(result.ok, true);
  assert.equal(result.user.portal, 'parent');
  assert.equal(result.user.roleKey, 'PARENT');
  assert.ok(result.token);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /^INSERT INTO auth_sessions/);
  assert.match(statements[0].values[3], /^[a-f0-9]{64}$/);

  const restored = await auth.authenticateAsync(result.token);
  assert.equal(restored.id, 'parent-1');
  assert.equal(restored.roleKey, 'PARENT');
  assert.equal(restored.permissions.has('children.read'), true);
  assert.match(statements[1].sql, /^UPDATE auth_sessions SET last_used_at/);
  assert.equal(loginRows.length, 1);
});
