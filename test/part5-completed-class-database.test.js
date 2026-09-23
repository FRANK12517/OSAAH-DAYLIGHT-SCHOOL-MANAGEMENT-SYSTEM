import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createExaminationService } from '../src/examinations.js';
import { createClassDatabaseService } from '../src/class-database.js';
import { visibleSidebar } from '../src/sidebar-registry.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'part5-headteacher', userId: 'part5-headteacher', roleKey: 'HEADTEACHER', portal: 'school', schoolId, permissions: new Set(['students.read', 'promotion.write']) };
const years = { source: '2028/2029', completionA: '2029', completionB: '2030', term: 'Third Term' };

function setup() {
  const students = createStudentService();
  const examinations = createExaminationService({ students, classes: CORE_LEVELS });
  const classDatabase = createClassDatabaseService({ students, classes: CORE_LEVELS, academicYears: ['2028/2029', '2029/2030'] });
  return { students, examinations, classDatabase };
}

function admit(students, input = {}) {
  return students.createStudent({ firstName: input.firstName ?? 'Test', surname: input.surname ?? 'Graduate', gender: input.gender ?? 'Male', classId: 'JHS 3', academicYearId: years.source, termId: years.term, admissionDate: '2028-09-01' });
}

test('authorized JHS 3 completion moves the canonical student to the archive without losing history', () => {
  const { students, examinations, classDatabase } = setup();
  const graduate = admit(students, { firstName: 'Kofi', surname: 'Graduate', gender: 'Male' });
  students.linkParent(graduate.id, { parentId: 'parent-kofi', fullName: 'Kwame Graduate', telephone: '0244000000', primary: true });
  const permanentId = graduate.permanentStudentId;
  const result = examinations.complete(graduate.id, { completionYear: years.completionA, academicYearId: years.source, termId: years.term }, actor);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.permanentStudentId, permanentId);
  assert.equal(students.listStudents({}).some((item) => item.id === graduate.id), false);
  assert.equal(classDatabase.list({ classId: 'JHS 3' }, actor).some((row) => row.studentId === graduate.id), false);
  const historical = classDatabase.list({ academicYear: years.source, classId: 'JHS 3', search: permanentId }, actor);
  assert.equal(historical.length, 1);
  const archive = classDatabase.listCompleted({ completionYear: years.completionA, search: permanentId }, actor);
  assert.equal(archive.length, 1);
  assert.deepEqual(archive[0], { permanentStudentId: permanentId, studentId: graduate.id, studentName: 'Kofi Graduate', gender: 'Male', parentGuardianName: 'Kwame Graduate', registeredParentPhone: archive[0].registeredParentPhone, classId: null, academicYear: null, completionYear: years.completionA, isTestRecord: false });
  assert.match(archive[0].registeredParentPhone, /0244|233244/);
  assert.deepEqual(classDatabase.completedOptions(actor).completionYears, [years.completionA]);
  const retry = examinations.complete(graduate.id, { completionYear: years.completionA }, actor);
  assert.equal(retry.permanentStudentId, permanentId);
  assert.equal(students.getStudent(graduate.id).history.filter((entry) => entry.reason === 'COMPLETION').length, 1);
});

test('JHS 3 repetition remains active and never appears in the completed archive', () => {
  const { students, examinations, classDatabase } = setup();
  const repeater = admit(students, { firstName: 'Adwoa', surname: 'Repeater', gender: 'Female' });
  const permanentId = repeater.permanentStudentId;
  const result = examinations.promote(repeater.id, years.source, 'REPEAT', actor, null, { classId: 'JHS 3', termId: years.term, nextAcademicYearId: '2029/2030', nextTermId: 'First Term' });
  assert.equal(result.toClassId, 'JHS 3');
  assert.equal(students.getStudent(repeater.id).status, undefined);
  assert.equal(classDatabase.listCompleted({ search: permanentId }, actor).length, 0);
  assert.equal(classDatabase.list({ academicYear: '2029/2030', classId: 'JHS 3', search: permanentId }, actor).length, 1);
});

