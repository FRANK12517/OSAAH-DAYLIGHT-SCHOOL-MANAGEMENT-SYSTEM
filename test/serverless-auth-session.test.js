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
