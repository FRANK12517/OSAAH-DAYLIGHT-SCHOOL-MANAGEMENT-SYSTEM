import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceService, STUDENT_STATUSES } from '../src/attendance.js';

const actor = { userId: 'teacher-1', schoolId: 'school-a' };
const base = { academicYear: '2026/2027', term: '1st Term', classId: 'Basic 1', studentId: 'student-1', date: '2026-09-23' };

test('all canonical student statuses are accepted and exposed', () => {
  const attendance = createAttendanceService({ schoolId: 'school-a' });
  for (const [index, status] of STUDENT_STATUSES.entries()) {
    const record = attendance.saveStudentAttendance({ ...base, studentId: `student-${index}`, status, reason: status === 'PRESENT' ? null : 'Recorded for test' }, actor);
    assert.equal(record.status, status);
    assert.equal(record.source, 'MANUAL');
  }
  assert.deepEqual(Object.keys(attendance.summary().counts), STUDENT_STATUSES);
});

test('required reasons and canonical time fields are validated', () => {
  const attendance = createAttendanceService({ schoolId: 'school-a', requireReasons: true });
  assert.throws(() => attendance.saveStudentAttendance({ ...base, status: 'ABSENT' }, actor), /Reason is required/);
  assert.throws(() => attendance.saveStudentAttendance({ ...base, status: 'PRESENT', arrivalTime: '25:00' }, actor), /Invalid arrival/);
  const record = attendance.saveStudentAttendance({ ...base, status: 'LATE', reason: 'Traffic', arrivalTime: '08:15', departureTime: '15:30' }, actor);
  assert.equal(record.arrivalTime, '08:15');
  assert.equal(record.departureTime, '15:30');
});

test('creation and update provenance use authenticated actor, not client identity', () => {
  let auditEvents = [];
  const attendance = createAttendanceService({ schoolId: 'school-a', now: () => '2026-09-23T10:00:00.000Z', audit: (event) => auditEvents.push(event) });
  const created = attendance.saveStudentAttendance({ ...base, status: 'PRESENT', recordedBy: 'attacker', updatedBy: 'attacker', source: 'API' }, actor);
  assert.equal(created.recordedBy, 'teacher-1');
  assert.equal(created.updatedBy, 'teacher-1');
  assert.equal(created.recordedAt, created.updatedAt);
  const updated = attendance.saveStudentAttendance({ ...base, status: 'LATE', reason: 'Traffic' }, actor, { correction: true, expectedVersion: 1 });
  assert.equal(updated.recordedBy, 'teacher-1');
  assert.equal(updated.updatedBy, 'teacher-1');
  assert.equal(updated.source, 'MANUAL');
  assert.equal(auditEvents.length, 2);
  assert.deepEqual(attendance.listAuditHistory({}, actor)[1], { ...auditEvents[1] });
});

test('cross-school actors and audit reads are rejected', () => {
  const attendance = createAttendanceService({ schoolId: 'school-a' });
  assert.throws(() => attendance.saveStudentAttendance({ ...base, status: 'PRESENT' }, { userId: 'other', schoolId: 'school-b' }), /Forbidden/);
  assert.throws(() => attendance.listAuditHistory({}, { userId: 'other', schoolId: 'school-b' }), /Forbidden/);
});

test('staff leave reconciliation source and complete staff statuses are retained', () => {
  const attendance = createAttendanceService({ schoolId: 'school-a' });
  const record = attendance.saveStaffAttendance({ ...base, staffId: 'staff-1', type: 'ON_LEAVE', status: 'ON_LEAVE', source: 'LEAVE_RECONCILIATION', time: '08:00' }, actor);
  assert.equal(record.status, 'ON_LEAVE');
  assert.equal(record.source, 'LEAVE_RECONCILIATION');
  assert.equal(record.recordedBy, actor.userId);
  assert.equal(attendance.listAuditHistory({}, actor)[0].source, 'LEAVE_RECONCILIATION');
});
