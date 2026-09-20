import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

const schoolId = 'school-osaah-daylight';
const passwords = Object.freeze({
  accountant: 'Accountant123!',
  administrator: 'Administrator123!',
  headteacher: 'Headteacher123!',
  assistant: 'Assistant123!'
});
const accounts = [
  ['db-accountant', 'accountant@osaah.edu.gh', passwords.accountant, 'ACCOUNTANT_BURSAR', '/fees', ['fees.read', 'fees.write', 'finance.read']],
  ['db-administrator', 'administrator@osaah.edu.gh', passwords.administrator, 'SCHOOL_ADMIN', '/settings', ['users.read', 'settings.read']],
  ['db-headteacher', 'headteacher@osaah.edu.gh', passwords.headteacher, 'HEADTEACHER', '/academics', ['academics.read', 'students.read']],
  ['db-assistant', 'assistantheadteacher@osaah.edu.gh', passwords.assistant, 'ASSISTANT_HEADTEACHER', '/academics', ['academics.read', 'students.read']]
];

async function databaseFixture() {
  const rows = [];
  for (const [id, email, password, roleKey, , permissions] of accounts) {
    rows.push({ id, schoolId, username: email, email, passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE', roleKey, permissionKey: permissions[0] });
    for (const permissionKey of permissions.slice(1)) rows.push({ id, schoolId, username: email, email, passwordHash: rows.at(-1).passwordHash, status: 'ACTIVE', roleKey, permissionKey });
  }
  return { query: async (_sql, params) => rows.filter((row) => row.username.toLowerCase() === params[0] || row.email.toLowerCase() === params[1]) };
}

function http(server, path, { method = 'GET', body, cookie, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const request = httpRequest({ port: server.address().port, path, method, headers }, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

test('Part 3 database staff authentication resolves canonical role, school, dashboard, and permissions', async () => {
  const database = await databaseFixture();
  const auth = createAuthService({ database, sessionSecret: 'part-3-test-session-secret-0123456789' });
  for (const [, email, password, roleKey, dashboard, permissions] of accounts) {
    const result = await auth.loginFromDatabase({ username: email, password, portal: 'school' });
    assert.equal(result.ok, true);
    assert.equal(result.user.schoolId, schoolId);
    assert.equal(result.user.roleKey, roleKey);
    assert.equal(result.redirectTo, dashboard);
    const authenticated = auth.authenticate(result.token);
    for (const permission of permissions) assert.equal(authenticated.permissions.has(permission), true);
    assert.equal(Object.hasOwn(result.user, 'passwordHash'), false);
    assert.equal(Object.hasOwn(result.user, 'password'), false);
  }
});

test('Part 3 rejects invalid, unknown, disabled, and cross-role database credentials', async () => {
  const database = await databaseFixture();
  const auth = createAuthService({ database });
  assert.equal((await auth.loginFromDatabase({ username: accounts[0][1], password: 'wrong', portal: 'school' })).ok, false);
  assert.equal((await auth.loginFromDatabase({ username: 'missing@osaah.edu.gh', password: 'wrong', portal: 'school' })).ok, false);
  const disabled = { ...database, query: async (...args) => (await database.query(...args)).map((row) => ({ ...row, status: 'DISABLED' })) };
  assert.equal((await createAuthService({ database: disabled }).loginFromDatabase({ username: accounts[0][1], password: passwords.accountant, portal: 'school' })).ok, false);
  assert.equal((await auth.loginFromDatabase({ username: accounts[0][1], password: passwords.accountant, portal: 'school', role: 'HEADTEACHER' })).ok, false);
});

test('Part 3 uses the existing School Portal route, preserves sessions, applies RBAC, and logs out', async () => {
  const database = await databaseFixture();
  const server = createServer(createApp({ database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const login = await http(server, '/api/auth/login', { method: 'POST', body: { username: accounts[0][1], password: passwords.accountant, portal: 'school' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.roleKey, 'ACCOUNTANT_BURSAR');
    assert.equal(login.body.redirectTo, '/fees');
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const session = await http(server, '/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.roleKey, 'ACCOUNTANT_BURSAR');
    assert.equal((await http(server, '/api/management', { cookie })).status, 403);
    assert.equal((await http(server, '/api/fees/collections', { cookie })).status, 503);
    const logout = await http(server, '/api/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    assert.equal((await http(server, '/api/auth/session', { cookie })).status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Part 3 preserves Proprietor login and canonical dashboard routing', async () => {
  const auth = createAuthService();
  const result = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  assert.equal(result.ok, true);
  assert.equal(result.user.roleKey, 'PROPRIETOR');
  assert.equal(result.redirectTo, '/reports');
  assert.equal(auth.authenticate(result.token).permissions.has('*'), true);
});
