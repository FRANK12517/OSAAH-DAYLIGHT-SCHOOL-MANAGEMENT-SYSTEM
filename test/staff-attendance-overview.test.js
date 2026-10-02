import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffAttendanceOverviewService } from '../src/staff-attendance-overview.js';

const staff = [
  { id: 's1', fullName: 'Ama Mensah', phone: '0240000000', roleKey: 'TEACHER', schoolId: 'school-a' },
  { id: 's2', fullName: 'Kofi Admin', phone: '0240000001', roleKey: 'SCHOOL_ADMIN', schoolId: 'school-a' },
  { id: 'sample', fullName: 'Demo Sample', phone: '000', roleKey: 'TEACHER', schoolId: 'school-a', isTestRecord: true }
];
const records = [
  { id: '1', schoolId: 'school-a', staffId: 's1', date: '2026-09-21', status: 'PRESENT', updatedAt: '2026-09-21T09:00:00Z' },
  { id: '2', schoolId: 'school-a', staffId: 's1', date: '2026-09-21', status: 'ABSENT', updatedAt: '2026-09-21T08:00:00Z' },
  { id: '3', schoolId: 'school-a', staffId: 's1', date: '2026-09-22', status: 'ABSENT' },
  { id: '4', schoolId: 'school-a', staffId: 's1', date: '2026-09-23', status: 'ON_LEAVE', source: 'LEAVE_RECONCILIATION' },
  { id: '5', schoolId: 'school-a', staffId: 's1', date: '2026-09-24', status: 'PRESENT' },
  { id: '6', schoolId: 'school-a', staffId: 's1', date: '2026-09-25', status: 'PRESENT' },
  { id: 'sample-row', schoolId: 'school-a', staffId: 'sample', date: '2026-09-22', status: 'ABSENT', provenance: 'TEST' }
];
function setup() {
  return createStaffAttendanceOverviewService({
    schoolId: 'school-a',
    now: () => '2026-09-25T12:00:00Z',
    staffProvider: async () => staff,
    leaveProvider: async () => [{ staffId: 's1', startsOn: '2026-09-23', endsOn: '2026-09-23', state: 'APPROVED' }],
    attendanceRepository: { listStaffRecords: async () => records }
  });
}

test('staff overview deduplicates corrected daily marks and excludes sample data', async () => {
  const result = await setup().overview({ startDate: '2026-09-21', endDate: '2026-09-25' }, { schoolId: 'school-a', roleKey: 'HEADTEACHER' });
  assert.equal(result.staff.length, 2);
  const ama = result.staff.find((row) => row.staffId === 's1');
  assert.equal(ama.totalPresentInTerm, 3);
  assert.equal(ama.totalAbsentInTerm, 1);
  assert.equal(ama.approvedLeave, 1);
  assert.equal(ama.attendancePercentage, 75);
  assert.equal(result.staff.some((row) => row.staffId === 'sample'), false);
});

test('staff overview does not turn missing weekdays into absences and honors status and role filters', async () => {
  const service = setup();
  const filtered = await service.overview({ startDate: '2026-09-21', endDate: '2026-09-25', role: 'TEACHER', status: 'ABSENT' }, { schoolId: 'school-a' });
  assert.deepEqual(filtered.staff.map((row) => row.staffId), ['s1']);
  assert.equal(filtered.staff[0].totalAbsentInTerm, 1);
  assert.equal(filtered.staff[0].missingDays, 0);
  const empty = await service.overview({ startDate: '2026-09-21', endDate: '2026-09-25', status: 'CHECKED_OUT' }, { schoolId: 'school-a' });
  assert.equal(empty.staff.length, 0);
});

test('week and month filters are validated server-side', async () => {
  const service = setup();
  const week = await service.overview({ week: '2026-W39' }, { schoolId: 'school-a' });
  assert.equal(week.filters.startDate, '2026-09-21');
  await assert.rejects(() => service.overview({ week: 'bad' }, { schoolId: 'school-a' }), /Week/);
  await assert.rejects(() => service.overview({ status: 'UNKNOWN' }, { schoolId: 'school-a' }), /status/);
});
