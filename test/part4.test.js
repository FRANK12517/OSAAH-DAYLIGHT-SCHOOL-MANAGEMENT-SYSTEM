import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../src/server.js';
import { createAuthService } from '../src/auth.js';

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, method: options.method ?? 'GET', headers: { Authorization: `Bearer ${options.token ?? ''}`, 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

test('Part 4 role dashboards and server-side authority matrix', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' });
  const expected = [['HEADTEACHER', '/academics'], ['ASSISTANT_HEADTEACHER', '/academics'], ['ACCOUNTANT', '/fees'], ['CLASSROOM_TEACHER', '/academics']];
  const logins = {};
  for (const [primaryRole, dashboard] of expected) {
    const created = auth.registerStaff({ fullName: primaryRole, staffId: `STAFF-${primaryRole}`, primaryRole }, proprietor.user);
    const login = auth.login({ username: created.staff.username, password: created.temporaryPassword, portal: 'school' });
    assert.equal(login.redirectTo, dashboard);
    logins[primaryRole] = login;
  }

  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const application = await request(port, '/api/admissions', { method: 'POST', token: proprietor.token, body: { firstName: 'Yaw', surname: 'Mensah', classId: 'primary-4' } });
    assert.equal(application.status, 201);
    assert.equal((await request(port, '/api/admissions', { token: logins.HEADTEACHER.token })).status, 200);
    assert.equal((await request(port, '/api/admissions', { token: logins.CLASSROOM_TEACHER.token })).status, 403);

    const accepted = await request(port, `/api/admissions/${application.body.applicationNumber}/decision`, { method: 'POST', token: logins.HEADTEACHER.token, body: { decision: 'ACCEPTED', year: 2026 } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.permanentStudentId, 'OSAAH/2026/0001');

    const fee = await request(port, '/api/fees/structures', { method: 'POST', token: proprietor.token, body: { type: 'TUITION', amount: 1200 } });
    assert.equal(fee.status, 201);
    assert.equal((await request(port, '/api/fees/publish', { method: 'POST', token: logins.ACCOUNTANT.token, body: { id: fee.body.id } })).status, 403);
    const published = await request(port, '/api/fees/publish', { method: 'POST', token: proprietor.token, body: { id: fee.body.id } });
    assert.equal(published.status, 200);
    assert.equal(published.body.status, 'PUBLISHED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
