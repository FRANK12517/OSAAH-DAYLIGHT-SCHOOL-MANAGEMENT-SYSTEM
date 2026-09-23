import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAttendanceService } from '../src/attendance.js';

const actor = { userId: 'teacher-1', schoolId: 'school-1' };
const base = { academicYear: '2025/2026', term: '1st Term', date: '2025-09-10', classId: 'Basic 1', studentId: 'student-1', status: 'PRESENT', method: 'MANUAL' };

test('attendance UI exposes academic year and term selectors', async () => {
  const [student, staff] = await Promise.all([
    readFile(new URL('../public/attendance.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/staff-attendance.html', import.meta.url), 'utf8')
  ]);
  for (const html of [student, staff]) {
    assert.match(html, /attendance-academic-year/);
    assert.match(html, /attendance-term/);
  }
});

test('student attendance persists academic scope and isolates year and term', () => {
  const attendance = createAttendanceService({ schoolId: 'school-1' });
  const first = attendance.saveStudentAttendance(base, actor);
  assert.equal(first.academicYear, '2025/2026');
  assert.equal(first.term, '1st Term');
  attendance.saveStudentAttendance({ ...base, academicYear: '2026/2027' }, actor);
  attendance.saveStudentAttendance({ ...base, term: '2nd Term' }, actor);
  assert.equal(attendance.summary({ academicYear: '2025/2026', term: '1st Term', date: base.date }).total, 1);
  assert.equal(attendance.summary({ academicYear: '2026/2027', term: '1st Term', date: base.date }).total, 1);
  assert.equal(attendance.summary({ academicYear: '2025/2026', term: '2nd Term', date: base.date }).total, 1);
  assert.throws(() => attendance.saveStudentAttendance(base, actor), /already recorded/);
});

test('student historical class remains part of attendance identity after promotion', () => {
  const attendance = createAttendanceService({ schoolId: 'school-1' });
  const historical = attendance.saveStudentAttendance(base, actor);
  attendance.saveStudentAttendance({ ...base, academicYear: '2026/2027', classId: 'Basic 2' }, actor);
  assert.equal(attendance.getRecord(base).classId, 'Basic 1');
  assert.equal(historical.classId, 'Basic 1');
});

test('staff attendance persists academic scope and prevents duplicate daily status', () => {
  const attendance = createAttendanceService({ schoolId: 'school-1' });
  const entry = { academicYear: '2025/2026', term: '1st Term', date: '2025-09-10', staffId: 'staff-1', type: 'CHECK_IN' };
  const record = attendance.saveStaffAttendance(entry, actor);
  assert.equal(record.academicYear, '2025/2026');
  assert.equal(record.term, '1st Term');
  assert.throws(() => attendance.saveStaffAttendance(entry, actor), /already recorded/);
  attendance.saveStaffAttendance({ ...entry, academicYear: '2026/2027' }, actor);
  assert.equal(attendance.listStaffRecords().length, 2);
});
