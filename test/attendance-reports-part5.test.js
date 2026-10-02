import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceReportsService } from '../src/attendance-reports.js';

function fixture() {
  const actor = { id: 'admin-1', schoolId: 'school-1', roleKey: 'SCHOOL_ADMIN', permissions: new Set(['attendance.read']) };
  const students = {
    listStudents: () => [
      { id: 'student-1', permanentStudentId: 'OSA-001', firstName: 'Ama', surname: 'Mensah', classId: 'Primary 1', gender: 'Female', schoolId: 'school-1' },
      { id: 'student-2', permanentStudentId: 'OSA-002', firstName: 'Kojo', surname: 'Owusu', classId: 'Primary 1', gender: 'Male', schoolId: 'school-1' }
    ]
  };
  const attendance = {
    listStudentRecords: () => [
      { id: 'a-1', schoolId: 'school-1', studentId: 'student-1', date: '2026-09-01', academicYear: '2026/2027', term: '1st Term', classId: 'Primary 1', status: 'PRESENT', version: 1 },
      { id: 'a-2', schoolId: 'school-1', studentId: 'student-2', date: '2026-09-01', academicYear: '2026/2027', term: '1st Term', classId: 'Primary 1', status: 'ABSENT', version: 1 }
    ],
    listStaffRecords: () => []
  };
  const analytics = {
    overview: async () => ({
      generatedAt: '2026-09-01T10:00:00.000Z',
      authoritative: true,
      period: { label: 'selected-term' },
      summary: { students: { totalEnrolled: 2, presentStudentDays: 1, absentStudentDays: 1, unmarkedStudentDays: 0 }, staff: { totalRegisteredStaff: 0 } },
      classAttendance: [{ className: 'Primary 1', boys: { enrolled: 1, present: 0, absent: 1 }, girls: { enrolled: 1, present: 1, absent: 0 }, totalEnrolled: 2, totalPresent: 1, totalAbsent: 1, attendanceRate: 50, unmarkedStudentDays: 0 }],
      genderDistribution: { items: [{ label: 'BOYS', present: 0, absent: 1, rate: 0 }, { label: 'GIRLS', present: 1, absent: 0, rate: 100 }, { label: 'UNSPECIFIED', present: 0, absent: 0, rate: null }] },
      trends: { students: { term: [{ period: 'selected-term', present: 1, absent: 1, attendanceRate: 50 }] } }
    })
  };
  const audit = [];
  return { actor, attendance, students, analytics, audit, service: createAttendanceReportsService({ attendanceAnalytics: analytics, attendance, students, schoolId: 'school-1', audit: (event) => audit.push(event), now: () => '2026-09-01T10:00:00.000Z' }) };
}

test('builds a canonical student report with filterable rows and audit event', async () => {
  const { service, actor, audit } = fixture();
  const report = await service.report({ reportType: 'STUDENT', period: 'TERM', academicYear: '2026/2027', term: '1st Term' }, actor);
  assert.equal(report.authoritative, true);
  assert.equal(report.rows.length, 2);
  assert.equal(report.rows[0].attendancePercentage, 100);
  assert.equal(report.rows[1].attendancePercentage, 0);
  assert.equal(report.classSummary[0].className, 'Primary 1');
  assert.equal(report.genderSummary.find((row) => row.gender === 'BOYS').enrolled, 1);
  assert.equal(audit[0].action, 'ATTENDANCE_REPORT_GENERATED');
});

test('exports valid PDF and XLSX bytes from the same snapshot', async () => {
  const { service, actor } = fixture();
  const pdf = await service.exportReport({ reportType: 'CLASS', period: 'TERM' }, actor, 'PDF');
  const xlsx = await service.exportReport({ reportType: 'CLASS', period: 'TERM' }, actor, 'XLSX');
  assert.equal(pdf.contentType, 'application/pdf');
  assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
  assert.equal(xlsx.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(xlsx.content.subarray(0, 2).toString(), 'PK');
  assert.match(xlsx.filename, /\.xlsx$/);
});

test('rejects invalid custom periods before generating a report', async () => {
  const { service, actor } = fixture();
  await assert.rejects(() => service.report({ reportType: 'CLASS', period: 'CUSTOM', startDate: '2026-09-01' }, actor), /requires startDate and endDate/);
});
