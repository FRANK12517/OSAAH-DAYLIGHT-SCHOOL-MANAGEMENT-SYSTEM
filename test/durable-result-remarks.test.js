import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createParentDashboardService } from '../src/parent-dashboard.js';
import { createResultSlipPdfService } from '../src/result-slip-pdf.js';

const schoolId = 'sch_result_remarks';
const actor = { id: 'headteacher-1', schoolId, roleKey: 'HEADTEACHER', permissions: new Set(['results.read', 'results.generate', 'results.write', 'results.publish']) };
const context = { studentId: 'student-1', classId: 'class-primary-1', academicYear: '2026/2027', term: 'First Term' };

function resultDatabase() {
  let lifecycle = null;
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ kind: 'query', sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms t JOIN academic_years')) return [{ id: 'term-1', name: 'First Term' }];
      if (sql.includes('FROM classes c WHERE c.school_id')) return [{ id: 'class-primary-1', name: 'Primary 1' }];
      if (sql.includes('FROM classes WHERE school_id=? AND id=?')) return [{ id: 'class-primary-1', name: 'Primary 1' }];
      if (sql.includes('FROM students s JOIN student_enrollments e ON')) return [{ id: 'student-1', permanentStudentId: 'OSAAH-2026-001', firstName: 'Ama', middleName: null, surname: 'Learner', gender: 'Female', classId: 'class-primary-1' }];
      if (sql.includes('FROM academic_score_records r JOIN student_profiles sp') && sql.includes('JOIN subjects sub')) return [{ subjectId: 'subject-english', subjectName: 'English Language', caScore: 42, examScore: 46, totalScore: 88 }];
      if (sql.includes('SELECT id,attendance_json AS attendanceJson,assessment_json AS assessmentJson')) return lifecycle ? [{ ...lifecycle }] : [];
      if (sql.includes('SELECT id,version FROM academic_result_records')) return lifecycle ? [{ id: lifecycle.id, version: lifecycle.version }] : [];
      if (sql.includes('SELECT id,status,version FROM academic_result_records')) return lifecycle ? [{ id: lifecycle.id, status: lifecycle.status, version: lifecycle.version }] : [];
      if (sql.includes('status="PUBLISHED"')) return lifecycle?.status === 'PUBLISHED' ? [{ id: lifecycle.id, status: lifecycle.status }] : [];
      throw new Error(`Unexpected durable result query: ${sql}`);
    },
    async execute(sql, params = []) {
      calls.push({ kind: 'execute', sql, params });
      if (sql.startsWith('INSERT INTO academic_result_records')) {
        lifecycle = {
          id: params[0],
          attendanceJson: params[8],
          assessmentJson: params[9],
          status: params[10],
          version: params[11]
        };
      } else if (sql.startsWith('UPDATE academic_result_records SET attendance_json=')) {
        lifecycle = { ...lifecycle, attendanceJson: params[0], assessmentJson: params[1], status: 'SAVED', version: params[2] };
      } else if (sql.startsWith('UPDATE academic_result_records SET status="PUBLISHED"')) {
        lifecycle = { ...lifecycle, status: 'PUBLISHED' };
      } else throw new Error(`Unexpected durable result write: ${sql}`);
      return { affectedRows: 1 };
    }
  };
}

test('durable Result Slip remarks survive assessment_json save, generated reload, and publication', async () => {
  const database = resultDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'result-record-1', clock: () => '2026-10-06T00:00:00.000Z' });
  const assessment = {
    conduct: 'Shows strong responsibility.',
    attitude: 'Demonstrates a positive attitude toward learning.',
    interest: 'Shows enthusiasm and curiosity.',
    classTeacherRemarks: 'Responds positively to correction and guidance.',
    headteacherRemarks: 'Continue to build on this success and aim even higher in the coming term.'
  };
  const attendance = { timesPresent: 58, timesAbsent: 2, totalSchoolDays: 60 };
  const saved = await service.saveResult({ ...context, attendance, assessment }, actor);
  assert.deepEqual(saved.assessment, assessment);
  assert.ok(database.calls.some(({ kind, sql, params }) => kind === 'execute' && sql.startsWith('INSERT INTO academic_result_records') && JSON.parse(params[9]).classTeacherRemarks === assessment.classTeacherRemarks && JSON.parse(params[9]).headteacherRemarks === assessment.headteacherRemarks), 'both unchanged public/API field names are durably stored in assessment_json');

  const generated = await service.result(context, actor);
  assert.deepEqual(generated.assessment, assessment);
  assert.deepEqual(generated.attendance, attendance);
  assert.equal(generated.lifecycle.status, 'SAVED');

  const publication = await service.publishResults(context, actor);
  assert.equal(publication.status, 'PUBLISHED');
  const published = await service.result(context, actor);
  assert.deepEqual(published.assessment, assessment);
  assert.deepEqual(published.attendance, attendance);
  assert.equal(published.lifecycle.status, 'PUBLISHED');

  const student = { id: 'student-1', schoolId, permanentStudentId: 'OSAAH/2026/0001', firstName: 'Ama', surname: 'Learner', classId: 'class-primary-1', isTestRecord: false };
  const inMemoryResults = {
    publicationFor: () => { throw new Error('real Parent Portal reads must not fall back to in-memory publication state'); },
    result: () => { throw new Error('real Parent Portal reads must not fall back to in-memory result state'); }
  };
  const parentDashboard = createParentDashboardService({
    students: { listStudents: () => [student] },
    admissionEnrollment: { authorizeParentStudent: async () => student },
    academicResults: inMemoryResults,
    durableAcademic: service,
    cards: [{ moduleKey: 'parent-results', moduleName: 'Published Results', route: '/parent/results' }]
  });
  const parent = { id: 'parent-1', schoolId, portal: 'parent', roleKey: 'PARENT', permissions: new Set(['children.read']) };
  const parentResult = await parentDashboard.loadRecord(parent, {
    recordType: 'published-results',
    permanentStudentId: student.permanentStudentId,
    academicYear: '2026/2027',
    term: 'First Term',
    classId: 'class-primary-1'
  });
  assert.deepEqual(parentResult.result.assessment, assessment);
  assert.equal(parentResult.result.lifecycle.status, 'PUBLISHED');
  const parentPdf = await createResultSlipPdfService().pdf(parentResult.result);
  const rawPdf = parentPdf.toString('latin1');
  assert.equal((rawPdf.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'the durable published Parent Portal result reaches the shared one-page PDF renderer');
});
