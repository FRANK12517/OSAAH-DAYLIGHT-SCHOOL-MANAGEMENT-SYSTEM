import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionPermanentDemoStudents } from '../src/production-demo-students.js';
import { CORE_LEVELS } from '../src/students.js';
import { gradeForTotal } from '../src/grading.js';

function database() {
  const writes = [];
  const queries = [];
  const records = { students: [], profiles: [], links: [], assignments: [], scores: [] };
  const state = { crossSchoolAssignment: false, assignmentScopeMismatch: null, transactionCalls: 0 };
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
    if (sql.includes('FROM schema_migrations')) return [{ version: 84, name: '084_demo_student_class_assignments.sql', checksum: 'sha256-demo' }];
    if (sql.includes('FROM academic_years y JOIN terms t')) return [{ academicYearId: 'year-current', academicYear: '2026/2027', termId: 'term-current', term: 'First Term' }];
    if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return [{ id: 'subject-english', name: 'English Language' }, { id: 'subject-math', name: 'Mathematics' }];
    if (sql.includes('FROM academic_score_records r JOIN student_profiles sp') && sql.includes('LIMIT 2')) {
      const profile = records.profiles.find((item) => item.studentMasterId === params[6] || item.studentId === params[7]);
      return records.scores.filter((score) => score.schoolId === params[0] && score.mockLabel === params[1] && score.academicYearId === params[2] && score.termId === params[3] && score.classId === params[4] && score.subjectId === params[5] && profile?.id === score.profileId).map((score) => ({ id: score.id, totalScore: score.totalScore }));
    }
    if (sql.includes('SELECT COUNT(*) AS scoreCount')) return [{ scoreCount: records.scores.length }];
    if (sql.includes('FROM users u LEFT JOIN user_roles')) return [{ id: 'parent-1', phone: '+233247293733', username: '+233247293733', status: 'ACTIVE', roleKey: 'PARENT' }];
    if (sql.includes('FROM users u') && sql.includes('role_key IN')) return [{ id: 'operator-1', status: 'ACTIVE', roleId: 'role-admin', roleKey: 'SCHOOL_ADMIN' }];
    if (sql.includes('FROM demo_student_class_assignments d') && sql.includes('LEFT JOIN students s')) return state.crossSchoolAssignment ? [{ assignmentSchoolId: 'school-a', studentId: 'demo-master-001', classId: 'class-other', studentSchoolId: 'school-a', classSchoolId: 'school-b' }] : [];
    if (sql.includes('FROM students s') && sql.includes('JOIN classes c ON c.id=? AND c.school_id=?')) {
      const [classId, schoolId, studentId, studentSchoolId] = params;
      if (state.assignmentScopeMismatch === 'class' && classId === 'class-1') return [];
      if (state.assignmentScopeMismatch === 'student') return [];
      const student = records.students.find((item) => item.id === studentId && item.schoolId === studentSchoolId);
      const classRow = CORE_LEVELS.map((name, index) => ({ id: `class-${index + 1}`, name, schoolId: 'school-a' })).find((item) => item.id === classId && item.schoolId === schoolId);
      return student && classRow ? [{ studentId, classId }] : [];
    }
    if (sql.includes('FROM classes WHERE')) return CORE_LEVELS.map((name, index) => ({ id: `class-${index + 1}`, name, schoolId: 'school-a' }));
    if (sql.includes('FROM students WHERE')) return records.students.filter((item) => item.schoolId === params[0] && ([params[1], params[2]].includes(item.permanentStudentId) || [params[3], params[4]].includes(item.admissionNumber)));
    if (sql.includes('FROM student_profiles')) return records.profiles.filter((item) => item.schoolId === params[0] && (item.studentMasterId === params[1] || item.studentId === params[2] || item.studentMasterId === params[1]));
    if (sql.includes('FROM parent_student_links')) {
      if (sql.includes('WHERE student_id=? FOR UPDATE')) return records.links.filter((item) => item.profileId === params[0]);
      return records.links.filter((item) => item.parentUserId === params[0] && item.profileId === params[1]);
    }
    if (sql.includes('FROM demo_student_class_assignments')) return records.assignments.filter((item) => item.schoolId === params[0] && item.studentId === params[1]).map((item) => ({ classId: item.classId }));
    return [];
  };
  const execute = async (sql, params = []) => {
    writes.push({ sql, params });
    if (sql.includes('INSERT INTO students')) records.students.push({ id: params[0], schoolId: params[1], permanentStudentId: params[2], admissionNumber: params[3], firstName: params[4], lastName: params[5], isTestRecord: 1, studentStatus: 'ACTIVE' });
    else if (sql.includes('INSERT INTO student_profiles')) records.profiles.push({ id: params[0], studentMasterId: params[1], studentId: params[2], schoolId: params[3], enrollmentStatus: 'ACTIVE' });
    else if (sql.includes('INSERT INTO parent_student_links')) records.links.push({ parentUserId: params[0], profileId: params[1], permanentStudentId: params[2], phone: params[3], linkStatus: 'ACTIVE' });
    else if (sql.includes('INSERT IGNORE INTO demo_student_class_assignments') && !records.assignments.some((item) => item.schoolId === params[0] && item.studentId === params[1] && item.classId === params[2])) records.assignments.push({ schoolId: params[0], studentId: params[1], classId: params[2] });
    else if (sql.includes('INSERT INTO academic_score_records')) records.scores.push({ id: params[0], schoolId: params[1], mockLabel: params[2], academicYearId: params[3], termId: params[4], classId: params[5], profileId: params[6], subjectId: params[7], totalScore: params[9], grade: params[10], remark: params[11], enteredBy: params[12] });
    return { affectedRows: 1 };
  };
  const adapter = { dialect: 'tidb', query, execute, writes, queries, records, state, transaction: async (callback) => {
    state.transactionCalls += 1;
    const snapshot = structuredClone(records);
    const writeCount = writes.length;
    try { return await callback({ query, execute }); }
    catch (error) { Object.assign(records, snapshot); writes.splice(writeCount); throw error; }
  } };
  return adapter;
}

