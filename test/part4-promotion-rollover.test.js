import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createExaminationService } from '../src/examinations.js';
import { createClassDatabaseService } from '../src/class-database.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'part4-headteacher', userId: 'part4-headteacher', roleKey: 'HEADTEACHER', portal: 'school', schoolId, permissions: new Set(['students.read', 'promotion.write']) };
const teacherViewer = { ...actor, roleKey: 'TEACHER', permissions: new Set(['students.read']), assignedClassIds: CORE_LEVELS };
const currentYear = '2026/2027';
const nextYear = '2027/2028';
const currentTerm = 'Third Term';
const nextTerm = 'First Term';

function setup() {
  const students = createStudentService();
  const examinations = createExaminationService({ students, classes: CORE_LEVELS });
  const classDatabase = createClassDatabaseService({ students, classes: CORE_LEVELS });
  return { students, examinations, classDatabase };
}

function admit(students, input) {
  return students.createStudent({ ...input, admissionDate: '2026-09-01', academicYearId: currentYear, termId: currentTerm });
}

test('individual promotion moves Class Database membership while preserving historical identity and parent data', () => {
  const { students, examinations, classDatabase } = setup();
  const kofi = admit(students, { firstName: 'Kofi', surname: 'Test', gender: 'Male', classId: 'Primary 1' });
  students.linkParent(kofi.id, { parentId: 'parent-kofi', fullName: 'Kwame Test', telephone: '0244000000', primary: true });
  const permanentId = kofi.permanentStudentId;
  const result = examinations.promote(kofi.id, currentYear, 'PROMOTED', actor, 'Promoted for next academic year', { classId: 'Primary 1', termId: currentTerm, toClassId: 'Primary 2', nextAcademicYearId: nextYear, nextTermId: nextTerm });
  assert.equal(result.toClassId, 'Primary 2');
  const oldRows = classDatabase.list({ academicYear: currentYear, classId: 'Primary 1', search: permanentId }, teacherViewer);
  const newRows = classDatabase.list({ academicYear: nextYear, classId: 'Primary 2', search: permanentId }, teacherViewer);
  assert.equal(oldRows.length, 1);
  assert.equal(newRows.length, 1);
  assert.equal(newRows[0].studentName, 'Kofi Test');
  assert.equal(newRows[0].gender, 'Male');
  assert.equal(newRows[0].parentGuardianName, 'Kwame Test');
  assert.match(newRows[0].registeredParentPhone, /0244|233244/);
  assert.equal(newRows[0].permanentStudentId, permanentId);
  assert.equal(students.getStudent(kofi.id).history.length, 2);
  assert.equal(students.getStudent(kofi.id).history[0].classId, 'Primary 1');
  assert.equal(students.getStudent(kofi.id).history[1].classId, 'Primary 2');
  const retry = examinations.promote(kofi.id, currentYear, 'PROMOTED', actor, null, { classId: 'Primary 1', termId: currentTerm, toClassId: 'Primary 2', nextAcademicYearId: nextYear, nextTermId: nextTerm });
  assert.equal(retry.id, result.id);
  assert.equal(students.getStudent(kofi.id).history.length, 2);
});

test('repetition creates same-class next-year enrollment without promotion or duplication', () => {
  const { students, examinations, classDatabase } = setup();
  const adwoa = admit(students, { firstName: 'Adwoa', surname: 'Test', gender: 'Female', classId: 'Primary 2' });
  const permanentId = adwoa.permanentStudentId;
  const result = examinations.promote(adwoa.id, currentYear, 'REPEAT', actor, null, { classId: 'Primary 2', termId: currentTerm, nextAcademicYearId: nextYear, nextTermId: nextTerm });
  assert.equal(result.toClassId, 'Primary 2');
  assert.equal(classDatabase.list({ academicYear: currentYear, classId: 'Primary 2', search: permanentId }, teacherViewer).length, 1);
  assert.equal(classDatabase.list({ academicYear: nextYear, classId: 'Primary 2', search: permanentId }, teacherViewer).length, 1);
  assert.equal(classDatabase.list({ academicYear: nextYear, classId: 'Primary 3', search: permanentId }, teacherViewer).length, 0);
  assert.equal(students.getStudent(adwoa.id).permanentStudentId, permanentId);
  assert.equal(students.getStudent(adwoa.id).gender, 'Female');
  assert.equal(students.listStudents({}).filter((item) => item.permanentStudentId === permanentId).length, 1);
});

