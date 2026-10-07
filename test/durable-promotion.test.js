import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDurablePromotionService } from '../src/durable-promotion.js';

const schoolId = 'school-osaah-daylight';
const years = [
  { id: 'year-2026', name: '2026/2027', startsOn: '2026-09-01' },
  { id: 'year-2027', name: '2027/2028', startsOn: '2027-09-01' }
];
const terms = [
  { id: 'term-3', name: 'Third Term', academicYearId: 'year-2026', startsOn: '2027-05-01' },
  { id: 'term-1-next', name: 'First Term', academicYearId: 'year-2027', startsOn: '2027-09-01' }
];
const classes = [
  { id: 'class-primary-1', name: 'Primary 1', sortOrder: 1 },
  { id: 'class-primary-2', name: 'Primary 2', sortOrder: 2 },
  { id: 'class-jhs-3', name: 'JHS 3', sortOrder: 13 }
];
const makeStudent = (n, classId = 'class-primary-1', { sample = false } = {}) => ({
  id: `student-${n}`, profileId: `profile-${n}`, permanentStudentId: `OSAAH/2026/${String(n).padStart(4, '0')}`,
  enrollmentId: `enrollment-${n}`, classId, academicYearId: 'year-2026', termId: 'term-3',
  enrollmentStatus: 'ACTIVE', isCurrent: 1, isTestRecord: sample ? 1 : 0, studentStatus: 'ACTIVE'
});
function fixture(students = [makeStudent(1), makeStudent(2)], { rejectSortOrder = false } = {}) {
  const calls = [];
  const state = { students: new Map(students.map((student) => [student.id, { ...student }])), decisions: new Map(), enrollments: new Map(students.map((student) => [student.enrollmentId, { ...student, id: student.enrollmentId, studentId: student.id }])), writes: [] };
  const respond = (sql, params = [], target = state) => {
    calls.push({ sql, params });
    if (sql.includes('FROM academic_years') && sql.includes('starts_on>?')) return years.filter((year) => year.startsOn > params[1]).slice(0, 1);
    if (sql.includes('FROM academic_years')) return years.filter((year) => year.id === params[1] || year.name === params[2]);
    if (sql.includes('FROM terms') && sql.includes('JOIN academic_years')) return terms;
    if (sql.includes('FROM terms') && sql.includes('WHERE academic_year_id=? AND (id=? OR name=?)')) return terms.filter((term) => term.academicYearId === params[0] && (term.id === params[1] || term.name === params[2]));
    if (sql.includes('FROM terms WHERE academic_year_id=? ORDER BY')) return terms.filter((term) => term.academicYearId === params[0]).slice(0, 1);
    if (sql.includes('FROM classes WHERE school_id=? AND (id=? OR name=?)')) return classes.filter((item) => item.id === params[1] || item.name === params[2]);
    if (sql.includes('FROM classes WHERE school_id=? ORDER BY')) return classes;
    if (sql.includes('FROM student_enrollments e JOIN students s')) return [...target.students.values()].filter((student) => student.academicYearId === params[1] && student.termId === params[2] && student.classId === params[3] && student.enrollmentStatus === 'ACTIVE' && student.isCurrent === 1 && !student.isTestRecord).map((student) => ({ ...student, firstName: 'Test', lastName: student.id }));
    if (sql.includes('FROM students s JOIN student_profiles sp')) {
      const student = target.students.get(params[1]);
      const enrollment = [...target.enrollments.values()].find((item) => item.studentId === params[1] && item.academicYearId === params[2] && item.termId === params[3] && item.classId === params[4]);
      if (!student || !enrollment) return [];
      return [{ ...student, ...enrollment, id: student.id, profileId: student.profileId, isTestRecord: student.isTestRecord, studentStatus: student.studentStatus, enrollmentId: enrollment.id }];
    }
    if (sql.includes('FROM promotion_decisions WHERE')) {
      const [, profileId, yearId, classId, termId] = params;
      const found = [...target.decisions.values()].find((row) => row.profileId === profileId && row.academicYearId === yearId && row.classId === classId && row.termId === termId);
      return found ? [{ ...found }] : [];
    }
    return [];
  };
  const db = {
    query: async (sql, params) => {
      if (rejectSortOrder && /sort_order/i.test(sql)) throw Object.assign(new Error("Unknown column 'sort_order' in 'order clause'"), { code: 'ER_BAD_FIELD_ERROR', errno: 1054 });
      return respond(sql, params);
    },
    execute: async (sql, params = []) => {
      state.writes.push({ sql, params });
      if (sql.includes('INSERT INTO promotion_decisions')) {
        const row = { id: params[0], profileId: params[2], academicYearId: params[3], classId: params[4], termId: params[5], decision: params[6], toClassId: params[10], nextAcademicYearId: params[11], completionYear: params[13], decidedAt: params[9] };
        state.decisions.set(row.id, row);
      } else if (sql.includes('UPDATE student_enrollments SET is_current=0')) {
        for (const enrollment of state.enrollments.values()) if (enrollment.studentId === params[3] && enrollment.academicYearId === params[4] && enrollment.classId === params[5] && enrollment.isCurrent === 1) { enrollment.isCurrent = 0; enrollment.enrollmentStatus = params[0]; }
        const student = state.students.get(params[3]); if (student) { student.isCurrent = 0; student.enrollmentStatus = params[0]; }
      } else if (sql.includes('INSERT INTO student_enrollments')) {
        const enrollment = { id: params[0], studentId: params[1], schoolId: params[2], permanentStudentId: params[3], academicYearId: params[4], classId: params[6], termId: params[8], enrollmentStatus: 'ACTIVE', isCurrent: 1 };
        state.enrollments.set(enrollment.id, enrollment);
        const student = state.students.get(enrollment.studentId);
        const next = { ...student, enrollmentId: enrollment.id, classId: enrollment.classId, academicYearId: enrollment.academicYearId, termId: enrollment.termId, enrollmentStatus: 'ACTIVE', isCurrent: 1 };
        state.students.set(enrollment.studentId, next);
      } else if (sql.includes("UPDATE students SET student_status='COMPLETED'")) {
        const student = state.students.get(params[1]); if (student) { student.studentStatus = 'COMPLETED'; student.classId = null; }
      }
      return { affectedRows: 1 };
    },
    transaction: async (callback) => {
      const snapshot = structuredClone(state);
      const tx = { query: async (sql, params) => respond(sql, params, state), execute: db.execute };
      try { return await callback(tx); } catch (error) { Object.assign(state, snapshot); throw error; }
    }
  };
  return { service: createDurablePromotionService({ database: db, schoolId, idFactory: (() => { let i = 0; return () => `id-${++i}`; })(), clock: () => '2026-10-07T00:00:00.000Z' }), state, calls };
}
const teacher = { id: 'teacher-1', schoolId, roleKey: 'TEACHER', permissions: new Set(['promotion.write']), assignedClassIds: ['class-primary-1'] };
const context = { academicYearId: 'year-2026', termId: 'term-3', classId: 'class-primary-1' };

