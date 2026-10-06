import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAuthService, DEMO_USERS } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

const schoolId = 'sch_password_test';
const oldPassword = 'Old-password-123!';
const newPassword = 'New-password-456@';
const hash = (value, salt) => `${salt}:${scryptSync(value, salt, 32).toString('hex')}`;

function makeUser() {
  return { id: 'password-change-user', username: 'teacher@example.test', email: 'teacher@example.test', passwordHash: hash(oldPassword, 'password-change-salt'), portal: 'school', roleKey: 'TEACHER', schoolId, permissions: new Set(['students.read', 'academics.read']) };
}

function post(server, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({ port: server.address().port, path, method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: responseBody, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function withServer(auth, callback) {
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try { return await callback(server); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('self-service change validates current password and policy without leaking secrets', async () => {
  const user = makeUser();
  const auth = createAuthService({ users: [user], sessionSecret: 'password-change-session-secret-123456' });
  const login = auth.login({ username: user.username, password: oldPassword, portal: 'school', role: user.roleKey });
  assert.equal(login.ok, true);
  const identityBefore = { id: user.id, username: user.username, email: user.email, roleKey: user.roleKey, schoolId: user.schoolId, permissions: [...user.permissions].sort() };
  await withServer(auth, async (server) => {
    const changed = await post(server, '/api/auth/change-password', login.token, { currentPassword: oldPassword, newPassword, confirmPassword: newPassword });
    assert.equal(changed.status, 200);
    assert.deepEqual(JSON.parse(changed.body), { ok: true });
    assert.match(String(changed.headers['set-cookie']), /Max-Age=0/);
    assert.equal(auth.authenticate(login.token), null, 'all sessions, including the current one, are revoked');
    assert.equal(auth.login({ username: user.username, password: oldPassword, portal: 'school', role: user.roleKey }).ok, false);
    const newLogin = auth.login({ username: user.username, password: newPassword, portal: 'school', role: user.roleKey });
    assert.equal(newLogin.ok, true);
    assert.equal(newLogin.user.roleKey, identityBefore.roleKey);
    assert.deepEqual({ id: user.id, username: user.username, email: user.email, roleKey: user.roleKey, schoolId: user.schoolId, permissions: [...user.permissions].sort() }, identityBefore);
    assert.doesNotMatch(changed.body, /passwordHash|password_hash|temporaryPassword|sessionToken|resetToken/i);
  });
});

test('incorrect current password and weak or mismatched new passwords are rejected without mutation', async () => {
  const user = makeUser();
  const auth = createAuthService({ users: [user], sessionSecret: 'password-change-validation-secret-123456' });
  const login = auth.login({ username: user.username, password: oldPassword, portal: 'school', role: user.roleKey });
  await withServer(auth, async (server) => {
    const wrongCurrent = await post(server, '/api/auth/change-password', login.token, { currentPassword: 'Wrong-password-999!', newPassword, confirmPassword: newPassword });
    assert.equal(wrongCurrent.status, 401);
    const weak = await post(server, '/api/auth/change-password', login.token, { currentPassword: oldPassword, newPassword: 'short', confirmPassword: 'short' });
    assert.equal(weak.status, 400);
    const mismatch = await post(server, '/api/auth/change-password', login.token, { currentPassword: oldPassword, newPassword, confirmPassword: 'Different-password-789#' });
    assert.equal(mismatch.status, 400);
    assert.equal(auth.login({ username: user.username, password: oldPassword, portal: 'school', role: user.roleKey }).ok, true);
  });
});

test('change-password endpoint requires authentication and is available to every existing dashboard role', async () => {
  const auth = createAuthService({ users: [makeUser()], sessionSecret: 'password-change-unauth-secret-123456' });
  await withServer(auth, async (server) => {
    const unauthenticated = await post(server, '/api/auth/change-password', 'not-a-session', { currentPassword: oldPassword, newPassword, confirmPassword: newPassword });
    assert.equal(unauthenticated.status, 401);
  });
  const module = SIDEBAR_MODULES.find((candidate) => candidate.route === '/change-password.html');
  assert.ok(module);
  for (const roleKey of new Set(DEMO_USERS.map((candidate) => candidate.roleKey))) {
    const portal = roleKey === 'PARENT' ? 'parent' : 'school';
    const groups = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['*']), roleKey, portal });
    assert.ok(groups.flatMap((group) => group.modules).some((candidate) => candidate.route === module.route), `missing Change Password for ${roleKey}`);
  }
});
