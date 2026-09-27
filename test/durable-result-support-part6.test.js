import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAcademicService, summarizeDurableAttendance } from '../src/durable-academic.js';

const schoolId = 'school-a';
const classId = 'class-basic-1';
const studentId = 'master-student-1';
const actor = { id: 'reader-1', schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['results.read']) };
const score = { id: 'score-1', studentId, permanentStudentId: 'ODSC-0001', firstName: 'Ama', middleName: '', surname: 'Mensah', gender: 'Female', classId, subjectId: 'math', subjectName: 'Mathematics', caScore: 40, examScore: 45, totalScore: 85 };

function fixture({ attendance = [], classTeacherRows = [{ staffId: 'staff-1', userId: 'teacher-user', name: 'Teacher One', phone: '0241234567' }], heads = [{ staffId: 'staff-2', userId: 'head-user', name: 'Head One', phone: '0241234568' }], signatures = [] } = {}) {
  const calls = [];
  const database = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM classes c WHERE')) return [{ id: classId, name: 'Basic 1', school_id: schoolId, status: 'ACTIVE' }];
      if (sql.includes('FROM academic_years WHERE')) return [{ id: 'year-1', name: '2026/2027' }];
      if (sql.includes('FROM terms t JOIN academic_years')) return [{ id: 'term-1', name: 'First Term' }];
      if (sql.includes('FROM canonical_academic_scores r')) return [score];
      if (sql.includes('FROM canonical_ges_assessments')) return [];
      if (sql.includes('SELECT DISTINCT s.id,s.gender')) return [{ id: studentId, gender: 'Female' }];
      if (sql.includes('FROM student_attendance a')) return attendance;
      if (sql.includes('FROM staff_assignments a')) return classTeacherRows;
      if (sql.includes('FROM staff_profiles sp JOIN users')) return heads;
      if (sql.includes('FROM result_signatures')) {
        const [requestedSchool, staffId, type, requestedClass, requestedYear] = params;
        return signatures.filter((item) => item.schoolId === requestedSchool && item.staffId === staffId && item.type === type && item.active &&
          (type !== 'CLASS_TEACHER' || (item.classId === requestedClass && item.academicYear === requestedYear)))
          .map((item) => ({ id: item.id, signatureUrl: item.signatureUrl }));
      }
      return [];
    },
    async execute() { throw new Error('This read-only result test must not write.'); }
  };
  return { database, calls };
}

const getResult = (database, signatures = { resolveForStudent() { throw new Error('Map resolver must not be called for a real result'); } }) =>
  createDurableAcademicService({ database, schoolId, signatures }).result({ studentId, classId, academicYear: '2026/2027', term: 'First Term' }, actor);

test('daily attendance collapse counts consistent subject rows once and gives the canonical daily row priority', () => {
  const value = summarizeDurableAttendance([
    { date: '2026-09-01', status: 'PRESENT', subjectKey: 'math' },
    { date: '2026-09-01', status: 'PRESENT', subjectKey: 'english' },
    { date: '2026-09-02', status: 'ABSENT', subjectKey: 'math' },
    { date: '2026-09-02', status: 'PRESENT', subjectKey: 'daily' },
    { date: '2026-09-02', status: 'ABSENT', subjectKey: 'english' }
  ]);
  assert.deepEqual(value, { timesPresent: 2, timesAbsent: 0, totalSchoolDays: null, conflictingDays: 0, otherStatusCounts: {} });
});

test('conflicting subject rows stay unclassified; unknown statuses are reported and missing dates are not absent', () => {
  assert.deepEqual(summarizeDurableAttendance([
    { date: '2026-09-01', status: 'PRESENT', subjectKey: 'math' },
    { date: '2026-09-01', status: 'ABSENT', subjectKey: 'english' },
    { date: '2026-09-02', status: 'TRUANT', subjectKey: 'daily' }
  ]), { timesPresent: 0, timesAbsent: 0, totalSchoolDays: null, conflictingDays: 1, otherStatusCounts: { 'UNSUPPORTED:TRUANT': 1 } });
  assert.deepEqual(summarizeDurableAttendance([]), { timesPresent: null, timesAbsent: null, totalSchoolDays: null, conflictingDays: 0, otherStatusCounts: {} });
});