test('durable Promotion roster is term-scoped and excludes sample/test students', async () => {
  const { service, calls } = fixture([makeStudent(1), makeStudent(2, 'class-primary-1', { sample: true })]);
  const result = await service.options(context, teacher);
  assert.deepEqual(result.students.map((student) => student.id), ['student-1']);
  const rosterQuery = calls.find(({ sql }) => sql.includes('FROM student_enrollments e JOIN students s'));
  assert.match(rosterQuery.sql, /e\.term_id=\?/);
  assert.match(rosterQuery.sql, /s\.is_test_record/);
  assert.ok(rosterQuery.params.includes('term-3'));
});

test('durable Promotion returns a successful empty roster for valid zero-student context', async () => {
  const { service } = fixture([]);
  assert.deepEqual((await service.options(context, teacher)).students, []);
});

test('durable Promotion options tolerate production classes tables without optional sort_order', async () => {
  const { service, calls } = fixture([], { rejectSortOrder: true });
  const result = await service.options({}, { id: 'owner-1', schoolId, roleKey: 'PROPRIETOR', permissions: new Set(['promotion.write']) });
  assert.deepEqual(result.classes.map(({ id }) => id), classes.map(({ id }) => id));
  assert.ok(calls.filter(({ sql }) => /FROM classes/i.test(sql)).every(({ sql }) => !/sort_order/i.test(sql)));
});

