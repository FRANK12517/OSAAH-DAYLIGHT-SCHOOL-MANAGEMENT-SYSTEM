import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthService, DEMO_USERS } from '../src/auth.js';

process.env.OSAAH_SCHOOL_ID = 'sch_default_01';
const auth = createAuthService({ users: [{ ...DEMO_USERS.find((user) => user.roleKey === 'PROPRIETOR'), id: 'proprietor-tenant-test', schoolId: 'sch_default_01' }] });
const login = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school', role: 'PROPRIETOR' });
assert.equal(login.ok, true);
const app = createApp({ auth });
const server = createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/result-signatures`, { headers: { Authorization: `Bearer ${login.token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.signatures));
  assert.ok(body.options);
  const communicationResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/developer/communication/providers`, { headers: { Authorization: `Bearer ${login.token}` } });
  const communicationBody = await communicationResponse.json();
  assert.equal(communicationResponse.status, 200);
  assert.deepEqual(communicationBody.providers, []);
  console.log('Result Signatures and Communication Setup tenant regression checks passed.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
