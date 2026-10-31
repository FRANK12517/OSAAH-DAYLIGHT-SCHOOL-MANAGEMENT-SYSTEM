import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { TEST_PARENT_PHONE, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';
import { createConfiguredTestParent, isConfiguredTestParentActor, listConfiguredTestParentRelationships } from '../src/test-parent-fixture.js';
import { createParentLoginDatabase } from './helpers/parent-login-fixture.js';

const SESSION_SECRET = 'test-only-session-secret-with-at-least-32-characters';

function request(server, path, { cookie, method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    req.on('error', reject); req.end(body ?? undefined);
  });
}

function otpService(parentUserId, phone, schoolId = 'sch_default_01') {
  return {
    async requestCode() { return { status: 202, body: { ok: true, challengeId: '00000000-0000-4000-8000-000000000001', message: 'If eligible, a code may arrive.' } }; },
    async verifyCode(input) { return input.code === '123456' && input.challengeId === '00000000-0000-4000-8000-000000000001' && input.phone === phone ? { ok: true, identity: { parentUserId, phone, schoolId } } : { ok: false, status: 401, body: { error: 'The verification code is invalid or expired.' } }; }
  };
}

async function completeParentOtp(server, phone = TEST_PARENT_PHONE) {
  const requested = await request(server, '/api/auth/parent/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
  assert.equal(requested.status, 202, requested.body);
  const challengeId = JSON.parse(requested.body).challengeId;
  return request(server, '/api/auth/parent/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: '123456', challengeId }) });
}

test('Parent authentication fails closed when durable TiDB session requirements are missing', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const auth = createAuthService({ sessionSecret: '' });
    const result = await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, portal: 'parent', verifiedOtp: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, 'Authentication service unavailable.');
    assert.equal(result.token, undefined);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('signed proprietor session survives a different serverless instance', async () => {
  const loginInstance = createAuthService({ sessionSecret: SESSION_SECRET });
  const navigationInstance = createAuthService({ sessionSecret: SESSION_SECRET });
  const login = loginInstance.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  assert.match(login.token, /^v1\./);
  assert.equal(navigationInstance.authenticate(login.token).roleKey, 'PROPRIETOR');
  assert.equal(navigationInstance.authenticate(login.token).schoolId, 'school-osaah-daylight');

  const server = createServer(createApp({ auth: navigationInstance, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cookie = `osaah_session=${login.token}`;
    for (const module of PROPRIETOR_SIDEBAR_ROUTES) {
      const shell = await request(server, module.route, { cookie, headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(shell.status, 200, `${module.moduleName} should retain the cross-instance session`);
      assert.match(shell.body, /id="dashboard"/, `${module.moduleName} direct navigation should retain the school shell`);
      const embedded = await request(server, `${module.route}?embedded=1`, { cookie, headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(embedded.status, 200, `${module.moduleName} should render inside the workspace`);
      assert.match(embedded.body, /data-current-module=/, `${module.moduleName} should identify its rendered component`);
    }
    const session = await request(server, '/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).user.roleKey, 'PROPRIETOR');
    assert.equal(JSON.parse(session.body).user.schoolId, 'school-osaah-daylight');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('database Parent phone sessions persist and restore the Parent portal identity across instances', async () => {
  const { database, persisted } = createParentLoginDatabase({ user: { id: 'parent-db-1', username: 'parent@example.test', email: 'parent@example.test', schoolId: 'school-db-1', phone: '+233240000001' } });
  const loginAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const login = await loginAuth.loginByPhoneFromDatabase({ phone: '+233240000001', verifiedOtp: true });
  assert.equal(login.ok, true);
  assert.ok(persisted.session, 'successful database Parent login must persist its session');

  const nextInstanceAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const restored = await nextInstanceAuth.authenticateAsync(login.token);
  assert.equal(restored.portal, 'parent');
  assert.equal(restored.roleKey, 'PARENT');
  assert.ok(restored.permissions.has('children.read'));
  assert.equal(restored.schoolId, 'school-db-1');
  const independentInstanceAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  assert.equal((await independentInstanceAuth.authenticateAsync(login.token)).roleKey, 'PARENT');
  await nextInstanceAuth.logoutSession(login.token);
  assert.equal(await loginAuth.authenticateAsync(login.token), null, 'the login instance must observe persistent logout');
  assert.equal(await nextInstanceAuth.authenticateAsync(login.token), null, 'the restored instance must reject the revoked token');
  assert.equal(await independentInstanceAuth.authenticateAsync(login.token), null, 'an unrelated instance must reject the database-revoked token');
});

test('controlled sample Parent session restores across serverless instances with Parent identity only', async () => {
  const user = createConfiguredTestParent('sch_default_01');
  const { database } = createParentLoginDatabase({ user });
  const loginAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const login = await loginAuth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, portal: 'parent', verifiedOtp: true });
  assert.equal(login.ok, true);
  const nextInstance = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const restored = await nextInstance.authenticateAsync(login.token);
  assert.equal(restored.id, 'user-test-parent-sample');
  assert.equal(restored.portal, 'parent');
  assert.equal(restored.children, undefined);
});

test('ambiguous duplicate Parent phone identities fail closed without selecting a sample identity', async () => {
  const sample = createConfiguredTestParent('sch_default_01');
  const row = { id: 'real-parent-1', schoolId: 'sch_default_01', username: 'real-parent@example.test', email: 'real-parent@example.test', status: 'ACTIVE', parentPhone: TEST_PARENT_PHONE, phoneMatchCount: 2 };
  const { database, persisted } = createParentLoginDatabase({ user: sample, rows: [row] });
  const auth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const login = await auth.loginByPhoneFromDatabase({ phone: '0247293733', portal: 'parent', verifiedOtp: true });
  assert.equal(login.ok, false);
  assert.equal(login.status, 401);
  assert.equal(login.token, undefined);
  assert.equal(persisted.session, null, 'ambiguous phone ownership must never create a session');
});

test('verified database Parent session restores its canonical identity while sample relationships fail closed when disabled', async () => {
  const user = createConfiguredTestParent('sch_default_01');
  const { database } = createParentLoginDatabase({ user });
  const loginAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const login = await loginAuth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, portal: 'parent', verifiedOtp: true });
  assert.equal(login.ok, true);

  const nextInstance = createAuthService({ database, sessionSecret: SESSION_SECRET, testParentSchoolId: 'sch_default_01' });
  const restored = await nextInstance.authenticateAsync(login.token);
  assert.equal(restored.schoolId, 'sch_default_01');
  assert.equal(restored.children, undefined);

  const previousFlag = process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
  process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = 'false';
  try {
    const disabledInstance = createAuthService({ database, sessionSecret: SESSION_SECRET });
    const disabledActor = await disabledInstance.authenticateAsync(login.token);
    assert.equal(disabledActor.schoolId, 'sch_default_01');
    assert.equal(isConfiguredTestParentActor(disabledActor), false);
    assert.deepEqual(listConfiguredTestParentRelationships(disabledActor.id), []);
  } finally {
    if (previousFlag === undefined) delete process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
    else process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = previousFlag;
  }
});

test('controlled sample Parent uses the canonical production school scope for login and child authorization', async () => {
  const user = createConfiguredTestParent('sch_default_01');
  const { database } = createParentLoginDatabase({ user });
  const auth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const server = createServer(createApp({ database, auth, parentSmsAuth: otpService(user.id, TEST_PARENT_PHONE), aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const login = await completeParentOtp(server);
    assert.equal(login.status, 200, login.body);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie, 'successful fixture login must establish a session cookie');

    const session = await request(server, '/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    const user = JSON.parse(session.body).user;
    assert.equal(user.id, 'user-test-parent-sample');
    assert.equal(user.schoolId, 'sch_default_01');
    assert.equal(user.children, undefined, 'sample-child authorization must not be embedded in the session');

    const children = await request(server, '/api/parent/children', { cookie });
    assert.equal(children.status, 200, children.body);
    assert.deepEqual(JSON.parse(children.body).children.map((child) => child.permanentStudentId), [...TEST_PARENT_STUDENT_IDS]);

    const resolve = await request(server, `/api/parent/children/resolve?permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(resolve.status, 200, resolve.body);
    assert.equal(JSON.parse(resolve.body).child.sampleLabel, 'SAMPLE DATA');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Parent APIs expose only linked children, canonical options, allowed records, and invalidate data on logout', async () => {
  const user = createConfiguredTestParent('sch_default_01');
  const { database } = createParentLoginDatabase({ user });
  const auth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const server = createServer(createApp({ auth, database, parentSmsAuth: otpService(user.id, TEST_PARENT_PHONE, user.schoolId), aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const login = await completeParentOtp(server);
    assert.equal(login.status, 200, login.body);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie, 'OTP verification must establish the authenticated Parent session');
    const unauthenticatedChildren = await request(server, '/api/parent/children');
    assert.equal(unauthenticatedChildren.status, 401);

    const childrenResponse = await request(server, '/api/parent/children', { cookie });
    assert.equal(childrenResponse.status, 200);
    assert.deepEqual(JSON.parse(childrenResponse.body).children.map((child) => child.permanentStudentId), [...TEST_PARENT_STUDENT_IDS]);

    const sessionResponse = await request(server, '/api/auth/session', { cookie });
    assert.equal(sessionResponse.status, 200);
    const sessionUser = JSON.parse(sessionResponse.body).user;
    assert.equal(sessionUser.children, undefined, 'parent auth responses contain stable identity, not student authorization data');
    assert.equal(sessionUser.assignedStudentIds, undefined);

    const resolve = await request(server, `/api/parent/children/resolve?permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(resolve.status, 200, resolve.body);
    const resolvedChild = JSON.parse(resolve.body).child;
    assert.equal(resolvedChild.permanentStudentId, TEST_PARENT_STUDENT_IDS[0]);
    assert.equal(resolvedChild.sampleLabel, 'SAMPLE DATA');
    assert.equal(resolvedChild.id, undefined, 'the resolver returns only safe display/context fields');
    const unrelatedChild = await request(server, '/api/parent/children/resolve?permanentStudentId=OSAAH%2F2026%2F9999', { cookie });
    assert.equal(unrelatedChild.status, 403);

    const optionsResponse = await request(server, '/api/parent/options', { cookie });
    assert.equal(optionsResponse.status, 200, optionsResponse.body);
    const options = JSON.parse(optionsResponse.body);
    assert.ok(options.academicYears.length > 0);
    assert.ok(options.terms.length > 0);
    assert.ok(options.classes.length > 0);
    assert.ok(options.recordTypes.some((item) => item.id === 'student-summary' && item.available));

    const summary = await request(server, `/api/parent/records?recordType=student-summary&permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(summary.status, 200, summary.body);
    assert.equal(JSON.parse(summary.body).student.permanentStudentId, TEST_PARENT_STUDENT_IDS[0]);

    const arbitrary = await request(server, `/api/parent/records?recordType=users&permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(arbitrary.status, 400);

    const unrelated = await request(server, '/api/parent/records?recordType=student-summary&permanentStudentId=OSAAH%2F2026%2F9999', { cookie });
    assert.equal(unrelated.status, 403);

    const logout = await request(server, '/api/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    const afterLogout = await request(server, `/api/parent/records?recordType=student-summary&permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(afterLogout.status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('logout returns every school role to the public home and keeps protected routes guarded', async () => {
  const auth = createAuthService({ sessionSecret: SESSION_SECRET });
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const headteacher = auth.registerStaff({ fullName: 'Test Headteacher', staffId: 'STAFF-LOGOUT-HEAD', primaryRole: 'TEACHER' }, { schoolId: 'school-osaah-daylight' });
  auth.changeStaffRole(headteacher.staff.id, 'HEADTEACHER', 'school-osaah-daylight');
  const assistantHeadteacher = auth.registerStaff({ fullName: 'Test Assistant Headteacher', staffId: 'STAFF-LOGOUT-ASSISTANT', primaryRole: 'TEACHER' }, { schoolId: 'school-osaah-daylight' });
  auth.changeStaffRole(assistantHeadteacher.staff.id, 'ASSISTANT_HEADTEACHER', 'school-osaah-daylight');
  const schoolUsers = [
    ['proprietor@osaah.edu.gh', 'Synthetic-Proprietor-Test-Only-2026!', '/reports'],
    [headteacher.staff.username, headteacher.temporaryPassword, '/academics'],
    [assistantHeadteacher.staff.username, assistantHeadteacher.temporaryPassword, '/academics'],
    ['bursar@osaah.edu.gh', 'Bursar123!', '/fees'],
    ['teacher@osaah.edu.gh', 'Teacher123!', '/academics']
  ];
  try {
    for (const [username, password, protectedRoute] of schoolUsers) {
      const login = auth.login({ username, password, portal: 'school' });
      assert.equal(login.ok, true, `${username} should log in`);
      const logout = await request(server, '/api/auth/logout', { method: 'POST', cookie: `osaah_session=${login.token}` });
      assert.equal(logout.status, 204, `${username} logout should succeed`);
      assert.match(logout.headers['set-cookie'][0], /osaah_session=;/);
      const publicHome = await request(server, '/', { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(publicHome.status, 200);
      assert.match(publicHome.body, /id="login-form"/);
      const protectedNavigation = await request(server, protectedRoute, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      assert.equal(protectedNavigation.status, 303, `${username} must be redirected away from protected navigation`);
      assert.equal(protectedNavigation.headers.location, '/');
      const protectedApi = await request(server, '/api/sidebar');
      assert.equal(protectedApi.status, 401, 'API authorization must remain enforced after logout');
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('signed session rejects tampering, expires, and logout clears the cookie', async () => {
  let clock = 1_000;
  const auth = createAuthService({ sessionSecret: SESSION_SECRET, now: () => clock });
  const login = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  assert.equal(auth.authenticate(`${login.token.slice(0, -1)}x`), null);
  clock = login.expiresAt + 1;
  assert.equal(auth.authenticate(login.token), null);

  const freshAuth = createAuthService({ sessionSecret: SESSION_SECRET });
  const fresh = freshAuth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  const server = createServer(createApp({ auth: freshAuth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server, '/api/auth/logout', { method: 'POST', cookie: `osaah_session=${fresh.token}` });
    assert.equal(response.status, 204);
    assert.match(response.headers['set-cookie'][0], /osaah_session=;/);
    assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('test Parent child authorization survives separate serverless app instances', async () => {
  const previousSessionSecret = process.env.OSAAH_SESSION_SECRET;
  process.env.OSAAH_SESSION_SECRET = SESSION_SECRET;
  const user = createConfiguredTestParent('sch_default_01');
  const { database } = createParentLoginDatabase({ user });
  const loginAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const navigationAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const sms = otpService(user.id, TEST_PARENT_PHONE);
  const loginServer = createServer(createApp({ auth: loginAuth, database, parentSmsAuth: sms, aiEnabled: false }));
  const navigationServer = createServer(createApp({ auth: navigationAuth, database, parentSmsAuth: sms, aiEnabled: false }));
  if (previousSessionSecret === undefined) delete process.env.OSAAH_SESSION_SECRET;
  else process.env.OSAAH_SESSION_SECRET = previousSessionSecret;
  await Promise.all([loginServer, navigationServer].map((server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))));
  try {
    const login = await completeParentOtp(loginServer);
    assert.equal(login.status, 200, login.body);
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(cookie, 'cross-instance fixture login must establish a signed session cookie');

    const session = await request(navigationServer, '/api/auth/session', { cookie });
    assert.equal(session.status, 200, session.body);
    assert.equal(JSON.parse(session.body).user.schoolId, 'sch_default_01');

    const children = await request(navigationServer, '/api/parent/children', { cookie });
    assert.equal(children.status, 200, children.body);
    assert.deepEqual(JSON.parse(children.body).children.map((child) => child.permanentStudentId), [...TEST_PARENT_STUDENT_IDS]);

    const resolve = await request(navigationServer, `/api/parent/children/resolve?permanentStudentId=${encodeURIComponent(TEST_PARENT_STUDENT_IDS[0])}`, { cookie });
    assert.equal(resolve.status, 200, resolve.body);
    assert.equal(JSON.parse(resolve.body).child.sampleLabel, 'SAMPLE DATA');
  } finally {
    await Promise.all([loginServer, navigationServer].map((server) => new Promise((resolve) => server.close(resolve))));
  }
});
