import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.js';

test('leadership can access unified registration; legacy enquiries and mutations are read-only or retired', async () => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Synthetic-Proprietor-Test-Only-2026!', portal: 'school' });
  const leader = auth.authenticate(proprietor.token);
  const sessions = [proprietor];
  for (const roleKey of ['HEADTEACHER', 'ASSISTANT_HEADTEACHER']) {
    const registered = auth.registerStaff({ fullName: roleKey, staffId: `TEST-${roleKey}`, primaryRole: roleKey }, leader);
    sessions.push(auth.login({ username: registered.staff.username, password: registered.temporaryPassword, portal: 'school' }));
  }
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const session of sessions) {
      const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
      const page = await fetch(base + '/admissions/register?embedded=1', { headers });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Student Admission and Registration/);
      const historical = await fetch(base + '/api/admission-applications', { headers });
      assert.equal(historical.status, 200);
      const write = await fetch(base + '/api/admission-applications', { method: 'POST', headers, body: JSON.stringify({ studentFirstName: 'Synthetic', studentSurname: 'Candidate' }) });
      assert.equal(write.status, 410);
      assert.equal((await write.json()).code, 'LEGACY_ADMISSION_WORKFLOW_RETIRED');
    }
    const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
    const denied = await fetch(base + '/admissions/register?embedded=1', { headers: { Authorization: `Bearer ${teacher.token}` } });
    assert.equal(denied.status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); server.closeAllConnections?.(); }
});
