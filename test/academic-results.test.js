import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createSignatureService } from '../src/signatures.js';
import { createStaffService } from '../src/staff.js';
import { createAcademicResultsService, RESULT_HEADER_ASSET } from '../src/academic-results.js';

test('academic results persist terminal and mock scores with native Osaah IDs', async () => {
  const students = createStudentService({ now: () => '2026-09-02T00:00:00.000Z' });
  const subjects = createSubjectService({ now: () => '2026-09-02T00:00:00.000Z' });
  const signatures = createSignatureService({ now: () => '2026-09-02T00:00:00.000Z' });
  const results = createAcademicResultsService({ students, subjects, signatures, now: () => '2026-09-02T00:00:00.000Z' });
  const manager = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const teacher = { id: 'teacher-1', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['Primary 1'], assignedSubjectIds: [] , permissions: new Set(['marks.write', 'mock.scores.write', 'results.read', 'mock.results.read']) };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 1', admissionYearId: '2026' });
  assert.equal(student.permanentStudentId, 'OSAAH/2026/0001');
  const subject = subjects.list({}, teacher)[0];
  const saved = results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 42, examScore: 45 }, teacher);
  assert.equal(saved.totalScore, 87);
  const edited = results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 44 }, teacher);
  assert.equal(edited.id, saved.id);
  assert.equal(edited.totalScore, 84);
  const mock = results.saveMockScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', caScore: 30, examScore: 35 }, teacher);
  assert.equal(mock.totalScore, 65);
  assert.equal(results.listScores({ academicYear: '2026/2027' }, teacher).length, 1);
  assert.equal(results.listScores({ academicYear: '2026/2027' }, teacher, { mock: true }).length, 1);
  signatures.upload({ signatoryRole: 'HEADTEACHER', mimeType: 'image/png', size: 100, storageKey: 'signatures/headteacher.png' }, manager);
  const report = results.result({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, teacher);
  assert.equal(report.studentIndexNumber, 'OSAAH/2026/0001');
  assert.equal(report.subjects[0].grade, 'A');
  assert.equal(report.signatures.length, 1);
  assert.equal(results.result({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, teacher, { mock: true }).resultType, 'MOCK');
  assert.throws(() => results.saveScore({ studentId: student.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 1, examScore: 1 }, teacher), /assignment|enrolled/);
  await access(new URL(`../public${RESULT_HEADER_ASSET}`, import.meta.url));
  const resultPage = await readFile(new URL('../public/results.html', import.meta.url), 'utf8');
  assert.match(resultPage, /result-header/);
});


test('result signatures resolve by assigned class, academic context, and school scope', () => {
  const staff = createStaffService();
  const classes = ['Nursery', 'KG1', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'];
  const students = createStudentService();
  const subjects = createSubjectService({ classes });
  const signatures = createSignatureService({ staff, classes });
  const results = createAcademicResultsService({ students, subjects, signatures, classes });
  const manager = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const teacherA = staff.createProfile({ fullName: 'Teacher A', roleKey: 'TEACHER' });
  const teacherB = staff.createProfile({ fullName: 'Teacher B', roleKey: 'TEACHER' });
  const head = staff.createProfile({ fullName: 'Headteacher One', roleKey: 'HEADTEACHER' });
  staff.assign(teacherA.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  staff.assign(teacherB.id, { classId: 'Primary 2', academicYearId: '2026/2027', termId: 'First Term' });
  const studentA = students.createStudent({ firstName: 'Ama', surname: 'One', classId: 'Primary 1', admissionYearId: '2026' });
  const studentB = students.createStudent({ firstName: 'Kojo', surname: 'Two', classId: 'Primary 2', admissionYearId: '2026' });
  const subject = subjects.list({}, manager)[0];
  for (const [student, classId, teacher] of [[studentA, 'Primary 1', teacherA], [studentB, 'Primary 2', teacherB]]) {
    results.saveScore({ studentId: student.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 40 }, { ...teacher, schoolId: manager.schoolId, permissions: new Set(['marks.write', 'results.read']) });
  }
  signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacherA.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 100, storageKey: 'signatures/teacher-a.png' }, manager);
  signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 2', teacherId: teacherB.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 100, storageKey: 'signatures/teacher-b.png' }, manager);
  signatures.upload({ signatoryRole: 'HEADTEACHER', academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 100, storageKey: 'signatures/head.png' }, manager);
  assert.throws(() => signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacherB.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 100, storageKey: 'signatures/invalid.png' }, manager), /assigned/);
  const reportA = results.result({ studentId: studentA.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, manager);
  const reportB = results.result({ studentId: studentB.id, classId: 'Primary 2', academicYear: '2026/2027', term: 'First Term' }, manager);
  assert.deepEqual(reportA.signatures.map((item) => item.storageKey), ['signatures/teacher-a.png', 'signatures/head.png']);
  assert.deepEqual(reportB.signatures.map((item) => item.storageKey), ['signatures/teacher-b.png', 'signatures/head.png']);
  assert.equal(reportA.signatures[0].name, teacherA.fullName);
  assert.equal(signatures.options(manager).classes.length, classes.length);
  assert.equal(signatures.options(manager).teachers.length, 2);
  assert.equal(signatures.resolveForStudent(studentA, { academicYear: '2027/2028', term: 'First Term' }).classTeacher.signature, null);
  assert.equal(head.fullName, 'Headteacher One');
});

test('result publication is scoped to assigned teachers and records publication metadata', () => {
  const results = createAcademicResultsService({ classes: ['KG 1', 'JHS 3'], now: () => '2026-09-10T10:00:00.000Z' });
  const teacher = { id: 'teacher-1', userId: 'teacher-1', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['results.publish']), assignedClassIds: ['KG 1'] };
  assert.throws(() => results.publishResults({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 3' }, teacher), /assignment/);
  const publication = results.publishResults({ academicYear: '2026/2027', term: 'First Term', classId: 'KG 1' }, teacher);
  assert.deepEqual(results.publicationFor({ academicYear: '2026/2027', term: 'First Term', classId: 'KG 1' }), publication);
  assert.equal(publication.publishedBy, 'teacher-1');
});
