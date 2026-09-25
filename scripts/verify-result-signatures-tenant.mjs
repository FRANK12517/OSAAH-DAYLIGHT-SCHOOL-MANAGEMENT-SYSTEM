import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthService, DEMO_USERS } from '../src/auth.js';
import { createSignatureService } from '../src/signatures.js';

const auth = createAuthService({ users: [{ ...DEMO_USERS.find((user) => user.roleKey === 'PROPRIETOR'), id: 'proprietor-tenant-test', schoolId: 'sch_default_01' }] });
const login = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school', role: 'PROPRIETOR' });
assert.equal(login.ok, true);
const app = createApp({ auth, signatures: createSignatureService({ schoolId: 'sch_default_01' }) });
const server = createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/result-signatures`, { headers: { Authorization: `Bearer ${login.token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.signatures));
  assert.ok(body.options);
  console.log('Result Signatures tenant regression check passed.');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
