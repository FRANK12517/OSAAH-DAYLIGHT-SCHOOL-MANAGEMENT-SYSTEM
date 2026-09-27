import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { DEFAULT_PRODUCTION_SCHOOL_ID, resolveCurrentSchoolContext } from '../src/school-context.js';

const actor = (overrides = {}) => ({
  id: 'staff-1',
  portal: 'school',
  roleKey: 'ACCOUNTANT_BURSAR',
  schoolId: DEFAULT_PRODUCTION_SCHOOL_ID,
  accountStatus: 'ACTIVE',
  ...overrides
});

test('authenticated OSAAH staff resolves to the canonical production school', () => {
  assert.deepEqual(resolveCurrentSchoolContext(actor()), {
    schoolId: DEFAULT_PRODUCTION_SCHOOL_ID,
    userId: 'staff-1',
    roleKey: 'ACCOUNTANT_BURSAR',
    portal: 'school'
  });
  for (const roleKey of ['ACCOUNTANT_BURSAR', 'SCHOOL_ADMIN', 'PROPRIETOR']) assert.equal(resolveCurrentSchoolContext(actor({ roleKey })).schoolId, DEFAULT_PRODUCTION_SCHOOL_ID);
});

test('context resolver rejects unauthenticated, inactive, and portal-mismatched accounts', () => {
  assert.throws(() => resolveCurrentSchoolContext(null), /Authentication is required/);
  assert.throws(() => resolveCurrentSchoolContext(actor({ accountStatus: 'DISABLED' })), /not active/);
  assert.throws(() => resolveCurrentSchoolContext(actor({ portal: 'parent' }), { portal: 'school' }), /not authorized/);
});

test('production service defaults use the authenticated school instead of the demo school', async () => {
  const previous = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = DEFAULT_PRODUCTION_SCHOOL_ID;
  const passwordHash = 'test-salt:2ebf1f0f32f6de4c8f2c11a7b6fbb2ce6a391ac9e05a2a64db2c51d0bb2a8f5f';
  // The fixture uses a custom login override so this test exercises server scope without credentials.
  const user = { ...actor(), username: 'accountant@test.local', passwordHash, permissions: new Set(['fees.read', 'finance.read']) };
  const auth = createAuthService({ users: [user], sessionSecret: 'test-only-session-secret-0123456789012345' });
  auth.login = () => ({ ok: true, token: 'canonical-token', user: { ...user, sessionId: 'session-1' } });
  auth.authenticateAsync = async (token) => token === 'canonical-token' ? { ...user, permissions: user.permissions } : null;
  const app = createApp({ auth });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/fees/invoices`, { headers: { Authorization: 'Bearer canonical-token' } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).invoices, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.OSAAH_SCHOOL_ID; else process.env.OSAAH_SCHOOL_ID = previous;
  }
});
