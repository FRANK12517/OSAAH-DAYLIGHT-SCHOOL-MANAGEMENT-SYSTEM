import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth.js';
import { normalizeGhanaPhone, isValidGhanaPhone } from '../src/ghana-phone.js';

test('Ghana phone normalization accepts equivalent local and international formats', () => {
  assert.equal(normalizeGhanaPhone('0241234567'), '+233241234567');
  assert.equal(normalizeGhanaPhone('+233241234567'), '+233241234567');
  assert.equal(normalizeGhanaPhone('233241234567'), '+233241234567');
  assert.equal(isValidGhanaPhone('0241234567'), true);
  assert.equal(isValidGhanaPhone('02412345'), false);
  assert.equal(isValidGhanaPhone('not-a-phone'), false);
});

test('Parent phone login creates a session and does not change school authentication', () => {
  const auth = createAuthService();
  const parent = auth.loginByPhone({ phone: '0241234567', portal: 'parent' });
  assert.equal(parent.ok, true);
  assert.equal(parent.user.portal, 'parent');
  assert.equal(parent.user.roleKey, 'PARENT');
  assert.equal(auth.authenticate(parent.token).portal, 'parent');
  assert.equal(auth.loginByPhone({ phone: '0550000000', portal: 'parent' }).error, 'Phone number is not registered. Contact the school administrator.');
  assert.equal(auth.loginByPhone({ phone: 'bad', portal: 'parent' }).error, 'Enter a valid Ghana phone number.');
  assert.equal(auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' }).ok, true);
  auth.logout(parent.token);
  assert.equal(auth.authenticate(parent.token), null);
});

test('one registered parent phone can authenticate one parent identity with multiple children', () => {
  const users = [{ id: 'parent-1', username: 'parent-1', phone: '+233241234567', portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read']), children: [{ id: 's-1', permanentStudentId: 'OSAAH/2026/0001' }, { id: 's-2', permanentStudentId: 'OSAAH/2026/0002' }] }];
  const auth = createAuthService({ users });
  const result = auth.loginByPhone({ phone: '233241234567', portal: 'parent' });
  assert.equal(result.ok, true);
  assert.equal(result.user.children.length, 2);
});