test('bulk promotion supports mixed destinations and preserves exactly one next-year enrollment per student', () => {
  const { students, examinations, classDatabase } = setup();
  const promoted = Array.from({ length: 8 }, (_, index) => admit(students, { firstName: `Promoted${index + 1}`, surname: 'Test', classId: 'Primary 4' }));
  const repeated = Array.from({ length: 2 }, (_, index) => admit(students, { firstName: `Repeated${index + 1}`, surname: 'Test', classId: 'Primary 4' }));
  const decisions = [...promoted.map((item) => ({ studentId: item.id, decision: 'PROMOTED' })), ...repeated.map((item) => ({ studentId: item.id, decision: 'REPEAT' }))];
  const result = examinations.bulkPromote({ academicYearId: currentYear, classId: 'Primary 4', termId: currentTerm, toClassId: 'Primary 5', nextAcademicYearId: nextYear, nextTermId: nextTerm, decisions }, actor);
  assert.equal(result.length, 10);
  assert.equal(classDatabase.list({ academicYear: nextYear, classId: 'Primary 5' }, teacherViewer).filter((row) => promoted.some((item) => item.id === row.studentId)).length, 8);
  assert.equal(classDatabase.list({ academicYear: nextYear, classId: 'Primary 4' }, teacherViewer).filter((row) => repeated.some((item) => item.id === row.studentId)).length, 2);
  assert.equal(new Set(students.listStudents({}).map((item) => item.permanentStudentId)).size, 10);
});

test('bulk promotion rolls back all enrollment changes when a later decision fails', () => {
  const { students, examinations } = setup();
  const first = admit(students, { firstName: 'First', surname: 'Rollback', classId: 'Primary 4' });
  const second = admit(students, { firstName: 'Second', surname: 'Rollback', classId: 'Primary 4' });
  const before = new Map([first, second].map((item) => [item.id, students.getStudent(item.id)]));
  const originalAssign = students.assignClass;
  let calls = 0;
  students.assignClass = (...args) => { calls += 1; if (calls === 2) throw new Error('simulated enrollment failure'); return originalAssign(...args); };
  assert.throws(() => examinations.bulkPromote({ academicYearId: currentYear, classId: 'Primary 4', termId: currentTerm, toClassId: 'Primary 5', nextAcademicYearId: nextYear, nextTermId: nextTerm, decisions: [{ studentId: first.id, decision: 'PROMOTED' }, { studentId: second.id, decision: 'PROMOTED' }] }, actor), /simulated enrollment failure/);
  students.assignClass = originalAssign;
  for (const item of [first, second]) {
    const after = students.getStudent(item.id);
    assert.equal(after.classId, before.get(item.id).classId);
    assert.deepEqual(after.history, before.get(item.id).history);
  }
});

test('JHS 3 repeat remains JHS 3 and invalid advancement is rejected', () => {
  const { students, examinations, classDatabase } = setup();
  const repeater = admit(students, { firstName: 'Yaw', surname: 'Repeater', classId: 'JHS 3' });
  const permanentId = repeater.permanentStudentId;
  const repeated = examinations.promote(repeater.id, currentYear, 'REPEAT', actor, null, { classId: 'JHS 3', termId: currentTerm, nextAcademicYearId: nextYear, nextTermId: nextTerm });
  assert.equal(repeated.toClassId, 'JHS 3');
  assert.equal(classDatabase.list({ academicYear: nextYear, classId: 'JHS 3', search: permanentId }, teacherViewer).length, 1);
  const invalid = admit(students, { firstName: 'Invalid', surname: 'Advancement', classId: 'JHS 3' });
  assert.throws(() => examinations.promote(invalid.id, currentYear, 'PROMOTED', actor, null, { classId: 'JHS 3', termId: currentTerm, toClassId: 'JHS 4', nextAcademicYearId: nextYear, nextTermId: nextTerm }), /terminal class/);
  assert.equal(students.getStudent(invalid.id).classId, 'JHS 3');
  assert.equal(students.getStudent(invalid.id).history.length, 1);
  assert.equal(students.getStudent(invalid.id).permanentStudentId !== permanentId, true);
});

test('same academic context cannot acquire conflicting active classes', () => {
  const { students } = setup();
  const student = admit(students, { firstName: 'Conflict', surname: 'Test', classId: 'Primary 1' });
  assert.throws(() => students.assignClass(student.id, { classId: 'Primary 2', academicYearId: currentYear, termId: currentTerm }), /Conflicting active enrollment/);
});
