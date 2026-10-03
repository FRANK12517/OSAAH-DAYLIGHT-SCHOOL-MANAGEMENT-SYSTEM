import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { readFile } from 'node:fs/promises';

const schoolId = 'sch_default_01';
const actor = { id: 'manager-1', schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['marks.write', 'results.read', 'results.generate', 'results.write', 'results.publish', 'mock.scores.write', 'mock.scores.read', 'mock.results.read']) };

function databaseFixture() {
  const calls = [];
  const scores = [
    { id: 'score-terminal', subjectId: 'subject-math', subjectName: 'Mathematics', caScore: 40, examScore: 45, totalScore: 85, recordType: 'TERMINAL', mockLabel: null },
    { id: 'score-mock', subjectId: 'subject-math', subjectName: 'Mathematics', caScore: 0, examScore: 70, totalScore: 70, recordType: 'MOCK', mockLabel: '1st Mock' }
  ];
  const lifecycle = new Map();
  return {
    calls, scores, lifecycle,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', name: 'First Term' }];
      if (sql.includes('SELECT id,name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('SELECT DISTINCT s.id AS studentId')) return [{ studentId: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', classId: 'class-basic-1' }];
      if (sql.includes('FROM students s JOIN student_enrollments')) return [{ id: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', gender: 'F', classId: 'class-basic-1' }];
      if (sql.includes('FROM academic_score_records r')) {
        const mock = params.includes('MOCK');
        return scores.filter((row) => mock ? row.recordType === 'MOCK' : row.recordType === 'TERMINAL').map((row) => ({ ...row, updatedAt: '2026-10-03T00:00:00.000Z' }));
      }
      if (sql.includes('FROM academic_result_records')) {
        const key = [params[0], params[1], params[2], params[3], params[4], params[5], params[6]].join('|');
        const item = lifecycle.get(key);
        return item ? [item] : [];
      }
      if (sql.includes('FROM student_profiles')) return [{ id: 'profile-1' }];
      if (sql.includes('FROM students s JOIN student_enrollments e')) return [{ studentId: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', surname: 'Mensah', classId: 'class-basic-1' }];
      return [];
    },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO academic_result_records')) lifecycle.set([schoolId, params[2], params[3], params[4], params[5], params[6], params[7]].join('|'), { id: params[0], status: 'SAVED', version: params[11], savedAt: params[13], updatedAt: params[14], attendanceJson: params[8], assessmentJson: params[9] });
      if (sql.startsWith('UPDATE academic_result_records SET status')) return { affectedRows: 1 };
      return { affectedRows: 1 };
    }
  };
}

test('Result Slip reads academic_score_records, not canonical_academic_scores', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  const result = await service.result({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(result.subjects[0].totalScore, 85);
  assert.equal(db.calls.some(({ sql }) => sql.includes('canonical_academic_scores')), false);
  assert.equal(db.calls.some(({ sql }) => sql.includes('academic_score_records')), true);
});

test('durable listScores returns terminal records with context and no mock leakage', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  const rows = await service.listScores({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recordType, 'TERMINAL');
  assert.equal(rows[0].mockLabel, null);
});

test('durable listScores keeps mock labels isolated', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  const rows = await service.listScores({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, actor, { mock: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recordType, 'MOCK');
  assert.equal(rows[0].mockLabel, '1st Mock');
});

test('saveResult uses academic_result_records only for lifecycle metadata', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId, idFactory: () => 'lifecycle-1', clock: () => '2026-10-03T00:00:00.000Z' });
  const saved = await service.saveResult({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', attendance: { timesPresent: 10, timesAbsent: 0, totalSchoolDays: 10 }, assessment: { conduct: 'Good', attitude: 'Good', interest: 'Good', classTeacherRemarks: 'Good', headteacherRemarks: 'Good' } }, actor);
  assert.equal(saved.lifecycle.status, 'SAVED');
  assert.equal(db.calls.some(({ sql }) => sql.includes('INSERT INTO academic_result_records')), true);
  assert.equal(db.calls.some(({ sql }) => sql.includes('INSERT INTO canonical_academic_scores')), false);
});

test('published lifecycle remains readable after creating a new service instance', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId, idFactory: () => 'lifecycle-1' });
  await service.saveResult({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', attendance: { timesPresent: 10, timesAbsent: 0, totalSchoolDays: 10 }, assessment: { conduct: 'Good', attitude: 'Good', interest: 'Good', classTeacherRemarks: 'Good', headteacherRemarks: 'Good' } }, actor);
  const restarted = createDurableAcademicService({ database: db, schoolId });
  const result = await restarted.result({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(result.lifecycle.status, 'SAVED');
});

test('invalid terminal scores are rejected before persistence', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  await assert.rejects(() => service.saveScore({ studentId: 'student-1', classId: 'class-basic-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, actor), /CA score must be between 0 and 50/);
  assert.equal(db.calls.some(({ sql }) => sql.startsWith('INSERT INTO academic_score_records')), false);
});

test('invalid mock scores are rejected before persistence', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  await assert.rejects(() => service.saveMockScore({ studentId: 'student-1', classId: 'JHS 3', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 101 }, actor), /between 0 and 100/);
});

test('cross-school access fails closed', async () => {
  const service = createDurableAcademicService({ database: databaseFixture(), schoolId });
  await assert.rejects(() => service.result({ studentId: 'student-1', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, { ...actor, schoolId: 'other-school' }), /Forbidden/);
});

test('database absence fails closed instead of constructing an in-memory authoritative service', () => {
  assert.throws(() => createDurableAcademicService({ schoolId }), /database is unavailable/i);
});

test('broadsheet is exposed by the same durable result service', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  const rows = await service.broadsheet({ classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalScore, 85);
});

test('server academic routes do not use academic-results persistence fallbacks', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const academicSection = source.slice(source.indexOf("pathname === '/api/academic/options'"), source.indexOf("pathname === '/api/subjects/configure-defaults'"));
  assert.doesNotMatch(academicSection, /academicResults\.(saveScore|saveResult|savedResultFor|publishResults|publicationFor|result|listScores|broadsheet)/);
});

test('durable score queries include school, student, class, year, term, subject, and assessment scope', async () => {
  const db = databaseFixture();
  const service = createDurableAcademicService({ database: db, schoolId });
  await service.listScores({ classId: 'class-basic-1', studentId: 'student-1', subjectId: 'subject-math', academicYear: '2026/2027', term: 'First Term' }, actor);
  const query = db.calls.find(({ sql }) => sql.includes('FROM academic_score_records r')).sql;
  for (const marker of ['r.school_id=?', 'r.record_type=?', 'r.academic_year_id=?', 'r.term_id=?', 'r.class_id=?', 'r.subject_id=?']) assert.match(query, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
