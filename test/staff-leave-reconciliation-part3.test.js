import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceService } from '../src/attendance.js';
import { createStaffService } from '../src/staff.js';
import { createStaffLeaveReconciler } from '../src/staff-leave-reconciler.js';

const ACTOR = { userId: 'hr-1', schoolId: 'school-a' };

function setup() {
  const attendance = createAttendanceService({ schoolId: 'school-a', now: () => '2026-09-20T08:00:00.000Z' });
  const staff = createStaffService({ schoolId: 'school-a', now: () => '2026-09-20T08:00:00.000Z' });
  const reconciler = createStaffLeaveReconciler({ attendance, schoolId: 'school-a', now: () => '2026-09-20T08:00:00.000Z' });
  const member = staff.createProfile({ fullName: 'Ama Mensah', employeeId: 'EMP-AMA' });
  return { attendance, staff, reconciler, member };
}

function request(staff, member, overrides = {}) {
  return staff.applyLeave({ staffId: member.id, academicYear: '2026/2027', term: '1st Term', leaveType: 'ANNUAL', startsOn: '2026-09-21', endsOn: '2026-09-25', reason: 'Approved annual leave', ...overrides });
}

async function approve(staff, reconciler, leave) {
  const decided = staff.decideLeave(leave.id, 'APPROVED', ACTOR);
  return { decided, reconciliation: await reconciler.reconcileLeave(decided, ACTOR) };
}

test('pending and rejected leave do not generate approved-leave attendance', async () => {
  const { attendance, staff, reconciler, member } = setup();
  const pending = request(staff, member);
  await reconciler.reconcileLeave(pending, ACTOR);
  assert.equal(attendance.listStaffRecords().length, 0);
  const rejected = request(staff, member, { startsOn: '2026-10-01', endsOn: '2026-10-02' });
  const decided = staff.decideLeave(rejected.id, 'REJECTED', ACTOR);
  await reconciler.reconcileLeave(decided, ACTOR);
  assert.equal(attendance.listStaffRecords().length, 0);
});

test('approved multi-day leave creates linked On Leave attendance for every date', async () => {
  const { attendance, staff, reconciler, member } = setup();
  const result = await approve(staff, reconciler, request(staff, member));
  const rows = attendance.listStaffRecords({ academicYear: '2026/2027', term: '1st Term', staffId: member.id });
  assert.equal(result.reconciliation.processedDates, 5);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.status), ['ON_LEAVE', 'ON_LEAVE', 'ON_LEAVE', 'ON_LEAVE', 'ON_LEAVE']);
  assert.ok(rows.every((row) => row.leaveRequestId === result.decided.id && row.source === 'LEAVE_RECONCILIATION'));
});

test('approved leave plus check-in or present preserves positive attendance and records a conflict', async () => {
  for (const type of ['CHECK_IN', 'PRESENT']) {
    const { attendance, staff, reconciler, member } = setup();
    attendance.saveStaffAttendance({ academicYear: '2026/2027', term: '1st Term', staffId: member.id, date: '2026-09-21', type }, ACTOR);
    const { decided } = await approve(staff, reconciler, request(staff, member, { startsOn: '2026-09-21', endsOn: '2026-09-21' }));
    const row = attendance.listStaffRecords({ staffId: member.id, date: '2026-09-21' })[0];
    assert.equal(row.status, type === 'CHECK_IN' ? 'CHECKED_IN' : 'PRESENT');
    assert.equal(row.leaveRequestId, decided.id);
    assert.equal((await reconciler.auditFor(decided.id))[0].action, 'PRESERVE_CONFLICT');
  }
});

test('approved leave plus absent reclassifies unexplained absence as On Leave', async () => {
  const { attendance, staff, reconciler, member } = setup();
  attendance.saveStaffAttendance({ academicYear: '2026/2027', term: '1st Term', staffId: member.id, date: '2026-09-22', type: 'ABSENT' }, ACTOR);
  const { decided } = await approve(staff, reconciler, request(staff, member, { startsOn: '2026-09-22', endsOn: '2026-09-22' }));
  const row = attendance.listStaffRecords({ staffId: member.id, date: '2026-09-22' })[0];
  assert.equal(row.status, 'ON_LEAVE');
  assert.equal(row.previousStatus, 'ABSENT');
  assert.equal(row.leaveRequestId, decided.id);
});

test('cancelled leave restores only generated attendance and retains reconciliation history', async () => {
  const { attendance, staff, reconciler, member } = setup();
  const leave = request(staff, member, { startsOn: '2026-09-23', endsOn: '2026-09-24' });
  const { decided } = await approve(staff, reconciler, leave);
  const cancelled = staff.decideLeave(decided.id, 'CANCELLED', ACTOR, { cancellationReason: 'Staff returned early' });
  await reconciler.reconcileLeave(cancelled, ACTOR);
  const rows = attendance.listStaffRecords({ staffId: member.id });
  assert.ok(rows.every((row) => row.status === 'ABSENT' && row.leaveRequestId === null && row.source === 'MANUAL'));
  assert.equal((await reconciler.auditFor(leave.id)).length, 4);
  assert.equal(staff.listLeave(member.id)[0].cancellationReason, 'Staff returned early');
});

test('changed approved leave dates restores removed dates and adds new dates', async () => {
  const { attendance, staff, reconciler, member } = setup();
  const leave = request(staff, member, { startsOn: '2026-09-21', endsOn: '2026-09-22' });
  const { decided } = await approve(staff, reconciler, leave);
  const changed = staff.updateLeave(decided.id, { startsOn: '2026-09-22', endsOn: '2026-09-24' }, ACTOR);
  await reconciler.reconcileLeave(changed, ACTOR);
  const rows = attendance.listStaffRecords({ staffId: member.id }).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(rows.map((row) => [row.date, row.status]), [['2026-09-21', 'ABSENT'], ['2026-09-22', 'ON_LEAVE'], ['2026-09-23', 'ON_LEAVE'], ['2026-09-24', 'ON_LEAVE']]);
});

test('staff report distinguishes On Leave from absent and isolates academic year and term', async () => {
  const { attendance, staff, reconciler, member } = setup();
  const leave = request(staff, member, { startsOn: '2026-09-25', endsOn: '2026-09-25' });
  await approve(staff, reconciler, leave);
  attendance.saveStaffAttendance({ academicYear: '2027/2028', term: '1st Term', staffId: member.id, date: '2026-09-25', type: 'ABSENT' }, ACTOR);
  attendance.saveStaffAttendance({ academicYear: '2026/2027', term: '2nd Term', staffId: member.id, date: '2026-09-25', type: 'LATE' }, ACTOR);
  const approvedReport = attendance.staffSummary({ academicYear: '2026/2027', term: '1st Term' });
  assert.equal(approvedReport.counts.ON_LEAVE, 1);
  assert.equal(approvedReport.counts.ABSENT, 0);
  assert.equal(attendance.staffSummary({ academicYear: '2027/2028', term: '1st Term' }).counts.ABSENT, 1);
  assert.equal(attendance.staffSummary({ academicYear: '2026/2027', term: '2nd Term' }).counts.LATE, 1);
});
