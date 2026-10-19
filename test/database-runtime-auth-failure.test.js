import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

test('staff and parent authentication fail closed on DNS and connection errors', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const code of ['ENOTFOUND', 'ECONNRESET']) {
      const database = { async query() { throw Object.assign(new Error('private host and credential details'), { code }); } };
      const auth = createAuthService({ database, sessionSecret: 'test-session-secret-012345678901234567890' });
      const staff = await auth.loginFromDatabase({ username: 'staff@example.test', password: 'not-a-real-password', portal: 'school' });
      const parent = await auth.loginByPhoneFromDatabase({ phone: '0241234567' });
      assert.equal(staff.status, 503);
      assert.equal(staff.error, 'Authentication service unavailable.');
      assert.equal(parent.status, 503);
      assert.equal(parent.error, 'Authentication service unavailable.');
      assert.doesNotMatch(JSON.stringify([staff, parent]), /private host|credential details/);
    }
  } finally { console.error = originalError; }
});