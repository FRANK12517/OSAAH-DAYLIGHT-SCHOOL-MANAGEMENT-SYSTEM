import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth.js';
import { normalizeGhanaPhone, isValidGhanaPhone } from '../src/ghana-phone.js';
import { createParentLoginDatabase } from './helpers/parent-login-fixture.js';
import { createConfiguredTestParent, TEST_PARENT_PHONE } from '../src/test-parent-fixture.js';

test('Ghana phone normalization accepts equivalent local and international formats', () => {
  assert.equal(normalizeGhanaPhone('0241234567'), '+233241234567');
  assert.equal(normalizeGhanaPhone('+233241234567'), '+233241234567');
  assert.equal(normalizeGhanaPhone('233241234567'), '+233241234567');
  assert.equal(isValidGhanaPhone('0241234567'), true);
  assert.equal(isValidGhanaPhone('02412345'), false);
  assert.equal(isValidGhanaPhone('not-a-phone'), false);
});

test('Parent phone-only login fails closed without TiDB while school authentication remains available', () => {
  const auth = createAuthService();
  const parent = auth.loginByPhone({ phone: '0241234567', portal: 'parent' });
  assert.equal(parent.ok, false);
  assert.equal(parent.token, undefined);
  assert.equal(parent.user, undefined);
  assert.equal(auth.loginByPhone({ phone: '0550000000', portal: 'parent' }).ok, false);
  assert.equal(auth.loginByPhone({ phone: 'bad', portal: 'parent' }).ok, false);
  assert.equal(auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' }).ok, true);
});

test('registered Parent phone creates a durable session scoped to the canonical school', async () => {
  const user = { ...createConfiguredTestParent('sch_default_01'), schoolId: 'sch_default_01', phone: TEST_PARENT_PHONE };
  const { database, persisted } = createParentLoginDatabase({ user });
  const auth = createAuthService({ users: [], database, schoolId: 'sch_default_01', sessionSecret: 'test-parent-session-secret-at-least-32-chars' });
  const result = await auth.loginByPhoneFromDatabase({ phone: '0' + TEST_PARENT_PHONE.slice(4), portal: 'parent', ipAddress: 'test-client' });
  assert.equal(result.ok, true);
  assert.equal(result.redirectTo, '/parent-dashboard');
  assert.equal(result.user.schoolId, 'sch_default_01');
  assert.ok(persisted.session);
  assert.match(result.token, /^[A-Za-z0-9_.-]+$/);
  assert.ok(await auth.authenticateAsync(result.token));
  await auth.logoutSession(result.token);
  assert.equal(await auth.authenticateAsync(result.token), null);
});

test('Parent phone login refuses accounts returned outside the configured school', async () => {
  const user = { ...createConfiguredTestParent('other-school'), schoolId: 'other-school', phone: TEST_PARENT_PHONE };
  const { database } = createParentLoginDatabase({ user });
  const auth = createAuthService({ users: [], database, schoolId: 'sch_default_01', sessionSecret: 'test-parent-session-secret-at-least-32-chars' });
  const result = await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, portal: 'parent', ipAddress: 'test-client' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('unknown registered-format Parent phones receive the same generic failure without creating a session', async () => {
  const user = { ...createConfiguredTestParent('sch_default_01'), schoolId: 'sch_default_01', phone: TEST_PARENT_PHONE };
  const { database, persisted } = createParentLoginDatabase({ user });
  const auth = createAuthService({ users: [], database, schoolId: 'sch_default_01', sessionSecret: 'test-parent-session-secret-at-least-32-chars' });
  const result = await auth.loginByPhoneFromDatabase({ phone: '0240000000', portal: 'parent', ipAddress: 'test-client' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, 'Unable to sign in. Check the phone number or contact the school.');
  assert.equal(persisted.session, null);
});

test('Parent phone login applies persistent per-phone throttling', async () => {
  const user = { ...createConfiguredTestParent('sch_default_01'), schoolId: 'sch_default_01', phone: TEST_PARENT_PHONE };
  const { database } = createParentLoginDatabase({ user });
  const auth = createAuthService({ users: [], database, schoolId: 'sch_default_01', sessionSecret: 'test-parent-session-secret-at-least-32-chars' });
  for (let index = 0; index < 3; index += 1) await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, ipAddress: 'shared-client' });
  const limited = await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE, ipAddress: 'shared-client' });
  assert.equal(limited.status, 429);
});

test('Parent phone-only login cannot create a session from a registered phone or supplied child claims', () => {
  const users = [{ id: 'parent-1', username: 'parent-1', phone: '+233241234567', portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read']), children: [{ id: 's-1', permanentStudentId: 'OSAAH/2026/0001' }, { id: 's-2', permanentStudentId: 'OSAAH/2026/0002' }], assignedStudentIds: ['s-1'], authorizedStaffIds: ['staff-1'] }];
  const auth = createAuthService({ users });
  const result = auth.loginByPhone({ phone: '233241234567', portal: 'parent' });
  assert.equal(result.ok, false);
  assert.equal(result.token, undefined);
  assert.equal(auth.authenticate(''), null);
});
