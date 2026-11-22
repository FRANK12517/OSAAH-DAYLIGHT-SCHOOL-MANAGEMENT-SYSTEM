import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createAttendanceRegisterService } from '../src/attendance-register-service.js';
import { summarizeMockAttendance } from '../src/mock-result-attendance.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'mock-teacher', roleKey: 'TEACHER', portal: 'school', schoolId, assignedClassIds: ['JHS 3'], permissions: new Set(['mock.scores.write', 'mock.results.read']) };
const period = { yearId: 'year-2026', yearName: '2026/2027', termId: 'term-1', termName: 'First Term' };

test('Mock attendance counts one authoritative status per school day for the permanent student identity', () => {
  const records = [
    { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-01', status: 'PRESENT', version: 1 },
    { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-01', status: 'ABSENT', version: 2 },
    { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-02', status: 'LATE', version: 1 },
    { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-03', status: 'EXCUSED_ABSENCE', version: 1 },
    { schoolId, studentId: 'other-profile', permanentStudentId: 'OSAAH/2026/005', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-04', status: 'PRESENT', version: 1 },
    { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-2', academicYear: '2026/2027', term: 'First Term', date: '2026-09-05', status: 'PRESENT', version: 1 },
    { schoolId: 'another-school', studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYear: '2026/2027', term: 'First Term', date: '2026-09-06', status: 'PRESENT', version: 1 }
  ];
  assert.deepEqual(summarizeMockAttendance(records, { schoolId, studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/004', classId: 'jhs-3', academicYearId: 'year-2026', academicYear: '2026/2027', termId: 'term-1', term: 'First Term' }), { timesPresent: 1, timesAbsent: 2, totalSchoolDays: 3 });
});

test('attendance-register summary resolves the enrolled student by internal ID and exact permanent ID', async () => {
  const students = createStudentService({ schoolId });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', permanentStudentId: 'OSAAH/2026/004', classId: 'JHS 3', academicYearId: period.yearName, termId: period.termName });
  const rows = [
    { id: 'att-1', schoolId, studentId: student.id, classId: 'JHS 3', academicYear: period.yearName, term: period.termName, date: '2026-09-01', status: 'PRESENT', version: 1 },
    { id: 'att-2', schoolId, studentId: student.id, classId: 'JHS 3', academicYear: period.yearName, term: period.termName, date: '2026-09-02', status: 'ABSENT', version: 1 }
  ];
  const attendanceRepository = { async listStudentRecords(filters) { return rows.filter((row) => row.schoolId === filters.schoolId && row.studentId === filters.studentId); } };
  const service = createAttendanceRegisterService({ students, attendanceRepository });
  const summary = await service.studentAttendanceSummary({ schoolId, classId: 'JHS 3', className: 'JHS 3', canonicalClassName: 'JHS 3', period, studentId: student.id, permanentStudentId: student.permanentStudentId, actor });
  assert.equal(summary.permanentStudentId, 'OSAAH/2026/004');
  assert.deepEqual({ timesPresent: summary.timesPresent, timesAbsent: summary.timesAbsent, totalSchoolDays: summary.totalSchoolDays }, { timesPresent: 1, timesAbsent: 1, totalSchoolDays: 2 });
  await assert.rejects(service.studentAttendanceSummary({ schoolId, classId: 'JHS 3', period, studentId: student.id, permanentStudentId: 'OSAAH/2026/999', actor }), /selected class and academic context/);
});

test('Mock Result Slip loads linked attendance before rendering and does not expose editable attendance values', () => {
  const client = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  assert.match(client, /function loadLinkedAttendance\(x\)/);
  assert.match(client, /api\('\/api\/academic\/mock-attendance\?'/);
  assert.match(client, /permanentStudentId:String\(x\.studentIndexNumber\|\|x\.permanentStudentId\|\|''\)/);
  assert.match(client, /attendance:attendanceSummary/);
  assert.match(client, /attendanceSummaryUnavailable/);
  assert.doesNotMatch(client, /data-attendance="timesPresent" type="number"/);
  assert.doesNotMatch(client, /data-attendance="timesAbsent" type="number"/);
});

test('sample Mock generation is replaced by linked register totals before display', () => {
  const students = createStudentService();
  const subjects = createSubjectService();
  const academicResults = createAcademicResultsService({ students, subjects });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults });
  const sample = students.seedSampleStudents().find((student) => student.permanentStudentId === 'OSAAH/DEMO/001');
  const generated = workflow.generateMock({ classId: 'JHS 3', studentId: sample.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, actor);
  assert.equal(generated.attendance.totalSchoolDays, 60);
  const client = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  assert.ok(client.indexOf('attendanceSummary=await loadLinkedAttendance(result)') < client.indexOf('render({...result,className,attendance:attendanceSummary'));
});
