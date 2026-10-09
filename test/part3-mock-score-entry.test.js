import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDurableAcademicService } from '../src/durable-academic.js';

const schoolId = 'sch_default_01';
const manager = { id: 'teacher-1', schoolId, roleKey: 'TEACHER', assignedClassIds: ['class-jhs-1'], assignedSubjectIds: ['subject-english'], permissions: new Set(['academics.read', 'subjects.read', 'mock.scores.read', 'mock.scores.write']) };

function mockDatabase() {
  const executes = [], queries = [];
  const database = {
    executes, queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms t') && sql.includes('y.id=?')) return [{ id: 'term-1', name: 'First Term' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes WHERE')) return [{ id: params[1], name: params[1] === 'class-jhs-1' ? 'JHS 1' : 'Primary 1' }];
      if (sql.includes('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className')) return [{ subjectId: 'subject-english', classId: 'class-jhs-1', active: 1, className: 'JHS 1' }];
      if (sql.includes('FROM subject_class_assignments a') && sql.includes('JOIN subjects s')) return [{ id: 'subject-english', subjectId: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-jhs-1', className: 'JHS 1', academicYearId: params[2] ?? null, assignmentActive: 1 }];
      if (sql.includes('FROM subjects WHERE school_id=? ORDER BY name,id')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', subjectType: 'CORE', isScoring: 1, isActive: 1, active: true }];
      if (sql.includes('FROM student_enrollments') && sql.includes('LEFT JOIN academic_score_records')) return [{ studentId: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', gender: 'FEMALE', totalScore: null, grade: null, scoreId: null }];
      if (sql.includes('SELECT DISTINCT s.id AS studentId')) return [{ id: 'student-1', studentId: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', classId: 'class-jhs-1' }];
      if (sql.includes('FROM students s JOIN student_enrollments e')) return [{ id: 'student-1', permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', middleName: null, surname: 'Mensah', gender: 'FEMALE', classId: 'class-jhs-1' }];
      if (sql.includes('FROM academic_score_records r JOIN student_profiles')) return [
        { subjectId: 'eng', subjectName: 'English Language', caScore: 0, examScore: 80, totalScore: 80 },
        { subjectId: 'math', subjectName: 'Mathematics', caScore: 0, examScore: 70, totalScore: 70 },
        { subjectId: 'science', subjectName: 'Integrated Science', caScore: 0, examScore: 60, totalScore: 60 },
        { subjectId: 'social', subjectName: 'Social Studies', caScore: 0, examScore: 55, totalScore: 55 },
        { subjectId: 'ict', subjectName: 'ICT', caScore: 0, examScore: 90, totalScore: 90 },
        { subjectId: 'french', subjectName: 'French', caScore: 0, examScore: 85, totalScore: 85 }
      ];
      if (sql.includes('FROM academic_result_records WHERE')) return [];
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
  assert.equal(roster[0].gender, 'FEMALE');
  const rosterQuery = database.queries.find(({ sql }) => sql.includes('LEFT JOIN academic_score_records'));
  assert.match(rosterQuery.sql, /e\.term_id=\?/);
  assert.deepEqual(rosterQuery.params.slice(4, 9), [schoolId, 'class-jhs-1', 'year-2026', 'term-1', schoolId]);
  await assert.rejects(() => service.mockRoster({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'Primary 1', subjectId: 'subject-english' }, manager), /JHS 1, JHS 2, and JHS 3/);
});

test('durable Mock scores accept 0 and 100, reject invalid bounds, and never use CA/Exam', async () => {
  const database = mockDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'mock-score-1' });
  const base = { academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', subjectId: 'subject-english', studentId: 'student-1' };
  const zero = await service.saveMockScore({ ...base, totalScore: 0 }, manager);
  assert.equal(zero.totalScore, 0); assert.equal(zero.caScore, null); assert.equal(zero.examScore, null);
  const enrollmentQuery = database.queries.find(({ sql }) => sql.includes('SELECT e.student_id,s.permanent_student_id'));
  assert.match(enrollmentQuery.sql, /e\.term_id=\?/);
  assert.deepEqual(enrollmentQuery.params, [schoolId, 'student-1', 'class-jhs-1', 'year-2026', 'term-1']);
  assert.equal(database.executes[0].params[5], 'term-1');
  const hundred = await service.saveMockScore({ ...base, totalScore: 100 }, manager);
  assert.equal(hundred.totalScore, 100);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: 101 }, manager), /between 0 and 100/);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: -1 }, manager), /between 0 and 100/);
  await assert.rejects(() => service.saveMockScore({ ...base, totalScore: 50, caScore: 20 }, manager), /Total Score \/ 100 only/);
  assert.match(database.executes.at(-1).sql, /record_type,mock_label/);
});

