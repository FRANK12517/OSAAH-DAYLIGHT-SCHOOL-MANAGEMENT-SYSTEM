import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

function request(server, path, { method = 'GET', token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = httpRequest({ port: server.address().port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

function requestJson(server, path, { method = 'GET', token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = httpRequest({ port: server.address().port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('Staff Management API requires authentication and staff.manage permission, and blocks self-lockout', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  const created = auth.createAdministrator({ fullName: 'Controlled Administrator', staffId: 'ADMIN-CONTROLLED' }, proprietor.user);
  const administrator = auth.login({ username: created.administrator.username, password: created.temporaryPassword, portal: 'school' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    assert.equal(await request(server, '/api/staff-management'), 401);
    assert.equal(await request(server, '/api/staff-management', { token: teacher.token }), 403);
    assert.equal(await request(server, '/api/staff-management', { token: administrator.token }), 200);
    const administratorDirectory = await requestJson(server, '/api/staff-directory', { token: administrator.token });
    assert.equal(administratorDirectory.status, 200);
    assert.equal(administratorDirectory.body.canManageStaff, true);
    assert.equal(await request(server, '/api/staff-directory', { token: teacher.token }), 403);
    assert.equal(await request(server, `/api/staff-management/${created.administrator.id}/disable`, { method: 'POST', token: administrator.token }), 409);
    assert.equal(await request(server, `/api/staff-management/${created.administrator.id}/revoke`, { method: 'POST', token: administrator.token }), 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Staff Management renders API-backed directory rows after loading', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../public/staff-management.html', import.meta.url), 'utf8');
  const loader = source.match(/async function load\(\)\{([\s\S]*?)\}form\.onsubmit=/)?.[1];
  assert.ok(loader, 'Staff Management load function should be present');
  assert.match(loader, /const render=staff=>/, 'directory renderer should be defined');
  assert.match(loader, /render\(Array\.isArray\(data\.staff\)\?data\.staff:\[\]\)/, 'API staff rows should be passed to the renderer');
});

test('Staff Directory uses the read-only directory endpoint', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../public/staff-canonical.html', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/api\/staff-directory'\)/, 'Staff Directory should use its read-only directory endpoint');
  assert.doesNotMatch(source, /fetch\('\/api\/attendance\/staff'\)/, 'Staff Directory must not use the attendance-only endpoint');
});

test('Staff Directory removal is confirmed in the client and deactivates only same-school accounts', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const registered = auth.registerStaff({ fullName: 'Directory Removal Test', staffId: 'STAFF-REMOVE-TEST', email: 'directory-removal@example.test', primaryRole: 'TEACHER' }, proprietor.user);
  const registeredLogin = auth.login({ username: registered.staff.username, password: registered.temporaryPassword, portal: 'school' });
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const directory = await requestJson(server, '/api/staff-directory', { token: proprietor.token });
    assert.equal(directory.status, 200);
    assert.equal(directory.body.canManageStaff, true);
    const listedTeacher = directory.body.staff.find((member) => member.userId === registered.staff.userId);
    assert.ok(listedTeacher, 'staff directory provides the linked account ID for row actions');
    assert.equal(auth.setAccountStatus(registered.staff.userId, false, 'another-school'), false, 'the status service rejects a cross-school user ID');
    assert.equal((await request(server, `/api/staff-management/${registered.staff.userId}/disable`, { method: 'POST', token: teacher.token })), 403, 'non-administrator roles cannot disable staff accounts');
    assert.equal((await request(server, `/api/staff-management/${registered.staff.userId}/disable`, { method: 'POST', token: proprietor.token })), 200);
    const afterRemoval = await requestJson(server, '/api/staff-directory', { token: proprietor.token });
    assert.equal(afterRemoval.body.staff.find((member) => member.userId === registered.staff.userId).accountStatus, 'DISABLED');
    assert.equal(await auth.authenticateAsync(registeredLogin.token), null, 'removal revokes the target staff account session');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const source = await (await import('node:fs/promises')).readFile(new URL('../public/staff-canonical.html', import.meta.url), 'utf8');
  assert.match(source, /Are you sure you want to remove \$\{pendingStaff\.fullName\} from the system\?/);
  assert.match(source, /id="cancel-remove"[^>]*>Cancel/);
  assert.match(source, /id="continue-remove"[^>]*>Continue/);
  assert.match(source, /fetch\(`\/api\/staff-management\/\$\{id\}\/disable`,\{method:'POST'\}\)/);
});
