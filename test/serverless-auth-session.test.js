import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';

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
