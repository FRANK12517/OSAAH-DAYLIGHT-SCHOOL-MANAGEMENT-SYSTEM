import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createAuthService } from '../src/auth.js';
import { createCommunicationEngine } from '../src/communication-engine.js';
import { createApp } from '../src/server.mjs';
import { visibleSidebar } from '../src/sidebar-registry.js';

const SCHOOL_ID = 'school-osaah-daylight';
const PASSWORD = 'test-only-password';
const passwordHash = (password, salt) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;

function testUser({ id, email, roleKey = 'TEACHER', schoolId = SCHOOL_ID }) {
  return {
    id,
    username: email,
    email,
    passwordHash: passwordHash(PASSWORD, `${id}-salt`),
    portal: 'school',
    roleKey,
    schoolId,
    permissions: new Set(['communication.read'])
  };
}

function request(port, path, token, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const client = httpRequest({ port, host: '127.0.0.1', path, method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) } }, (response) => {
      let payload = '';
      response.on('data', (chunk) => { payload += chunk; });
      response.on('end', () => {
        let parsed = null;
        if (payload) {
          try { parsed = JSON.parse(payload); } catch { parsed = payload; }
        }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    client.on('error', reject);
    if (body) client.write(JSON.stringify(body));
    client.end();
  });
}

test('only the designated teacher identity can use Communication Setup and APIs', async (t) => {
  const users = [
    testUser({ id: 'developer-teacher', email: 'abbanfrank348@gmail.com' }),
    testUser({ id: 'regular-teacher', email: 'teacher@example.test' }),
    testUser({ id: 'school-proprietor', email: 'proprietor@example.test', roleKey: 'PROPRIETOR' }),
    testUser({ id: 'school-admin', email: 'admin@example.test', roleKey: 'SCHOOL_ADMIN' }),
    testUser({ id: 'headteacher', email: 'headteacher@example.test', roleKey: 'HEADTEACHER' })
  ];
  const auth = createAuthService({ users, sessionSecret: 'communication-setup-test-secret-0123456789' });
  const engine = createCommunicationEngine({ fetchImpl: async () => ({ ok: true, status: 200 }) });
  const app = createApp({ auth, communicationEngine: engine });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const designated = auth.login({ username: 'abbanfrank348@gmail.com', password: PASSWORD, portal: 'school' });
  const teacher = auth.login({ username: 'teacher@example.test', password: PASSWORD, portal: 'school' });
  const proprietor = auth.login({ username: 'proprietor@example.test', password: PASSWORD, portal: 'school' });
  const administrator = auth.login({ username: 'admin@example.test', password: PASSWORD, portal: 'school' });
  const headteacher = auth.login({ username: 'headteacher@example.test', password: PASSWORD, portal: 'school' });

  assert.equal(designated.ok, true);
  assert.equal(designated.user.roleKey, 'TEACHER');
  assert.equal(designated.user.canManageCommunicationSetup, true);
  assert.equal(teacher.user.canManageCommunicationSetup, false);
  assert.equal(proprietor.user.canManageCommunicationSetup, false);
  assert.equal(administrator.user.canManageCommunicationSetup, false);
  assert.equal(headteacher.user.canManageCommunicationSetup, false);
  assert.equal(auth.authenticate(designated.token).permissions.has('developer.communication.manage'), true);
  assert.equal(auth.authenticate(teacher.token).permissions.has('developer.communication.manage'), false);

  const session = await request(port, '/api/auth/session', designated.token);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.canManageCommunicationSetup, true);
  assert.equal(session.body.user.roleKey, 'TEACHER');
  assert.equal((await request(port, '/developer/communication-setup', designated.token)).status, 200);
  assert.equal((await request(port, '/developer/communication-setup', teacher.token)).status, 403);

  const listed = await request(port, '/api/developer/communication/providers', designated.token);
  assert.equal(listed.status, 200);
  const saved = await request(port, '/api/developer/communication/providers', designated.token, 'POST', {
    provider: 'ARKESEL', endpoint: 'https://provider.example.test/send', credentials: 'test-secret', senderId: 'OSAAH', priority: 100, active: true
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.credentials, undefined);
  assert.equal((await request(port, '/api/developer/communication/test', designated.token, 'POST', { providerId: saved.body.id })).status, 200);

  for (const account of [teacher, proprietor, administrator, headteacher]) {
    assert.equal((await request(port, '/api/developer/communication/providers', account.token)).status, 403);
    assert.equal((await request(port, '/api/developer/communication/providers', account.token, 'POST', { provider: 'HUBTEL' })).status, 403);
    assert.equal((await request(port, '/api/developer/communication/test', account.token, 'POST', { providerId: saved.body.id })).status, 403);
  }
  assert.equal((await request(port, '/api/developer/communication/providers', 'invalid-token')).status, 401);

  const developerSidebar = visibleSidebar({ permissions: auth.authenticate(designated.token).permissions, roleKey: 'TEACHER', portal: 'school' });
  const regularSidebar = visibleSidebar({ permissions: new Set(['communication.read']), roleKey: 'TEACHER', portal: 'school' });
  assert.ok(developerSidebar.flatMap((group) => group.modules).some((module) => module.moduleKey === 'communication-setup'));
  assert.equal(regularSidebar.flatMap((group) => group.modules).some((module) => module.moduleKey === 'communication-setup'), false);
});
