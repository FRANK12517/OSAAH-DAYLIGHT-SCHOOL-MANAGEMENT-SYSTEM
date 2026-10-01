import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../scripts/production-sample-fixture-seed.mjs';
import { TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const databaseName = 'osaahdaylightschool';
const schoolId = 'sch_default_01';
const canonicalYear = { id: 'ay_2026_01', name: '2026/2027 Academic Year' };
const canonicalTerms = [
  { id: 'term_2026_01', name: 'First Term', academicYearId: canonicalYear.id },
  { id: 'term_2026_02', name: 'Second Term', academicYearId: canonicalYear.id },
  { id: 'term_2026_03', name: 'Third Term', academicYearId: canonicalYear.id }
];

function database({ missingYear = false } = {}) {
  const calls = [];
  let writes = 0;
  return {
    calls,
    get writes() { return writes; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT DATABASE()')) return [{ databaseName }];
      if (sql.includes('information_schema.TABLES')) return [{ tableName: 'sample_data_fixtures' }];
      if (sql.includes('FROM schema_migrations')) return [{ version: 61, name: '061_durable_sample_data_fixtures.sql', checksum: 'verified' }];
      if (sql.includes('FROM academic_years')) {
        assert.match(sql, /WHERE id=\? AND school_id=\?/);
        assert.deepEqual(params, [canonicalYear.id, schoolId]);
        return missingYear ? [] : [canonicalYear];
      }
      if (sql.includes('FROM terms')) {
        const [yearId, requestedName] = params;
        assert.equal(yearId, canonicalYear.id);
        const wanted = String(requestedName).toLowerCase().replace(/^(1st|2nd|3rd) term$/, (_, ordinal) => ({ '1st': 'first', '2nd': 'second', '3rd': 'third' })[ordinal] + ' term');
        return canonicalTerms.filter((term) => term.name.toLowerCase() === wanted).slice(0, 1);
      }
      if (sql.includes('FROM classes')) {
        assert.deepEqual(params, [schoolId]);
        return [{ id: 'class_primary_6', name: 'Primary 6' }];
      }
      throw new Error(`Unexpected query in production fixture planner: ${sql}`);
    },
    async execute() {
      writes += 1;
      throw new Error('Fixture planning must not execute database writes.');
    }
  };
}

test('production fixture dry-run resolves the verified canonical year ID despite its longer display name', async () => {
  const db = database();
  const plan = await buildPlan(db, { schoolId });

  assert.equal(plan.databaseName, databaseName);
  assert.deepEqual(plan.year, canonicalYear);
  assert.deepEqual(plan.terms, canonicalTerms);
  assert.equal(plan.rows.length, 6);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.sampleStudentId))], TEST_PARENT_STUDENT_IDS);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.academicYearId))], [canonicalYear.id]);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.schoolId))], [schoolId]);
  assert.deepEqual([...new Set(plan.rows.map((row) => row.termId))], canonicalTerms.map((term) => term.id));
  assert.ok(plan.rows.every((row) => row.academicYearName === canonicalYear.name && row.fixtureType === 'attendance' && row.fixturePayload.provenance === 'TEST'));
  assert.equal(new Set(plan.rows.map((row) => [row.schoolId, row.sampleStudentId, row.academicYearId, row.termId, row.classId, row.fixtureType, row.fixtureVersion].join('|'))).size, plan.rows.length);
  assert.equal(db.writes, 0);
});

test('fixture planning is repeatable and idempotent without executing writes', async () => {
  const db = database();
  const first = await buildPlan(db, { schoolId });
  const second = await buildPlan(db, { schoolId });

  assert.deepEqual(second, first);
  assert.equal(db.writes, 0);
});

test('missing canonical school-owned academic year fails closed before term/class planning', async () => {
  const db = database({ missingYear: true });

  await assert.rejects(() => buildPlan(db, { schoolId }), (error) => error.code === 'SAMPLE_FIXTURE_CONTEXT_MISSING');
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM terms')), false);
  assert.equal(db.calls.some(({ sql }) => sql.includes('FROM classes')), false);
  assert.equal(db.writes, 0);
});
