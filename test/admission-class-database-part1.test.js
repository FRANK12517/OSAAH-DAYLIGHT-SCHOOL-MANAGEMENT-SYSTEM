import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalClassId, displayClassName } from '../src/student-classes.js';
import { createAdmissionFormService } from '../src/admission-form.js';
import { createStudentService } from '../src/students.js';
import { createClassDatabaseService } from '../src/class-database.js';

test('admission class aliases resolve to canonical class IDs without duplicate identities', () => {
  assert.equal(canonicalClassId('Basic 3'), 'Primary 3');
  assert.equal(canonicalClassId('KG 2'), 'KG2');
  assert.equal(canonicalClassId('Nursery 2'), 'Nursery 2');
  assert.equal(displayClassName('KG2'), 'KG 2');
});

test('new admission stores canonical class label and canonical gender', () => {
  const admissions = createAdmissionFormService();
  const application = admissions.createApplication({ studentSurname: 'Student', studentFirstName: 'Test', classAppliedFor: 'Basic 3', gender: 'F', dateOfBirth: '2018-01-01' }, { portal: 'parent', id: 'parent-1' });
  assert.equal(application.section1.classAppliedFor, 'Basic 3');
  assert.equal(application.section1.gender, 'Female');
});

test('canonical student enrollment is immediately visible in the selected class database', () => {
  const students = createStudentService();
  const classDatabase = createClassDatabaseService({ students });
  const student = students.createStudent({ firstName: 'Test', surname: 'Student', gender: 'Female', classId: canonicalClassId('Basic 3'), admissionYearId: '2026', family: [{ fullName: 'Test Parent', telephone: '0240000000', primary: true }] });
  const rows = classDatabase.list({ classId: 'Primary 3', academicYear: '2026/2027' }, { roleKey: 'SCHOOL_ADMIN', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { permanentStudentId: student.permanentStudentId, studentId: student.id, studentName: 'Test Student', gender: 'Female', parentGuardianName: 'Test Parent', registeredParentPhone: '0240000000', classId: 'Primary 3', academicYear: '2026/2027', isTestRecord: false });
});