test('archive year filtering, all four searches, and sibling records remain correctly scoped', () => {
  const { students, examinations, classDatabase } = setup();
  const older = admit(students, { firstName: 'Kofi', surname: 'Mensah', gender: 'Male' });
  const newer = admit(students, { firstName: 'Ama', surname: 'Mensah', gender: 'Female' });
  students.linkParent(older.id, { parentId: 'shared-parent', fullName: 'Kwame Mensah', telephone: '0205000000', primary: true });
  students.linkParent(newer.id, { parentId: 'shared-parent', fullName: 'Kwame Mensah', telephone: '0205000000', primary: true });
  examinations.complete(older.id, { completionYear: years.completionA, academicYearId: years.source, termId: years.term }, actor);
  examinations.complete(newer.id, { completionYear: years.completionB, academicYearId: years.source, termId: years.term }, actor);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionA }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionB }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionA, search: older.permanentStudentId }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionA, search: 'kofi mensah' }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionA, search: 'kwame mensah' }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ completionYear: years.completionA, search: '0205000000' }, actor).length, 1);
  assert.equal(classDatabase.listCompleted({ search: 'kwame mensah' }, actor).length, 2);
  assert.equal(classDatabase.listCompleted({ completionYear: '2099' }, actor).length, 0);
});

test('completion rollback prevents a partial archive when completion processing fails', () => {
  const { students, examinations, classDatabase } = setup();
  const graduate = admit(students, { firstName: 'Rollback', surname: 'Graduate' });
  const originalComplete = students.completeStudent;
  students.completeStudent = (...args) => { const result = originalComplete(...args); throw new Error('simulated completion failure'); };
  assert.throws(() => examinations.complete(graduate.id, { completionYear: years.completionA, academicYearId: years.source, termId: years.term }, actor), /simulated completion failure/);
  students.completeStudent = originalComplete;
  assert.equal(students.getStudent(graduate.id).status, undefined);
  assert.equal(students.getStudent(graduate.id).classId, 'JHS 3');
  assert.equal(classDatabase.listCompleted({ search: graduate.permanentStudentId }, actor).length, 0);
});

test('archive page exposes required fields, deterministic empty state, and exact role routes', () => {
  const html = fs.readFileSync(new URL('../public/completed-class-database.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/completed-class-database.js', import.meta.url), 'utf8');
  assert.match(html, /COMPLETED CLASS DATABASE/);
  assert.match(html, /Completion Year/);
  assert.match(html, /Gender/);
  assert.match(html, /Registered Parent Phone Number/);
  assert.match(html, /overflow:auto/);
  assert.match(client, /row\.gender/);
  assert.match(client, /No completed students were found for the selected year/);
  for (const roleKey of ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']) {
    const groups = visibleSidebar({ permissions: new Set(['students.read']), roleKey, portal: 'school' });
    const module = groups.flatMap((group) => group.modules).find((item) => item.moduleKey === 'completed-class-database');
    assert.equal(module?.route, '/completed-class-database.html', roleKey);
  }
});

test('completed archive is authenticated, school-scoped, and never parent-public', () => {
  const { students, examinations, classDatabase } = setup();
  const graduate = admit(students, { firstName: 'Private', surname: 'Graduate' });
  examinations.complete(graduate.id, { completionYear: years.completionA, academicYearId: years.source, termId: years.term }, actor);
  assert.throws(() => classDatabase.listCompleted({}, { portal: 'parent', roleKey: 'PARENT', schoolId }), /Forbidden/);
  assert.throws(() => classDatabase.listCompleted({ search: graduate.permanentStudentId }, { roleKey: 'HEADTEACHER', schoolId: 'other-school', permissions: new Set(['students.read']) }), /Forbidden/);
});
