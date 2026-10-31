import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService, SCHOOL_PORTAL_DASHBOARDS } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { inspectDatabaseConfiguration, loadConfiguredDatabaseAdapter } from '../src/ai/durable-stores.js';
import { TIDB_READINESS_DATABASE, validateTiDBReadinessPreconditions, verifyTiDBTarget } from '../src/ai/tidb-readiness.js';

const APPROVAL_VARIABLE = 'OSAAH_TIDB_AUTH_INTEGRATION_APPROVAL';
const APPROVAL_VALUE = 'DEDICATED_DISPOSABLE_AUTH_DATABASE_APPROVED';
const ROLE_KEYS = ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'TEACHER', 'ADMISSIONS_OFFICER'];
const testEnabled = process.env[APPROVAL_VARIABLE] === APPROVAL_VALUE;

function request(server, pathname, { method = 'GET', cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({
      hostname: '127.0.0.1', port: server.address().port, path: pathname, method,
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(bodyText ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyText) } : {}) }
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text, headers: response.headers }));
    });
    req.on('error', reject);
    req.end(bodyText);
  });
}

function safeJson(response) {
  try { return JSON.parse(response.text); }
  catch { throw new Error('Integration endpoint returned a non-JSON response.'); }
}

function parseStaffFixtures(environment) {
  let fixtures;
  try { fixtures = JSON.parse(environment.OSAAH_TIDB_TEST_STAFF_CREDENTIALS_JSON ?? ''); }
  catch { throw new Error('OSAAH_TIDB_TEST_STAFF_CREDENTIALS_JSON is missing or malformed.'); }
  if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) throw new Error('Staff fixture credentials must be a role-keyed JSON object.');
  for (const roleKey of ROLE_KEYS) {
    const item = fixtures[roleKey];
    if (!item || typeof item.username !== 'string' || !item.username.trim() || typeof item.password !== 'string' || !item.password) {
      throw new Error(`A pre-provisioned ${roleKey} test account is required.`);
    }
  }
  return fixtures;
}

