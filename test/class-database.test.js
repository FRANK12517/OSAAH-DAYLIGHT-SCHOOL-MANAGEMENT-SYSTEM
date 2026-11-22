import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService } from '../src/students.js';
import { createClassDatabaseService } from '../src/class-database.js';

test('Class Database derives current students and canonical parent contact data', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  const actor = { id: 'admin', roleKey: 'SCHOOL_ADMIN', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Nursery 1', admissionYearId: '2026', family: [{ parentId: 'parent-1', fullName: 'Akosua Mensah', primary: true, telephone: '0240000000' }] });
  students.linkParent(student.id, { parentId: 'parent-1', fullName: 'Akosua Mensah', primary: true, telephone: '0240000000' });
  assert.deepEqual(database.list({ classId: 'Nursery 1', academicYear: '2026/2027' }, actor), [{ permanentStudentId: student.permanentStudentId, studentId: student.id, studentName: 'Ama Mensah', gender: 'Not Recorded', parentGuardianName: 'Akosua Mensah', registeredParentPhone: '+233240000000', previousSchool: null, previousClass: null, classId: 'Nursery 1', academicYear: '2026/2027', isTestRecord: false }]);
  assert.equal(database.list({ classId: 'Nursery 1', search: student.permanentStudentId }, actor).length, 1);
  assert.equal(database.list({ classId: 'Nursery 1', search: 'akosua' }, actor).length, 1);
  assert.equal(database.list({ classId: 'Nursery 1', search: '0240000000' }, actor).length, 1);
});

test('transfer admission details are available in Class Database rows', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  const actor = { roleKey: 'SCHOOL_ADMIN', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) };
  students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 1', admissionYearId: '2026', previousSchool: 'Bogoso Basic School', previousClass: 'Basic 2', admissionType: 'TRANSFER' });
  const row = database.list({ classId: 'Primary 1', academicYear: '2026/2027' }, actor)[0];
  assert.equal(row.previousSchool, 'Bogoso Basic School');
  assert.equal(row.previousClass, 'Basic 2');
});

test('class reassignment automatically moves the same canonical student row', () => {
  const students = createStudentService(); const database = createClassDatabaseService({ students }); const actor = { roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) };
  const student = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', classId: 'Primary 3', admissionYearId: '2026' });
  assert.equal(database.list({ classId: 'Primary 3' }, actor)[0].permanentStudentId, student.permanentStudentId);
  students.assignClass(student.id, { classId: 'Primary 4', academicYearId: '2026/2027' });
  assert.equal(database.list({ classId: 'Primary 3' }, actor).length, 0); assert.equal(database.list({ classId: 'Primary 4' }, actor)[0].studentName, 'Kofi Mensah');
});

test('empty class state and missing phone are safe, and unauthorized/cross-school access fails', () => {
  const students = createStudentService(); const database = createClassDatabaseService({ students }); const actor = { roleKey: 'SCHOOL_ADMIN', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) };
  students.createStudent({ firstName: 'Adwoa', surname: 'Asante', classId: 'KG1', admissionYearId: '2026' });
  assert.equal(database.list({ classId: 'KG1' }, actor)[0].registeredParentPhone, 'Not Registered'); assert.deepEqual(database.list({ classId: 'JHS 3' }, actor), []);
  assert.throws(() => database.list({ classId: 'KG1' }, { roleKey: 'PARENT', portal: 'parent', schoolId: 'school-osaah-daylight' }), /Forbidden/);
  assert.throws(() => database.list({ classId: 'KG1' }, { roleKey: 'SCHOOL_ADMIN', schoolId: 'other-school', permissions: new Set(['students.read']) }), /Forbidden/);
});

test('teachers can only view assigned current classes', () => {
  const students = createStudentService(); const database = createClassDatabaseService({ students }); const student = students.createStudent({ firstName: 'Yaw', surname: 'Boateng', classId: 'Primary 4', admissionYearId: '2026' }); const teacher = { roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['Primary 4'], permissions: new Set(['students.read']) };
  assert.equal(database.list({ classId: 'Primary 4' }, teacher)[0].studentId, student.id); assert.throws(() => database.list({ classId: 'JHS 1' }, teacher), /Forbidden/);
});

test('teachers can populate a single-select list with every class while roster rows remain scoped when assigned classes are known', () => {
  const students = createStudentService(); const database = createClassDatabaseService({ students });
  const teacherWithoutResolvedAssignments = { roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: [], permissions: new Set(['students.read']) };
  const teacherWithAssignments = { ...teacherWithoutResolvedAssignments, assignedClassIds: ['Nursery 1'] };
  assert.deepEqual(database.options(teacherWithoutResolvedAssignments).classes, ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  assert.equal(database.list({ classId: 'JHS 1' }, teacherWithoutResolvedAssignments).length, 0);
  assert.throws(() => database.list({ classId: 'JHS 1' }, teacherWithAssignments), /Forbidden/);
});
