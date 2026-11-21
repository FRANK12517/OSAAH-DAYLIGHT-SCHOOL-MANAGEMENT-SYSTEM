import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth.js';
import { normalizeGhanaPhone } from '../src/ghana-phone.js';
import { authorizeParentStudent, PARENT_UNLINKED_MESSAGE } from '../src/parent-authorization.js';
import { createStudentService } from '../src/students.js';
import { createConfiguredTestParent, TEST_PARENT_PHONE, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const schoolId = 'school-osaah-daylight';

test('controlled test parent phone-only login is denied for canonical Ghana phone forms', () => {
  const auth = createAuthService();
  for (const phone of ['0247293733', '+233247293733', '233247293733']) {
    const result = auth.loginByPhone({ phone, portal: 'parent' });
    assert.equal(result.ok, false, phone);
    assert.equal(result.token, undefined);
  }
  assert.equal(normalizeGhanaPhone('0247293733'), TEST_PARENT_PHONE);
  assert.equal(auth.loginByPhone({ phone: '0247293734', portal: 'parent' }).ok, false);
  assert.equal(auth.loginByPhone({ phone: '0247293733', portal: 'school' }).ok, false);
});

test('test parent authorization resolves only existing sample students and rejects unrelated IDs', async () => {
  const students = createStudentService({ schoolId });
  const samples = students.seedSampleStudents();
  const parent = createConfiguredTestParent(schoolId);
  const linked = await authorizeParentStudent({ actor: parent, permanentStudentId: TEST_PARENT_STUDENT_IDS[0], students });
  assert.equal(linked.permanentStudentId, samples[0].permanentStudentId);
  assert.equal(linked.isTestRecord, true);
  const unrelated = await authorizeParentStudent({ actor: parent, permanentStudentId: 'OSAAH/2026/0001', students });
  assert.equal(unrelated, null);
  assert.equal(PARENT_UNLINKED_MESSAGE, 'This student is not linked to your registered parent account.');
});

test('a session child entry cannot authorize an unlinked official student when the relationship service is absent', async () => {
  const students = createStudentService({ schoolId });
  const official = students.createStudent({ firstName: 'Unrelated', surname: 'Student', permanentStudentId: 'OSAAH/2026/0001' });
  const actor = { id: 'parent-1', portal: 'parent', roleKey: 'PARENT', schoolId, children: [{ id: official.id, permanentStudentId: official.permanentStudentId }] };
  assert.equal(await authorizeParentStudent({ actor, permanentStudentId: official.permanentStudentId, students }), null);
});

test('official parent result access is bound to the authenticated parent id, student index, and school', async () => {
  const student = { id: 'internal-student-4', permanentStudentId: 'OSAAH/2026/004', schoolId, isTestRecord: false };
  const calls = [];
  const admissionEnrollment = { authorizeParentStudent: async (scope) => {
    calls.push(scope);
    return scope.parentUserId === 'linked-parent' && scope.permanentStudentId === student.permanentStudentId && scope.schoolId === schoolId ? student : null;
  } };
  const actor = { id: 'linked-parent', portal: 'parent', roleKey: 'PARENT', schoolId, phone: '+233241234567' };
  assert.equal(await authorizeParentStudent({ actor, permanentStudentId: 'OSAAH/2026/004', admissionEnrollment }), student);
  assert.equal(await authorizeParentStudent({ actor: { ...actor, id: 'different-parent' }, permanentStudentId: 'OSAAH/2026/004', admissionEnrollment }), null);
  assert.equal(calls[0].parentUserId, 'linked-parent');
  assert.equal(calls[0].permanentStudentId, 'OSAAH/2026/004');
  assert.equal(calls[0].schoolId, schoolId);
  assert.equal(Object.hasOwn(calls[0], 'phone'), false, 'authorization derives from the signed-in account and canonical link, never a submitted phone');
});

test('sample students remain excluded from official student counts and ordinary lists', () => {
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  assert.equal(students.listStudents().length, 0);
  assert.equal(students.counts().students, 0);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, 2);
});
