import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceAnalyticsService } from '../src/attendance-analytics.js';

const actor = (roleKey = 'HEADTEACHER', permissions = ['attendance.read', 'staff.attendance.read']) => ({ id: 'user-1', schoolId: 'school-a', portal: 'school', roleKey, permissions: new Set(permissions), assignedClassIds: ['primary-1'] });
const studentReport = {
  periodLabel: '2026-09-01 – 2026-09-30',
  summary: { totalEnrolledStudents: 3, presentStudentDays: 4, absentStudentDays: 1, unmarkedStudentDays: 1, excusedStudentDays: 0, otherMarkedStudentDays: 0, attendancePercentage: 66.67 },
  classes: [
    { canonicalClassId: 'PRIMARY_1', classId: 'primary-1', className: 'Primary 1', totalBoysEnrolled: 2, totalGirlsEnrolled: 1, boysPresent: 3, boysAbsent: 1, girlsPresent: 1, girlsAbsent: 0, totalPresent: 4, totalAbsent: 1, unmarkedStudentDays: 1, eligibleStudentDays: 6, attendancePercentage: 66.67 }
  ],
  calculationPolicy: { unmarkedIsNotAbsent: true, oneEffectiveDailyMarkPerStudentDate: true }
};
const staffReport = { source: 'TiDB/staff_attendance', staff: [{ staffId: 's1', missingDays: 1 }], summary: { present: 3, absent: 1, leave: 1 } };

function setup() {
  return createAttendanceAnalyticsService({
    schoolId: 'school-a',
    now: () => '2026-10-01T00:00:00.000Z',
    studentOverview: { async overview(filters) { this.filters = filters; return studentReport; } },
    staffOverview: { async overview() { return staffReport; } },
    rawProvider: {
      async studentRecords() { return [
        { id: 'old', studentId: 'a', date: '2026-09-01', status: 'ABSENT', version: 1, updatedAt: '2026-09-01T08:00:00Z' },
        { id: 'new', studentId: 'a', date: '2026-09-01', status: 'PRESENT', version: 2, updatedAt: '2026-09-01T09:00:00Z' },
        { studentId: 'b', date: '2026-09-02', status: 'PRESENT', version: 1 },
        { studentId: 'b', date: '2026-09-03', status: 'PRESENT', version: 1 },
        { studentId: 'c', date: '2026-09-04', status: 'ABSENT', version: 1 },
        { studentId: 'sample', date: '2026-09-04', status: 'ABSENT', version: 1, provenance: 'TEST' }
      ]; },
      async staffRecords() { return []; }
    }
  });
}

test('analytics composes canonical student/staff reports and exposes KPI contract', async () => {
  const result = await setup().overview({ month: '2026-09' }, actor());
  assert.equal(result.authoritative, true);
  assert.equal(result.summary.students.presentStudentDays, 4);
  assert.equal(result.summary.staff.approvedLeave, 1);
  assert.equal(result.studentDistribution.items.find((item) => item.label === 'Unmarked').count, 1);
  assert.equal(result.classAttendance.length, 13);
  assert.equal(result.classAttendance.find((item) => item.className === 'Primary 1').attendanceRate, 66.67);
  assert.equal(result.coverage.students.unmarkedIsNotAbsent, true);
});

test('duplicate daily marks use the latest version and sample records are excluded', async () => {
  const result = await setup().overview({}, actor());
  assert.equal(result.trends.students.daily.find((item) => item.period === '2026-09-01').present, 1);
  assert.equal(result.histogram.eligiblePopulation, 3);
});

test('daily trends omit dates without actual observations while weekly/monthly/term datasets are available', async () => {
  const result = await setup().overview({}, actor());
  assert.deepEqual(result.trends.students.daily.map((item) => item.period), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  assert.equal(result.trends.students.weekly.length, 1);
  assert.equal(result.trends.students.monthly.length, 1);
  assert.equal(result.trends.students.term.length, 1);
});

test('histogram assigns 100 percent to the final 80–100 bucket', () => {
  const service = setup();
  const histogram = service.histogram([{ studentId: 'perfect', date: '2026-09-01', status: 'PRESENT' }]);
  assert.equal(histogram.eligiblePopulation, 1);
  assert.equal(histogram.buckets.at(-1).count, 1);
  assert.equal(histogram.buckets.slice(0, -1).reduce((sum, bucket) => sum + bucket.count, 0), 0);
});

test('teacher analytics retains server-side assigned-class scope and rejects missing scope', async () => {
  const service = setup();
  const result = await service.overview({ classId: 'primary-1' }, actor('TEACHER', ['attendance.read']));
  await assert.rejects(() => service.overview({}, { ...actor('TEACHER', ['attendance.read']), assignedClassIds: [] }), (error) => error.code === 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
  assert.equal(result.authoritative, true);
});

test('invalid reporting filters fail closed', async () => {
  await assert.rejects(() => setup().overview({ week: 'not-a-week' }, actor()), /ISO YYYY-Www/);
  await assert.rejects(() => setup().overview({ startDate: '2026-09-01' }, actor()), /requires startDate and endDate/);
});
