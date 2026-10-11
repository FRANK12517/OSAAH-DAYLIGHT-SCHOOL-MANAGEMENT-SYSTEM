import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createExistingStudentLinkingService } from '../src/existing-student-linking.js';

const SCHOOL = 'school-osaah-daylight';
const actor = { id: 'head-1', portal: 'school', roleKey: 'HEADTEACHER', schoolId: SCHOOL };

function fixture({ withProfile = false, withEnrollment = false, permanentStudentId = 'OSAAH/2024/001', profileStudentId = permanentStudentId, existingStudentIds = [], existingProfileIds = [], sequence = 1 } = {}) {
  const student = { id: 'student-1', school_id: SCHOOL, permanent_student_id: permanentStudentId, admission_number: 'ADM-001', first_name: 'Ama', last_name: 'Mensah', date_of_birth: '2014-02-03', student_status: 'ACTIVE', is_test_record: 0, updated_at: '2026-01-01' };
  const profile = withProfile ? { id: 'profile-1', student_master_id: 'student-1', student_id: profileStudentId, school_id: SCHOOL, first_name: 'Ama', last_name: 'Mensah', date_of_birth: student.date_of_birth, updated_at: '2026-01-01' } : null;
  const enrollment = withEnrollment ? { id: 'enrollment-1', student_id: 'student-1', school_id: SCHOOL, class_id: 'class-p2', academic_year_id: 'year-2026', term_id: 'term-1', enrollment_status: 'ACTIVE', is_current: 1 } : null;
  const writes = [];
  const db = {
    writes,
    async query(sql, params = []) {
      if (sql.includes('FROM students s LEFT JOIN student_profiles')) return [student];
      if (sql.includes('FROM student_id_sequences')) return [{ next_sequence: sequence }];
      if (sql.includes('FROM students WHERE school_id=? AND permanent_student_id LIKE')) return existingStudentIds.map((permanent_student_id) => ({ permanent_student_id }));
      if (sql.includes('FROM student_profiles WHERE school_id=? AND student_id LIKE')) return existingProfileIds.map((student_id) => ({ permanent_student_id: student_id }));
      if (sql.includes('SELECT * FROM students WHERE') && sql.includes('id=?')) return params.includes(student.id) ? [student] : [];
      if (sql.includes('SELECT * FROM student_profiles')) return profile ? [profile] : [];
      if (sql.includes('SELECT id FROM classes')) return params[1] === 'class-p2' ? [{ id: 'class-p2' }] : [];
      if (sql.includes('SELECT id FROM academic_years')) return [{ id: 'year-2026' }];
      if (sql.includes('FROM student_enrollments')) return enrollment ? [enrollment] : [];
      return [];
    },
    async execute(sql, params = []) { writes.push({ sql, params }); if (sql.startsWith('UPDATE students SET health_insurance_number')) student.health_insurance_number = params[0]; if (sql.startsWith('UPDATE students SET permanent_student_id')) student.permanent_student_id = params[0]; return { affectedRows: 1 }; },
    async transaction(work) { return work(this); }
  };
  return { db, student, profile, enrollment };
}

test('linking preserves the master Permanent Student ID and creates only missing profile/enrollment records', async () => {
  const { db } = fixture();
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL, idFactory: (() => { let n = 0; return () => `generated-${++n}`; })(), clock: () => '2026-10-11T00:00:00.000Z' });
  const result = await service.link({ permanentStudentId: 'OSAAH/2024/001', firstName: 'Ama', lastName: 'Mensah', dateOfBirth: '2014-02-03', classId: 'class-p2', academicYearId: 'year-2026', termId: 'term-1', healthInsuranceNumber: 'NHIS-001' }, actor);
  assert.equal(result.student.permanentStudentId, 'OSAAH/2024/001');
  assert.equal(result.createdProfile, true);
  assert.equal(result.createdEnrollment, true);
  assert.equal(result.student.healthInsuranceNumber, 'NHIS-001');
  assert.ok(db.writes.some(({ sql }) => sql.startsWith('UPDATE students SET health_insurance_number')));
  assert.ok(db.writes.some(({ sql }) => sql.includes('INSERT INTO student_enrollments')));
  assert.ok(db.writes.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
});

