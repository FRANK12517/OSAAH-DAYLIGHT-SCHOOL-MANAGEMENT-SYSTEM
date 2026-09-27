import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleSchoolOverviewService } from '../src/single-school-overview.js';

test('single-school overview aggregates canonical in-memory records without sample data', async () => {
  const actor = { id: 'u1', schoolId: 'school-osaah-daylight', roleKey: 'PROPRIETOR', permissions: new Set(['*']) };
  const students = { listStudents: () => [{ id: 's1', schoolId: actor.schoolId, gender: 'MALE', classId: 'Primary 1' }, { id: 's2', schoolId: actor.schoolId, gender: 'FEMALE', classId: 'JHS 1' }] };
  const staff = { listProfiles: () => [{ schoolId: actor.schoolId, roleKey: 'TEACHER', employmentStatus: 'ACTIVE' }] };
  const service = createSingleSchoolOverviewService({ schoolId: actor.schoolId, schoolSettings: { read: async () => ({ schoolId: actor.schoolId, profile: { name: 'OSAAH DAYLIGHT SCHOOL' }, academicYears: [], terms: [] }) }, students, staff, attendance: { summary: () => ({ records: [] }), staffSummary: () => ({ records: [] }) } });
  const result = await service.getOverview(actor);
  assert.equal(result.overview.totalStudents, 2);
  assert.equal(result.overview.boys, 1);
  assert.equal(result.overview.girls, 1);
  assert.equal(result.overview.teachers, 1);
  assert.deepEqual(result.quickActions.find((item) => item.label === 'School Settings')?.route, '/settings');
});

test('single-school overview rejects unauthenticated and cross-school actors', async () => {
  const service = createSingleSchoolOverviewService({ schoolId: 'school-osaah-daylight', schoolSettings: { read: async () => ({ schoolId: 'school-osaah-daylight', profile: {}, academicYears: [], terms: [] }) } });
  await assert.rejects(() => service.getOverview(null), { status: 403 });
  await assert.rejects(() => service.getOverview({ schoolId: 'other-school', permissions: new Set(['*']) }), { status: 403 });
});