const scope = { schoolId: 'school-a', parentPhone: '0247293733', expectedDatabase: 'osaahdaylightschool', migrationChecksum: 'sha256-demo' };

test('demo student dry run verifies exact TiDB scope and performs no writes', async () => {
  const db = database();
  const result = await provisionPermanentDemoStudents(db, scope);
  assert.deepEqual(result, { mode: 'DRY_RUN', databaseName: 'osaahdaylightschool', studentCount: 2, existingStudentCount: 0, parentAccountMatched: true, classCount: 13, assignmentCount: 0, mockScoreContext: { academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, mockScoreCount: 12, mockScoresToInsert: 12, mockScoresAlreadyPresent: 0, writesPerformed: false });
  assert.equal(db.writes.length, 0);
});

test('demo student apply idempotently provisions graded JHS mock scores without overwriting existing scores', async () => {
  const db = database();
  await assert.rejects(() => provisionPermanentDemoStudents(db, { ...scope, apply: true }), { code: 'DEMO_APPLY_GUARD_REQUIRED' });
  const result = await provisionPermanentDemoStudents(db, { ...scope, actorUserId: 'operator-1', apply: true, approval: 'PRODUCTION_DEMO_RESTORE_APPROVED', backupReference: 'verified-backup-2026-11-01' });
  assert.equal(result.writesPerformed, true);
  assert.equal(db.state.transactionCalls, 1, 'all provisioning and assignment writes must run inside one transaction');
  assert.equal(result.studentCount, 2);
  assert.deepEqual(db.records.students.map((student) => [student.permanentStudentId, `${student.firstName} ${student.lastName}`]), [
    ['OSAAH/DEMO/001', 'OSAAH Demo Student One'], ['OSAAH/DEMO/002', 'OSAAH Demo Student Two']
  ]);
  assert.equal(result.assignmentsPerStudent, 13);
  assert.equal(result.mockScoreCount, 12);
  assert.equal(result.mockScoresInserted, 12);
  assert.equal(result.mockScoresPersisted, 12);
  assert.equal(db.records.links.length, 2);
  assert.deepEqual(new Set(db.records.links.map((link) => link.parentUserId)), new Set(['parent-1']));
  assert.deepEqual(new Set(db.records.links.map((link) => link.permanentStudentId)), new Set(['OSAAH/DEMO/001', 'OSAAH/DEMO/002']));
  assert.ok(db.records.links.every((link) => link.phone === '+233247293733'));
  assert.equal(db.records.scores.length, 12);
  assert.deepEqual(new Set(db.records.scores.map((score) => score.classId)), new Set(['class-11', 'class-12', 'class-13']));
  assert.deepEqual(new Set(db.records.scores.map((score) => score.mockLabel)), new Set(['1st Mock']));
  assert.ok(db.records.scores.every((score) => score.totalScore >= 0 && score.totalScore <= 100 && score.grade === gradeForTotal(score.totalScore, { classId: 'JHS 1', examination: 'MOCK' })[0] && score.enteredBy === 'operator-1'));
  assert.ok(db.writes.every(({ sql }) => !/INSERT INTO users|INSERT INTO student_enrollments|fee_obligations|student_fee_payments|student_fee_receipts/i.test(sql)));

  db.records.scores[0].totalScore = 100;
  const repeated = await provisionPermanentDemoStudents(db, { ...scope, actorUserId: 'operator-1', apply: true, approval: 'PRODUCTION_DEMO_RESTORE_APPROVED', backupReference: 'verified-backup-2026-11-01' });
  assert.equal(repeated.mockScoresInserted, 0);
  assert.equal(repeated.mockScoresPreserved, 12);
  assert.equal(db.records.scores.length, 12, 'repeated provisioning must not duplicate scores');
  assert.equal(db.records.assignments.length, 26, 'repeated provisioning must not duplicate class assignments');
  assert.equal(db.records.scores[0].totalScore, 100, 'existing sample score edits must remain untouched');
});

test('demo student provisioning rejects a cross-school class assignment before writes', async () => {
  const db = database();
  db.state.crossSchoolAssignment = true;
  await assert.rejects(() => provisionPermanentDemoStudents(db, scope), { code: 'DEMO_ASSIGNMENT_TENANT_CONFLICT' });
  assert.equal(db.writes.length, 0);
});

test('demo student provisioning checks class and student school ownership inside the assignment transaction', async (t) => {
  for (const mismatch of ['class', 'student']) {
    await t.test(`rejects a cross-school ${mismatch}`, async () => {
      const db = database();
      db.state.assignmentScopeMismatch = mismatch;
      await assert.rejects(() => provisionPermanentDemoStudents(db, { ...scope, actorUserId: 'operator-1', apply: true, approval: 'PRODUCTION_DEMO_RESTORE_APPROVED', backupReference: 'verified-backup-2026-11-01' }), { code: 'DEMO_ASSIGNMENT_TENANT_CONFLICT' });
      assert.equal(db.state.transactionCalls, 1);
      assert.equal(db.writes.length, 0, 'transaction rollback must discard all writes after the scope conflict');
      assert.equal(db.records.assignments.length, 0);
    });
  }
});

test('demo student restoration rejects a mismatched database before writes', async () => {
  const db = database();
  db.query = async (sql) => sql.includes('SELECT DATABASE()') ? [{ databaseName: 'other-database' }] : [];
  await assert.rejects(() => provisionPermanentDemoStudents(db, scope), { code: 'DEMO_DATABASE_TARGET_MISMATCH' });
  assert.equal(db.writes.length, 0);
});