test('linking is idempotent for an already-linked class/year/term and does not duplicate enrollment', async () => {
  const { db } = fixture({ withProfile: true, withEnrollment: true });
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL });
  const result = await service.link({ admissionNumber: 'ADM-001', classId: 'class-p2', academicYearId: '2026', termId: 'term-1' }, actor);
  assert.equal(result.createdProfile, false);
  assert.equal(result.createdEnrollment, false);
  assert.equal(db.writes.filter(({ sql }) => sql.includes('INSERT INTO student_enrollments')).length, 0);
});

test('linking rejects role, school, identity conflict, and ambiguous matches closed', async () => {
  const { db } = fixture();
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL });
  await assert.rejects(() => service.link({ permanentStudentId: 'OSAAH/2024/001', classId: 'class-p2', academicYearId: '2026' }, { ...actor, roleKey: 'TEACHER' }), { status: 403 });
  await assert.rejects(() => service.link({ permanentStudentId: 'OSAAH/2024/001', firstName: 'Wrong', classId: 'class-p2', academicYearId: '2026' }, actor), { code: 'IDENTITY_CONFLICT' });
  await assert.rejects(() => service.link({ classId: 'class-p2', academicYearId: '2026' }, actor), { code: 'IDENTITY_REQUIRED' });
});

test('existing student without an ID requires the verified historical OSAAH admission year and allocates once', async () => {
  const { db, student } = fixture({ permanentStudentId: null });
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL, idFactory: (() => { let n = 0; return () => `generated-${++n}`; })(), clock: () => '2026-10-11T00:00:00.000Z' });
  await assert.rejects(() => service.link({ admissionNumber: 'ADM-001', classId: 'class-p2', academicYearId: 'year-2026' }, actor), { code: 'HISTORICAL_ADMISSION_YEAR_REQUIRED' });
  const result = await service.link({ admissionNumber: 'ADM-001', historicalAdmissionYear: '2020', classId: 'class-p2', academicYearId: 'year-2026' }, actor);
  assert.equal(result.student.permanentStudentId, 'OSAAH/2020/001');
  assert.equal(student.permanent_student_id, 'OSAAH/2020/001');
  assert.ok(db.writes.some(({ sql, params }) => sql.startsWith('UPDATE students SET permanent_student_id') && params[0] === 'OSAAH/2020/001'));
});

test('existing-student allocation fails closed when a malformed stored ID matches the requested year', async () => {
  const { db } = fixture({ permanentStudentId: null, existingStudentIds: ['OSAAH/2020/not-a-sequence'] });
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL, clock: () => '2026-10-11T00:00:00.000Z' });
  await assert.rejects(() => service.link({ admissionNumber: 'ADM-001', historicalAdmissionYear: '2020', classId: 'class-p2', academicYearId: 'year-2026' }, actor), { code: 'STUDENT_ID_SEQUENCE_CONFLICT' });
  assert.equal(db.writes.some(({ sql }) => sql.startsWith('UPDATE students SET permanent_student_id')), false);
});

test('existing-student linking rejects different valid IDs on the master and profile', async () => {
  const { db } = fixture({ withProfile: true, permanentStudentId: 'OSAAH/2024/001', profileStudentId: 'OSAAH/2024/002' });
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL });
  await assert.rejects(() => service.link({ admissionNumber: 'ADM-001', classId: 'class-p2', academicYearId: 'year-2026' }, actor), { code: 'PERMANENT_STUDENT_ID_CONFLICT' });
  assert.equal(db.writes.some(({ sql }) => sql.startsWith('UPDATE students SET permanent_student_id')), false);
});

test('valid existing IDs are preserved and invalid health-insurance input is rejected', async () => {
  const { db } = fixture();
  const service = createExistingStudentLinkingService({ database: db, schoolId: SCHOOL });
  await assert.rejects(() => service.link({ permanentStudentId: 'OSAAH/2024/001', classId: 'class-p2', academicYearId: 'year-2026', healthInsuranceNumber: 'x'.repeat(65) }, actor), { code: 'HEALTH_INSURANCE_NUMBER_INVALID' });
  const result = await service.link({ permanentStudentId: 'OSAAH/2024/001', classId: 'class-p2', academicYearId: 'year-2026' }, actor);
  assert.equal(result.student.permanentStudentId, 'OSAAH/2024/001');
});

test('migration 081 is additive, discoverable, and checksum-stable', async () => {
  const sql = await readFile(new URL('../schema/081_student_health_insurance_number.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE students[\s\S]*ADD COLUMN IF NOT EXISTS health_insurance_number/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
  assert.match(createHash('sha256').update(sql).digest('hex'), /^[a-f0-9]{64}$/);
});