test('bulk promotion validates every student and atomically preserves old enrollments while creating next-year enrollments', async () => {
  const { service, state } = fixture();
  const result = await service.bulkDecide({ ...context, studentIds: ['student-1', 'student-2'], decision: 'PROMOTED' }, teacher);
  assert.equal(result.length, 2);
  for (const studentId of ['student-1', 'student-2']) {
    const student = state.students.get(studentId);
    assert.equal(student.classId, 'class-primary-2');
    assert.equal(student.academicYearId, 'year-2027');
    const old = state.enrollments.get(`enrollment-${studentId.slice(-1)}`);
    assert.equal(old.enrollmentStatus, 'PROMOTED');
    assert.equal(old.isCurrent, 0);
    assert.equal([...state.enrollments.values()].filter((row) => row.studentId === studentId && row.academicYearId === 'year-2027' && row.isCurrent === 1).length, 1);
  }
});

test('replaying the same promotion decision is idempotent and creates no extra enrollment', async () => {
  const { service, state } = fixture([makeStudent(1)]);
  const first = await service.bulkDecide({ ...context, studentIds: ['student-1'], decision: 'PROMOTED' }, teacher);
  const writeCount = state.writes.length;
  const retry = await service.bulkDecide({ ...context, studentIds: ['student-1'], decision: 'PROMOTED' }, teacher);
  assert.equal(retry[0].id, first[0].id);
  assert.equal(retry[0].duplicate, true);
  assert.equal(state.writes.length, writeCount);
});

test('unauthorized class, forged context, and sample/test promotion requests are rejected', async () => {
  const { service } = fixture([makeStudent(1), makeStudent(2, 'class-primary-1', { sample: true })]);
  await assert.rejects(() => service.bulkDecide({ ...context, classId: 'class-primary-2', studentIds: ['student-1'], decision: 'PROMOTED' }, teacher), /outside your assignment/);
  await assert.rejects(() => service.bulkDecide({ ...context, studentIds: ['student-2'], decision: 'PROMOTED' }, teacher), /Sample\/test/);
  await assert.rejects(() => service.bulkDecide({ ...context, studentIds: ['student-1'], decision: 'PROMOTED' }, { ...teacher, assignedClassIds: ['class-primary-2'] }), /outside your assignment/);
});

test('Teachers without an assigned class fail closed for Promotion roster and writes', async () => {
  const { service } = fixture();
  const unassignedTeacher = { ...teacher, assignedClassIds: [] };
  assert.deepEqual((await service.options({}, unassignedTeacher)).classes, []);
  await assert.rejects(() => service.options(context, unassignedTeacher), /outside your assignment/);
  await assert.rejects(() => service.bulkDecide({ ...context, studentIds: ['student-1'], decision: 'PROMOTED' }, unassignedTeacher), /outside your assignment/);
});

test('JHS 3 graduation follows the existing completion/archive status and never enrolls into another class', async () => {
  const { service, state } = fixture([makeStudent(3, 'class-jhs-3')]);
  const jhsTeacher = { ...teacher, assignedClassIds: ['class-jhs-3'] };
  const result = await service.bulkDecide({ ...context, classId: 'class-jhs-3', studentIds: ['student-3'], decision: 'GRADUATED' }, jhsTeacher);
  assert.equal(result[0].completionYear, '2026/2027');
  assert.equal(state.students.get('student-3').studentStatus, 'COMPLETED');
  assert.equal([...state.enrollments.values()].filter((row) => row.studentId === 'student-3' && row.academicYearId === 'year-2027').length, 0);
});

test('Promotion UI uses checkbox selection, Select All, deselection, and submits one deliberate bulk request', () => {
  const html = fs.readFileSync(new URL('../public/promotion.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/promotion.js', import.meta.url), 'utf8');
  assert.match(html, /id="promotion-select-all"/);
  assert.match(html, /Clear selection/);
  assert.match(html, /Save Promotion Decision/);
  assert.match(js, /studentIds: submittedIds/);
  assert.match(js, /promotion\/bulk/);
  assert.match(js, /input\.addEventListener\('change'/);
  assert.match(js, /selectAll\.addEventListener\('change'/);
  assert.match(js, /clearButton\.addEventListener\('click'/);
  assert.match(js, /No students found for the selected class, term and academic year\./);
});

test('promotion migration adds contextual records and unique idempotency without deleting history', () => {
  const sql = fs.readFileSync(new URL('../schema/074_durable_promotion_rollover.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS class_id/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS term_id/);
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_promotion_decision_idempotency/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/);
});
