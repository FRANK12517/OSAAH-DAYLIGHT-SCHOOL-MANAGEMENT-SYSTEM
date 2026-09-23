import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceService } from '../src/attendance.js';
import { createAttendanceAggregationService } from '../src/attendance-aggregation.js';
import { createStudentService } from '../src/students.js';

const YEAR = '2025/2026';
const TERM = '1st Term';
const actor = { userId: 'teacher-1', schoolId: 'school-a' };

function setup() {
  const students = createStudentService({ schoolId: 'school-a' });
  const attendance = createAttendanceService({ schoolId: 'school-a' });
  const boy = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'Male', classId: 'Basic 1', academicYearId: YEAR, termId: TERM });
  const girl = students.createStudent({ firstName: 'Ama', surname: 'Owusu', gender: 'Female', classId: 'Basic 1', academicYearId: YEAR, termId: TERM });
  const report = createAttendanceAggregationService({ students, attendance, schoolId: 'school-a', now: () => '2025-09-15T12:00:00.000Z' });
  return { students, attendance, report, boy, girl };
}
function save(attendance, studentId, date, status) { attendance.saveStudentAttendance({ academicYear: YEAR, term: TERM, classId: 'Basic 1', studentId, date, status }, actor); }

test('daily aggregation derives boys, girls, totals, statuses, and canonical percentage', () => {
  const { attendance, report, boy, girl } = setup();
  save(attendance, boy.id, '2025-09-15', 'PRESENT');
  save(attendance, girl.id, '2025-09-15', 'LATE');
  const result = report.daily({ academicYear: YEAR, term: TERM, classId: 'Basic 1', date: '2025-09-15' });
  assert.deepEqual(result.enrolled, { boys: 1, girls: 1, total: 2 });
  assert.equal(result.boysPresent, 1);
  assert.equal(result.girlsPresent, 1);
  assert.equal(result.totalPresent, 2);
  assert.equal(result.totalLate, 1);
  assert.equal(result.attendancePercentage, 100);
});

test('weekly and monthly aggregation are date-scoped and expose weekday/session metrics', () => {
  const { attendance, report, boy, girl } = setup();
  save(attendance, boy.id, '2025-09-15', 'PRESENT');
  save(attendance, girl.id, '2025-09-16', 'ABSENT');
  save(attendance, boy.id, '2025-09-30', 'PRESENT');
  const weekly = report.weekly({ academicYear: YEAR, term: TERM, classId: 'Basic 1', week: '2025-W38' });
  assert.equal(weekly.totalPresent, 1);
  assert.equal(weekly.totalAbsent, 1);
  assert.equal(weekly.days.length, 5);
  const monthly = report.monthly({ academicYear: YEAR, term: TERM, classId: 'Basic 1', month: '2025-09' });
  assert.equal(monthly.attendanceDays, 3);
  assert.equal(monthly.totalPresent, 2);
});

test('term aggregation, academic-year isolation, class isolation, school isolation, and empty reports hold', () => {
  const { attendance, report, boy, students } = setup();
  save(attendance, boy.id, '2025-09-15', 'ABSENT');
  students.assignClass(boy.id, { classId: 'Basic 1', academicYearId: '2026/2027', termId: TERM, reason: 'PROMOTION' });
  attendance.saveStudentAttendance({ academicYear: '2026/2027', term: TERM, classId: 'Basic 1', studentId: boy.id, date: '2026-09-15', status: 'PRESENT' }, actor);
  const term = report.term({ academicYear: YEAR, term: TERM, classId: 'Basic 1' });
  assert.equal(term.totalAbsent, 1);
  assert.equal(term.totalPresent, 0);
  assert.equal(report.term({ academicYear: '2026/2027', term: TERM, classId: 'Basic 1' }).totalPresent, 1);
  assert.equal(report.term({ academicYear: YEAR, term: TERM, classId: 'Basic 2' }).totalStudents, 0);
  assert.equal(report.daily({ academicYear: YEAR, term: '2nd Term', classId: 'Basic 1', date: '2025-09-15' }).totalPresent, 0);
  const otherSchool = createAttendanceService({ schoolId: 'school-b' });
  otherSchool.saveStudentAttendance({ academicYear: YEAR, term: TERM, classId: 'Basic 1', studentId: boy.id, date: '2025-09-15', status: 'PRESENT' }, { userId: 'teacher-2' });
  const otherReport = createAttendanceAggregationService({ students: setup().students, attendance: otherSchool, schoolId: 'school-b' });
  assert.equal(otherReport.term({ academicYear: YEAR, term: TERM, classId: 'Basic 1' }).totalPresent, 0);
});