function parseParentStudentIds(environment) {
  const ids = String(environment.OSAAH_TIDB_TEST_PARENT_PERMANENT_STUDENT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new Error('Provide school-confirmed permanent student IDs linked to the dedicated Parent test account.');
  if (!environment.OSAAH_TIDB_TEST_PARENT_PHONE) throw new Error('Provide the registered phone for the dedicated Parent test account.');
  if (!environment.OSAAH_TIDB_TEST_UNLINKED_PERMANENT_STUDENT_ID) throw new Error('Provide a school-confirmed, same-school but unlinked test student ID for access-denial verification.');
  if (ids.includes(environment.OSAAH_TIDB_TEST_UNLINKED_PERMANENT_STUDENT_ID)) throw new Error('The access-denial student must not be in the Parent test relationship list.');
  return ids;
}

test('approved isolated TiDB authentication integration: staff roles, Parent phone login, durable sessions, dashboard authorization, and logout', { skip: !testEnabled }, async () => {
  const environment = process.env;
  const preconditionFailure = validateTiDBReadinessPreconditions({ environment });
  assert.equal(preconditionFailure, null, 'TiDB isolation and selection safeguards must pass before connecting.');
  assert.notEqual(environment.NODE_ENV, 'production');
  assert.notEqual(environment.VERCEL_ENV, 'production');
  assert.ok(environment.OSAAH_SESSION_SECRET && environment.OSAAH_SESSION_SECRET.length >= 32, 'A test-only session secret is required.');
  const staffFixtures = parseStaffFixtures(environment);
  const expectedParentStudents = parseParentStudentIds(environment).sort();

  const configuration = await inspectDatabaseConfiguration({ environment });
  assert.equal(configuration.configurationStatus, 'CONFIGURATION_VALID');
  assert.equal(configuration.selectedAdapter, 'tidb');
  assert.equal(configuration.selectedDatabase, TIDB_READINESS_DATABASE);
  assert.equal(configuration.conflicts.length, 0);

  let database;
  let server;
  const sessionCookies = [];
  try {
    database = await loadConfiguredDatabaseAdapter({ environment, required: true });
    const readiness = await verifyTiDBTarget({ database, environment });
    assert.equal(readiness.status, 'READY_FOR_AUTHENTICATION_TESTS', 'The real TiDB schema readiness check must pass before authentication requests.');

    const auth = createAuthService({ users: [], database, sessionSecret: environment.OSAAH_SESSION_SECRET });
    server = createServer(createApp({ auth, database, aiEnabled: false }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    for (const roleKey of ROLE_KEYS) {
      const login = await request(server, '/api/auth/login', {
        method: 'POST', body: { portal: 'school', role: roleKey, username: staffFixtures[roleKey].username, password: staffFixtures[roleKey].password }
      });
      assert.equal(login.status, 200, `The pre-provisioned ${roleKey} fixture must authenticate.`);
      const loginBody = safeJson(login);
      assert.equal(loginBody.user.roleKey, roleKey);
      assert.equal(loginBody.redirectTo, SCHOOL_PORTAL_DASHBOARDS[roleKey]);
      const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
      assert.ok(cookie, 'Successful authentication must issue the server session cookie.');
      sessionCookies.push(cookie);

      const secondInstance = createAuthService({ users: [], database, sessionSecret: environment.OSAAH_SESSION_SECRET });
      const restored = await secondInstance.authenticateAsync(cookie.slice('osaah_session='.length));
      assert.equal(restored?.roleKey, roleKey, `The durable session must restore the ${roleKey} identity.`);

      const dashboard = await request(server, loginBody.redirectTo, { cookie, headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(dashboard.status, 200, `The ${roleKey} dashboard route must be authorized.`);
      const parentApi = await request(server, '/api/parent/children', { cookie });
      assert.equal(parentApi.status, 403, 'Staff sessions must not access the Parent children API.');
      const logout = await request(server, '/api/auth/logout', { method: 'POST', cookie });
      assert.equal(logout.status, 204);
      const loggedOutSession = await request(server, '/api/auth/session', { cookie });
      assert.equal(loggedOutSession.status, 401, 'Staff logout must revoke the durable session.');
    }

    const unauthenticatedChildren = await request(server, '/api/parent/children');
    assert.equal(unauthenticatedChildren.status, 401);

    const codeRequest = await request(server, '/api/auth/parent/request-code', {
      method: 'POST', body: { phone: environment.OSAAH_TIDB_TEST_PARENT_PHONE }
    });
    assert.equal(codeRequest.status, 202, 'The pre-provisioned Parent OTP request must use the configured provider.');
    const deliveredCode = typeof process.env.OSAAH_TIDB_TEST_PARENT_OTP_CODE === 'string' ? process.env.OSAAH_TIDB_TEST_PARENT_OTP_CODE : '';
    assert.match(deliveredCode, /^\d{6}$/, 'Supply the disposable test account OTP through the approved secure environment.');
    const parentLogin = await request(server, '/api/auth/parent/verify-code', {
      method: 'POST', body: { phone: environment.OSAAH_TIDB_TEST_PARENT_PHONE, challengeId: safeJson(codeRequest).challengeId, code: deliveredCode }
    });
    assert.equal(parentLogin.status, 200, 'The pre-provisioned Parent test account must verify its OTP.');
    const parentBody = safeJson(parentLogin);
    assert.equal(parentBody.user.roleKey, 'PARENT');
    assert.equal(parentBody.redirectTo, '/');
    const parentCookie = parentLogin.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(parentCookie, 'Successful Parent authentication must issue a durable session cookie.');
    sessionCookies.push(parentCookie);

    const childrenResponse = await request(server, '/api/parent/children', { cookie: parentCookie });
    assert.equal(childrenResponse.status, 200);
    const actualParentStudents = safeJson(childrenResponse).children.map((child) => child.permanentStudentId).sort();
    assert.ok(JSON.stringify(actualParentStudents) === JSON.stringify(expectedParentStudents), 'Parent dashboard children must exactly match the school-approved fixture relationships.');

    const unlinkedStudent = encodeURIComponent(environment.OSAAH_TIDB_TEST_UNLINKED_PERMANENT_STUDENT_ID);
    const denied = await request(server, `/api/parent/children/resolve?permanentStudentId=${unlinkedStudent}`, { cookie: parentCookie });
    assert.equal(denied.status, 403, 'A same-school student without a Parent link must remain inaccessible.');

    const parentLogout = await request(server, '/api/auth/logout', { method: 'POST', cookie: parentCookie });
    assert.equal(parentLogout.status, 204);
    const loggedOutParentSession = await request(server, '/api/auth/session', { cookie: parentCookie });
    assert.equal(loggedOutParentSession.status, 401, 'Parent logout must revoke the durable session.');
  } finally {
    if (server?.listening) {
      for (const cookie of sessionCookies) {
        try { await request(server, '/api/auth/logout', { method: 'POST', cookie }); } catch { /* Disposable target sessions expire if cleanup cannot reach the server. */ }
      }
      await new Promise((resolve) => server.close(resolve));
    }
    try { await database?.close?.(); } catch { /* Do not emit adapter details. */ }
  }
});
