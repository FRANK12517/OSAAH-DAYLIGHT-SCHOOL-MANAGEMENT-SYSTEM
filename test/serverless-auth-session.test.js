import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { TEST_PARENT_PHONE, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const SESSION_SECRET = 'test-only-session-secret-with-at-least-32-characters';

function request(server, path, { cookie, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    req.on('error', reject); req.end();
  });
}

test('production rejects in-memory Parent sessions when the shared signing secret is missing', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const auth = createAuthService({ sessionSecret: '' });
    const result = auth.loginByPhone({ phone: TEST_PARENT_PHONE, portal: 'parent' });
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
  const login = loginInstance.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  assert.match(login.token, /^v1\./);
  assert.equal(navigationInstance.authenticate(login.token).roleKey, 'PROPRIETOR');
  assert.equal(navigationInstance.authenticate(login.token).schoolId, 'school-osaah-daylight');

  const server = createServer(createApp({ auth: navigationInstance, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
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
  const persisted = { session: null };
  let revoked = false;
  const database = {
    supportsDurableAuthSessions: true,
    async query(sql, params = []) {
      if (sql.includes('FROM users u JOIN user_roles ur')) return [{ id: 'parent-db-1', schoolId: 'school-db-1', username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', parentPhone: '+233240000001' }];
      if (sql.includes('FROM auth_sessions s JOIN users u')) {
        if (revoked || !persisted.session || params[0] !== persisted.session.tokenHash) return [];
        return [{ sessionId: persisted.session.sessionId, userId: 'parent-db-1', schoolId: 'school-db-1', expiresAt: persisted.session.expiresAt, username: 'parent@example.test', email: 'parent@example.test', status: 'ACTIVE', roleKey: 'PARENT', permissionKey: null }];
      }
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO auth_sessions')) persisted.session = { sessionId: params[0], tokenHash: params[3], expiresAt: params[5] };
      if (sql.startsWith('UPDATE auth_sessions SET revoked_at=')) revoked = true;
      return { affectedRows: 1 };
    }
  };
  const loginAuth = createAuthService({ database, sessionSecret: SESSION_SECRET });
  const login = await loginAuth.loginByPhoneFromDatabase({ phone: '+233240000001' });
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
  const loginAuth = createAuthService({ sessionSecret: SESSION_SECRET });
  const login = await loginAuth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, portal: 'parent' });
  assert.equal(login.ok, true);
  const nextInstance = createAuthService({ sessionSecret: SESSION_SECRET });
  const restored = await nextInstance.authenticateAsync(login.token);
  assert.equal(restored.id, 'user-test-parent-sample');
  assert.equal(restored.portal, 'parent');
  assert.equal(restored.children, undefined);
});

test('Parent APIs expose only linked children, canonical options, allowed records, and invalidate data on logout', async () => {
  const auth = createAuthService({ sessionSecret: SESSION_SECRET });
  const login = auth.loginByPhone({ phone: TEST_PARENT_PHONE, portal: 'parent' });
  assert.equal(login.ok, true);
  const cookie = `osaah_session=${login.token}`;
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
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
  await new Promise((resolve) => server.listen(0, resolve));
  const headteacher = auth.registerStaff({ fullName: 'Test Headteacher', staffId: 'STAFF-LOGOUT-HEAD', primaryRole: 'TEACHER' }, { schoolId: 'school-osaah-daylight' });
  auth.changeStaffRole(headteacher.staff.id, 'HEADTEACHER', 'school-osaah-daylight');
  const assistantHeadteacher = auth.registerStaff({ fullName: 'Test Assistant Headteacher', staffId: 'STAFF-LOGOUT-ASSISTANT', primaryRole: 'TEACHER' }, { schoolId: 'school-osaah-daylight' });
  auth.changeStaffRole(assistantHeadteacher.staff.id, 'ASSISTANT_HEADTEACHER', 'school-osaah-daylight');
  const schoolUsers = [
    ['proprietor@osaah.edu.gh', 'Proprietor123!', '/reports'],
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
  const login = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  assert.equal(auth.authenticate(`${login.token.slice(0, -1)}x`), null);
  clock = login.expiresAt + 1;
  assert.equal(auth.authenticate(login.token), null);

  const freshAuth = createAuthService({ sessionSecret: SESSION_SECRET });
  const fresh = freshAuth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  const server = createServer(createApp({ auth: freshAuth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await request(server, '/api/auth/logout', { method: 'POST', cookie: `osaah_session=${fresh.token}` });
    assert.equal(response.status, 204);
    assert.match(response.headers['set-cookie'][0], /osaah_session=;/);
    assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
