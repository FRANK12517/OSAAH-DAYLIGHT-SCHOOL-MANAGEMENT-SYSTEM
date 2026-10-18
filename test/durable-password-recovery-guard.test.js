import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

test('database-backed auth does not issue in-memory reset tokens or claim to change durable credentials', () => {
  let writes = 0;
  const auth = createAuthService({
    database: {
      async query() { return []; },
      async execute() { writes += 1; return { affectedRows: 1 }; }
    }
  });
  assert.deepEqual(auth.requestPasswordReset('teacher@osaah.edu.gh'), { ok: true });
  assert.deepEqual(auth.completePasswordReset('untrusted-reset-token', 'NewTeacher123!'), {
    ok: false,
    error: 'Invalid or expired reset request.'
  });
  assert.equal(writes, 0);
});
