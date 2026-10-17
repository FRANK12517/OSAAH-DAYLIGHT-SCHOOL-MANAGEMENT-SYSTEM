import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import test from 'node:test';
import { canonicalRoleKey, createAuthService, SCHOOL_PORTAL_DASHBOARDS } from '../src/auth.js';

const testSchoolId = 'auth-regression-school';
const accounts = [
  { id: 'owner', username: 'proprietor@test.invalid', password: 'TestOnly-owner-123!', roleKey: 'PROPRIETOR', route: '/reports', permissionKey: '*' },
  { id: 'admin', username: 'administrator@test.invalid', password: 'TestOnly-admin-123!', roleKey: 'SCHOOL_ADMIN', route: '/settings', permissionKey: 'settings.read' },
  { id: 'head', username: 'headteacher@test.invalid', password: 'TestOnly-head-123!', roleKey: 'HEADTEACHER', route: '/academics', permissionKey: 'academics.read' },
  { id: 'assistant', username: 'assistant@test.invalid', password: 'TestOnly-assistant-123!', roleKey: 'ASSISTANT_HEADTEACHER', route: '/academics', permissionKey: 'academics.read' },
  { id: 'accountant', username: 'accountant@test.invalid', password: 'TestOnly-accountant-123!', roleKey: 'ACCOUNTANT_BURSAR', route: '/fees', permissionKey: 'fees.read' },
  { id: 'teacher', username: 'teacher.test', email: 'teacher@test.invalid', password: 'TestOnly-teacher-123!', roleKey: 'TEACHER', route: '/academics', permissionKey: 'academics.read' }
];

test('six-role login contract authenticates, rejects bad passwords, and selects its dashboard', async () => {
  const rows = await Promise.all(accounts.map(async (account) => ({
    id: account.id,
    schoolId: testSchoolId,
    username: account.username,
    email: account.email ?? account.username,
    passwordHash: await bcrypt.hash(account.password, 4),
    status: 'ACTIVE',
    roleKey: account.roleKey,
    permissionKey: account.permissionKey
  })));
  const database = {
    query: async (_sql, params) => rows.filter((row) => row.username.toLowerCase() === params[0] || row.email.toLowerCase() === params[1])
  };
  const auth = createAuthService({ database, sessionSecret: 'auth-regression-contract-test-session-secret' });

  for (const account of accounts) {
    const result = await auth.loginFromDatabase({ username: account.username, password: account.password, portal: 'school' });
    assert.equal(result.ok, true, `${account.roleKey} should accept its test fixture credentials`);
    assert.equal(result.user.roleKey, account.roleKey);
    assert.equal(result.user.schoolId, testSchoolId);
    assert.equal(result.redirectTo, account.route);
    assert.equal(SCHOOL_PORTAL_DASHBOARDS[canonicalRoleKey(account.roleKey)], account.route);
    assert.equal(auth.authenticate(result.token).roleKey, account.roleKey);
    assert.equal((await auth.loginFromDatabase({ username: account.username, password: 'wrong-test-password', portal: 'school' })).ok, false);
  }
  const teacherEmailLogin = await auth.loginFromDatabase({ username: 'teacher@test.invalid', password: accounts.at(-1).password, portal: 'school' });
  assert.equal(teacherEmailLogin.ok, true, 'the Teacher email identifier must remain supported');
  assert.equal(teacherEmailLogin.redirectTo, '/academics');
});

test('role aliases preserve the established admin and accountant dashboard contracts', () => {
  assert.equal(canonicalRoleKey('ADMINISTRATOR'), 'SCHOOL_ADMIN');
  assert.equal(canonicalRoleKey('SCHOOL_ADMINISTRATOR'), 'SCHOOL_ADMIN');
  assert.equal(canonicalRoleKey('ACCOUNTANT'), 'ACCOUNTANT_BURSAR');
  assert.equal(SCHOOL_PORTAL_DASHBOARDS.SCHOOL_ADMIN, '/settings');
  assert.equal(SCHOOL_PORTAL_DASHBOARDS.ACCOUNTANT_BURSAR, '/fees');
});
