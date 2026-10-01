import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProductionTerms } from '../scripts/production-three-term-inventory.mjs';

const expected = [
  { id: 'term_2026_01', academicYearId: 'ay_2026_01', name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18', isCurrent: 1 },
  { id: 'term_2026_02', academicYearId: 'ay_2026_01', name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09', isCurrent: 0 },
  { id: 'term_2026_03', academicYearId: 'ay_2026_01', name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23', isCurrent: 0 }
];

function poolFactory() {
  return {
    async query(sql) {
      if (sql.includes('SELECT DATABASE')) return [[{ databaseName: 'osaahdaylightschool' }], []];
      if (sql.includes('FROM schools')) return [[{ id: 'sch_default_01', name: 'OsaaH Daylight School' }], []];
      if (sql.includes('FROM academic_years')) return [[{ id: 'ay_2026_01', schoolId: 'sch_default_01', name: '2026/2027 Academic Year', startsOn: '2026-09-01', endsOn: '2027-07-31' }], []];
      if (sql.includes('WHERE academic_year_id=?')) return [expected, []];
      if (sql.includes('WHERE id IN')) return [expected, []];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async end() {}
  };
}

test('read-only inventory certifies the exact canonical three-term state', async () => {
  const result = await inspectProductionTerms({ databaseUrl: 'protected', poolFactory });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'READ_ONLY_THREE_TERM_INVENTORY');
  assert.equal(result.productionWrites, 'NONE');
  assert.equal(result.checks.expectedDatabase, true);
  assert.equal(result.checks.exactApprovedConfiguration, true);
  assert.equal(result.checks.exactlyThreeRows, true);
  assert.equal(result.checks.duplicateNames, true);
  assert.equal(result.checks.duplicateIds, true);
});

test('inventory never requires or exposes a missing protected credential', async () => {
  const result = await inspectProductionTerms({ databaseUrl: '' });
  assert.deepEqual(result, { ok: false, error: { code: 'DATABASE_URL_MISSING' } });
});
