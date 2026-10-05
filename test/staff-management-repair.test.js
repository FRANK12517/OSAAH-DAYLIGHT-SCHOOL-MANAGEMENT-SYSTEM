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

test('Staff Management API requires authentication and staff.manage permission, and blocks self-lockout', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  const created = auth.createAdministrator({ fullName: 'Controlled Administrator', staffId: 'ADMIN-CONTROLLED' }, proprietor.user);
  const administrator = auth.login({ username: created.administrator.username, password: created.temporaryPassword, portal: 'school' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    assert.equal(await request(server, '/api/staff-management'), 401);
    assert.equal(await request(server, '/api/staff-management', { token: teacher.token }), 403);
    assert.equal(await request(server, '/api/staff-management', { token: administrator.token }), 200);
    assert.equal(await request(server, `/api/staff-management/${created.administrator.id}/disable`, { method: 'POST', token: administrator.token }), 409);
    assert.equal(await request(server, `/api/staff-management/${created.administrator.id}/revoke`, { method: 'POST', token: administrator.token }), 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