test('durable Mock roster falls back when legacy TiDB omits optional enrollment and sample-state columns', async () => {
  const database = mockDatabase();
  const query = database.query.bind(database);
  database.query = async (sql, params = []) => {
    if (sql.includes('COALESCE(e.enrollment_status')) throw new Error("Unknown column 'e.enrollment_status' in 'where clause'");
    if (sql.includes("COALESCE(s.student_status,'ACTIVE')")) throw new Error("Unknown column 's.student_status' in 'where clause'");
    if (sql.includes('COALESCE(s.is_test_record,0)')) throw new Error("Unknown column 's.is_test_record' in 'where clause'");
    return query(sql, params);
  };
  const service = createDurableAcademicService({ database, schoolId });
  const roster = await service.mockRoster({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', subjectId: 'subject-english' }, manager);
  assert.equal(roster.length, 1);
  const finalRosterQuery = database.queries.filter(({ sql }) => sql.includes('LEFT JOIN academic_score_records')).at(-1);
  assert.doesNotMatch(finalRosterQuery.sql, /enrollment_status|is_current|student_status|is_test_record/);
  assert.match(finalRosterQuery.sql, /OSAAH-DEMO-%/);
  assert.match(finalRosterQuery.sql, /e\.term_id=\?/);
});

test('durable Mock Broadsheet returns all subject scores and grades from the selected Mock context', async () => {
  const database = mockDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  const actor = { id: 'headteacher-1', schoolId, roleKey: 'HEADTEACHER', permissions: new Set(['*']) };
  const rows = await service.mockBroadsheet({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1' }, actor);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subjectTotals['English Language'], 80);
  assert.equal(rows[0].subjectGrades['English Language'], 1);
  assert.equal(rows[0].aggregate, 12);
  assert.equal(rows[0].classPosition, '1st');
  const result = await service.result({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'class-jhs-1', studentId: 'student-1' }, actor, { mock: true });
  assert.equal(result.classPosition, '1st');
  assert.deepEqual(result.classGenderDistribution, { totalBoys: 0, totalGirls: 1, totalStudents: 1 });
  await assert.rejects(() => service.mockBroadsheet({ academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', classId: 'Primary 1' }, actor), /JHS 1, JHS 2, and JHS 3/);
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
  assert.doesNotMatch(client, /api\('\/api\/subjects'\)/);
  assert.match(html, /<th>GENDER<\/th>/);
  const resultPage = fs.readFileSync(new URL('../public/mock-results.html', import.meta.url), 'utf8');
  const resultClient = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  const broadsheetPage = fs.readFileSync(new URL('../public/mock-broadsheet.html', import.meta.url), 'utf8');
  const broadsheetClient = fs.readFileSync(new URL('../public/mock-broadsheet.js', import.meta.url), 'utf8');
  assert.match(resultPage, /<select name="academicYear" required>/);
  assert.match(resultClient, /function renderPeriods\(\)/);
  assert.match(broadsheetPage, /<select name="academicYear" required>/);
  assert.match(broadsheetClient, /optionName\(item\)/);
});
