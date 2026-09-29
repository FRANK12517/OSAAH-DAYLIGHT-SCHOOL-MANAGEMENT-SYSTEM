import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth.js';
import { normalizeGhanaPhone } from '../src/ghana-phone.js';
import { authorizeParentStudent, PARENT_UNLINKED_MESSAGE } from '../src/parent-authorization.js';
import { createStudentService } from '../src/students.js';
import { TEST_PARENT_PHONE, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const schoolId = 'school-osaah-daylight';

test('controlled test parent authenticates through canonical Ghana phone forms and establishes a server session', () => {
  const auth = createAuthService();
  for (const phone of ['0247293733', '+233247293733', '233247293733']) {
    const result = auth.loginByPhone({ phone, portal: 'parent' });
    assert.equal(result.ok, true, phone);
    assert.equal(result.user.portal, 'parent');
    assert.equal(result.user.roleKey, 'PARENT');
    assert.equal(result.user.children.length, 2);
    assert.equal(auth.authenticate(result.token)?.id, 'user-test-parent-sample');
    auth.logout(result.token);
  }
  assert.equal(normalizeGhanaPhone('0247293733'), TEST_PARENT_PHONE);
  assert.equal(auth.loginByPhone({ phone: '0247293734', portal: 'parent' }).ok, false);
  assert.equal(auth.loginByPhone({ phone: '0247293733', portal: 'school' }).ok, false);
});

test('test parent authorization resolves only existing sample students and rejects unrelated IDs', async () => {
  const students = createStudentService({ schoolId });
  const samples = students.seedSampleStudents();
  const parent = createAuthService().loginByPhone({ phone: '0247293733', portal: 'parent' }).user;
  const linked = await authorizeParentStudent({ actor: parent, permanentStudentId: TEST_PARENT_STUDENT_IDS[0], students });
  assert.equal(linked.permanentStudentId, samples[0].permanentStudentId);
  assert.equal(linked.isTestRecord, true);
  const unrelated = await authorizeParentStudent({ actor: parent, permanentStudentId: 'OSAAH/2026/0001', students });
  assert.equal(unrelated, null);
  assert.equal(PARENT_UNLINKED_MESSAGE, 'This student is not linked to your registered parent account.');
});

test('sample students remain excluded from official student counts and ordinary lists', () => {
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  assert.equal(students.listStudents().length, 0);
  assert.equal(students.counts().students, 0);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, 2);
});
