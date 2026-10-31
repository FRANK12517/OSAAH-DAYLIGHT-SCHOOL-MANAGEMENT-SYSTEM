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

test('Parent phone-only login is rejected while school authentication remains available', () => {
  const auth = createAuthService();
  const parent = auth.loginByPhone({ phone: '0241234567', portal: 'parent' });
  assert.equal(parent.ok, false);
  assert.equal(parent.token, undefined);
  assert.equal(parent.user, undefined);
  assert.equal(auth.loginByPhone({ phone: '0550000000', portal: 'parent' }).ok, false);
  assert.equal(auth.loginByPhone({ phone: 'bad', portal: 'parent' }).ok, false);
  assert.equal(auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' }).ok, true);
});

test('Parent phone-only login cannot create a session from a registered phone or supplied child claims', () => {
  const users = [{ id: 'parent-1', username: 'parent-1', phone: '+233241234567', portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read']), children: [{ id: 's-1', permanentStudentId: 'OSAAH/2026/0001' }, { id: 's-2', permanentStudentId: 'OSAAH/2026/0002' }], assignedStudentIds: ['s-1'], authorizedStaffIds: ['staff-1'] }];
  const auth = createAuthService({ users });
  const result = auth.loginByPhone({ phone: '233241234567', portal: 'parent' });
  assert.equal(result.ok, false);
  assert.equal(result.token, undefined);
  assert.equal(auth.authenticate(''), null);
});
