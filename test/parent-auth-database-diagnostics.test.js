import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

function request(server, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('Parent phone-only authentication is denied before any identity lookup', async () => {
  let calls = 0;
  const auth = createAuthService({ database: { async query() { calls += 1; return []; } } });
  const result = await auth.loginByPhoneFromDatabase({ phone: '0241234567' });
  assert.equal(calls, 0);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'Unable to sign in. Check the phone number or contact the school.');
});

test('Parent database lookup failure is logged with safe correlation metadata and returns generic 503', async () => {
  const logs = [];
  let queryCalls = 0;
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  const database = { dialect: 'tidb', supportsDurableAuthSessions: true, async query() {
    queryCalls += 1;
    throw Object.assign(new Error("permission denied for table users; phone=0241234567 password=do-not-log"), {
      code: '42501', severity: 'ERROR', schema: 'public', table: 'users',
      detail: 'Failing row contains (parent name, 0241234567, private-data)',
      hint: 'token=do-not-log-this', where: "SQL with 'do-not-log-this'", query: 'SELECT with bound parameters',
      parameters: ['0241234567', 'do-not-log-this']
    });
  }, async transaction(callback) { return callback(this); }, async execute() { return { affectedRows: 1 }; } };
  const auth = createAuthService({ database, sessionSecret: '01234567890123456789012345678901' });
  const parentSmsAuth = { async requestCode() { return { status: 202, body: { challengeId: 'challenge', message: 'If eligible, a code may arrive.' } }; }, async verifyCode() { return { ok: true, identity: { phone: '+233241234567', parentUserId: 'parent-1', schoolId: 'school-1' } }; } };
  const server = createServer(createApp({ auth, database, parentSmsAuth, aiEnabled: false }));
  try {
    await new Promise((resolve) => server.listen(0, resolve));
    const response = await request(server, '/api/auth/parent/verify-code', { phone: '0241234567', challengeId: 'challenge', code: 'private-code' }, { 'x-request-id': 'parent-req-42' });
    assert.equal(response.status, 503);
    assert.equal(queryCalls, 1, 'a database error must not retry with a less restrictive Parent link query');
    assert.deepEqual(response.body, { error: 'Authentication service unavailable.' });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'Parent database authentication query failed');
    const diagnostic = logs[0][1];
    assert.match(diagnostic.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(diagnostic.requestPath, '/api/auth/parent/verify-code');
    assert.equal(diagnostic.component, 'parent_authentication');
    assert.equal(diagnostic.operation, 'login_lookup');
    assert.equal(diagnostic.sqlState, '42501');
    assert.equal(diagnostic.severity, 'ERROR');
    assert.equal(diagnostic.schema, 'public');
    assert.equal(diagnostic.table, 'users');
    assert.ok(diagnostic.detail);
    assert.ok(diagnostic.hint);
    assert.ok(diagnostic.context);
    const output = JSON.stringify({ logs, response });
    for (const value of ['0241234567', 'do-not-log', 'private-data', 'private-code', 'parent name', 'SELECT with bound parameters']) assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(diagnostic.query, undefined);
    assert.equal(diagnostic.parameters, undefined);
  } finally {
    console.error = originalError;
    await new Promise((resolve) => server.close(resolve));
  }
});