test('real result uses production date, school/period scope, and student_profiles identity bridge', async () => {
  const { database, calls } = fixture({ attendance: [{ date: '2026-09-01', status: 'PRESENT', subjectKey: 'daily' }] });
  const result = await getResult(database);
  const query = calls.find((item) => item.sql.includes('FROM student_attendance a'));
  assert.match(query.sql, /a\.date/);
  assert.doesNotMatch(query.sql, /attendance_date/);
  assert.match(query.sql, /student_profiles sp ON sp\.student_master_id=s\.id/);
  assert.match(query.sql, /sp\.student_id=s\.permanent_student_id/);
  assert.match(query.sql, /a\.student_id=sp\.id/);
  assert.match(query.sql, /a\.school_id=\?/);
  assert.match(query.sql, /a\.class_id=\?/);
  assert.match(query.sql, /a\.academic_year=\?/);
  assert.match(query.sql, /a\.term=\?/);
  assert.deepEqual(query.params, [studentId, schoolId, schoolId, schoolId, studentId, classId, '2026/2027', 'First Term', 'term-1']);
  assert.deepEqual(result.attendance, { timesPresent: 1, timesAbsent: 0, totalSchoolDays: null, conflictingDays: 0, otherStatusCounts: {} });
});

test('durable signatories follow historical assignment and persisted school-scoped active signatures', async () => {
  const signatures = [
    { id: 'teacher-signature', schoolId, staffId: 'staff-1', type: 'CLASS_TEACHER', classId, academicYear: '2026/2027', active: true, signatureUrl: 'signatures/teacher.png' },
    { id: 'inactive-signature', schoolId, staffId: 'staff-1', type: 'CLASS_TEACHER', classId, academicYear: '2026/2027', active: false, signatureUrl: 'signatures/inactive.png' },
    { id: 'wrong-school', schoolId: 'school-other', staffId: 'staff-1', type: 'CLASS_TEACHER', classId, academicYear: '2026/2027', active: true, signatureUrl: 'signatures/foreign.png' },
    { id: 'head-signature', schoolId, staffId: 'staff-2', type: 'HEADTEACHER', active: true, signatureUrl: 'signatures/head.png' }
  ];
  const { database, calls } = fixture({ signatures });
  const result = await getResult(database);
  assert.deepEqual(result.signatures, [
    { signatoryRole: 'CLASS_TEACHER', name: 'Teacher One', phone: '0241234567', id: 'teacher-signature', signatureUrl: 'signatures/teacher.png' },
    { signatoryRole: 'HEADTEACHER', name: 'Head One', phone: '0241234568', id: 'head-signature', signatureUrl: 'signatures/head.png' }
  ]);
  const assignmentQuery = calls.find((item) => item.sql.includes('FROM staff_assignments a'));
  assert.match(assignmentQuery.sql, /a\.class_id=\?/);
  assert.match(assignmentQuery.sql, /a\.academic_year_id=\?/);
  assert.match(assignmentQuery.sql, /a\.term_id=\?/);
  assert.match(assignmentQuery.sql, /staff_profiles sp ON sp\.id=a\.staff_id/);
  assert.match(assignmentQuery.sql, /users u ON u\.id=sp\.user_id/);
  assert.deepEqual(assignmentQuery.params, [schoolId, classId, 'year-1', 'term-1']);
  const teacherSignatureQuery = calls.find((item) => item.sql.includes('FROM result_signatures') && item.params[2] === 'CLASS_TEACHER');
  assert.match(teacherSignatureQuery.sql, /school_id=\?.*staff_id=\?.*signature_type=\?.*is_active=1/s);
  assert.match(teacherSignatureQuery.sql, /class_id=\?.*academic_year=\?/);
  assert.deepEqual(teacherSignatureQuery.params, [schoolId, 'staff-1', 'CLASS_TEACHER', classId, '2026/2027']);
  assert.match(calls.find((item) => item.sql.includes("r.role_key='HEADTEACHER'")).sql, /u\.status='ACTIVE'/);
});

test('ambiguous historical class teacher or current headteacher is not selected arbitrarily', async () => {
  const { database } = fixture({ classTeacherRows: [
    { staffId: 'staff-1', userId: 'teacher-user-1', name: 'Teacher One' },
    { staffId: 'staff-3', userId: 'teacher-user-3', name: 'Teacher Three' }
  ], heads: [] });
  const result = await getResult(database);
  assert.equal(result.signatures.find((item) => item.signatoryRole === 'CLASS_TEACHER').name, null);
  assert.equal(result.signatures.find((item) => item.signatoryRole === 'HEADTEACHER').name, null);
});

test('real result never falls back to the process-local signature Map', async () => {
  const { database, calls } = fixture();
  const result = await getResult(database);
  assert.equal(result.isSample, false);
  assert.ok(calls.some((item) => item.sql.includes('FROM result_signatures')));
});

test('sample requests cannot enter the durable real-result reader', async () => {
  const { database, calls } = fixture();
  await assert.rejects(() => createDurableAcademicService({ database, schoolId }).result({ sample: true }, actor), { code: 'SAMPLE_RESULT_ROUTE_REQUIRED' });
  assert.equal(calls.length, 0);
});
