import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createStudentService } from '../src/students.js';

const schoolId = 'sch_default_01';
const manager = { id: 'teacher-1', schoolId, roleKey: 'TEACHER', assignedClassIds: ['class-jhs-1'], permissions: new Set(['academics.read', 'subjects.read', 'marks.write', 'mock.scores.read', 'mock.scores.write']) };

function mockDatabase() {
  const executes = [];
  const queries = [];
  const database = {
    executes,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('e.enrollment_status')) throw new Error("Unknown column 'e.enrollment_status' in 'where clause'");
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE')) return [{ id: params[1], name: params[1] === 'class-jhs-1' ? 'JHS 1' : 'Primary 1' }];
      if (sql.includes('subject_class_assignments') && sql.includes('JOIN subjects')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', classId: 'class-jhs-1', assignmentActive: 1 }];
      if (sql.includes('FROM student_enrollments') && sql.includes('LEFT JOIN academic_score_records')) return [{ studentId: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', totalScore: null, grade: null, scoreId: null }];
      if (sql.includes('FROM student_enrollments') && sql.includes('JOIN classes')) return [{ student_id: 'student-1', permanent_student_id: 'OSAAH/2026/0001', className: 'JHS 1' }];
      if (sql.includes('SELECT id FROM academic_score_records')) return [];
      if (sql.includes('FROM student_profiles')) return [{ id: 'profile-1' }];
      return [];
    },
    async execute(sql, params = []) { executes.push({ sql, params }); return { affectedRows: 1 }; }
  };
  return database;
}

test('durable options expose exactly Mock 1 through Mock 10', async () => {
  const service = createDurableAcademicService({ database: mockDatabase(), schoolId });
  const options = await service.options({ ...manager, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['*']) });
  assert.deepEqual(options.mockTypes, ['1st Mock', '2nd Mock', '3rd Mock', '4th Mock', '5th Mock', '6th Mock', '7th Mock', '8th Mock', '9th Mock', '10th Mock']);
});

test('durable Mock roster is JHS-only and uses active class-scoped subject assignments', async () => {
  const database = mockDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  const roster = await service.mockRoster({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', subjectId: 'subject-english' }, manager);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].permanentStudentId, 'OSAAH/2026/0001');
  const rosterQuery = database.queries.at(-1).sql;
  assert.doesNotMatch(rosterQuery, /e\.enrollment_status|e\.is_current|s\.is_test_record/);
  await assert.rejects(() => service.mockRoster({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'Primary 1', subjectId: 'subject-english' }, manager), /JHS 1, JHS 2, and JHS 3/);
});

test('durable Mock Sample Mode roster contains both designated demonstration students without enrollments', async () => {
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  const service = createDurableAcademicService({ database: mockDatabase(), schoolId, students });
  const roster = await service.mockRoster({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', subjectId: 'subject-english', sampleMode: true }, manager);
  assert.deepEqual(roster.map((student) => student.permanentStudentId), ['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);
  assert.ok(roster.every((student) => student.isTestRecord && student.classId === 'class-jhs-1'));
});

test('durable Mock scores accept 0 and 100, reject invalid bounds, and never use CA/Exam', async () => {
  const database = mockDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'mock-score-1' });
  const base = { academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', subjectId: 'subject-english', studentId: 'student-1' };
  const zero = await service.saveMockScore({ ...base, totalScore: 0 }, manager);
  assert.equal(zero.totalScore, 0); assert.equal(zero.caScore, null); assert.equal(zero.examScore, null);
  const hundred = await service.saveMockScore({ ...base, totalScore: 100 }, manager);
  assert.equal(hundred.totalScore, 100);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: 101 }, manager), /between 0 and 100/);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: -1 }, manager), /between 0 and 100/);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: 50, caScore: 20 }, manager), /Total Score \/ 100 only/);
  assert.match(database.executes.at(-1).sql, /record_type,mock_label/);
});

test('Mock Score Entry uses authenticated class-scoped subject requests and exposes no terminal components', () => {
  const html = fs.readFileSync(new URL('../public/mock-examinations.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/mock-score-entry.js', import.meta.url), 'utf8');
  assert.match(html, /name="classId" required/);
  assert.match(html, /Sample \/ Test Mode/);
  assert.doesNotMatch(html, /CA \/ 50|Exam \/ 50/);
  assert.match(client, /JHS_CLASSES/);
  assert.match(client, /\/api\/subjects\?\$\{query\}/);
  assert.match(client, /credentials: 'same-origin'/);
  assert.match(client, /totalScore < 0 \|\| totalScore > 100/);
  assert.match(client, /No registered students found for the selected class, academic year and term\./);
  assert.doesNotMatch(client, /api\('\/api\/subjects'\)/);
});
