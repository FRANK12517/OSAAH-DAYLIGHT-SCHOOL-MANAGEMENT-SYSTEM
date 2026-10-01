import test from 'node:test';
import assert from 'node:assert/strict';
import { configureThreeTerms, readThreeTermPreflight, THREE_TERM_CONFIGURATION } from '../src/production-three-term-config.js';

function database({ terms = [] } = {}) {
  const state = {
    schools: [{ id: 'sch_default_01', name: 'OsaaH Daylight School' }],
    years: [{ id: 'ay_2026_01', schoolId: 'sch_default_01', name: '2026/2027 Academic Year', startsOn: '2026-09-01', endsOn: '2027-07-31' }],
    terms: structuredClone(terms),
    writes: 0
  };
  const query = async (sql, params = []) => {
    if (sql.includes('FROM schools')) return state.schools.filter((row) => row.id === params[0]);
    if (sql.includes('FROM academic_years')) return state.years.filter((row) => row.id === params[0] && row.schoolId === params[1]);
    if (sql.includes('information_schema.STATISTICS')) return [{ indexName: 'terms_academic_year_name', nonUnique: 0, columns: 'academic_year_id,name' }];
    if (sql.includes('WHERE id IN')) return state.terms.filter((row) => params.includes(row.id));
    if (sql.includes('FROM terms')) return state.terms.filter((row) => row.academicYearId === params[0]);
    throw new Error(`Unhandled query: ${sql}`);
  };
  const execute = async (sql, params) => {
    assert.match(sql, /INSERT INTO terms/);
    state.writes += 1;
    const [id, academicYearId, name, startsOn, endsOn, isCurrent, createdAt, updatedAt] = params;
    state.terms.push({ id, academicYearId, name, startsOn, endsOn, isCurrent, createdAt, updatedAt });
    return { affectedRows: 1 };
  };
  return {
    state,
    query,
    execute,
    async transaction(work) {
      const snapshot = structuredClone(state.terms);
      const tx = { query, execute };
      try { return await work(tx); } catch (error) { state.terms = snapshot; throw error; }
    }
  };
}

const firstTerm = { id: 'term_2026_01', academicYearId: 'ay_2026_01', name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18', isCurrent: 1 };

test('preflight recognizes the approved school, academic year, ID convention, and uniqueness contract', async () => {
  const result = await readThreeTermPreflight(database({ terms: [firstTerm] }), { databaseName: 'osaahdaylightschool' });
  assert.equal(result.checks.school, true);
  assert.equal(result.checks.academicYear, true);
  assert.equal(result.checks.firstTerm, true);
  assert.equal(result.checks.uniqueness, true);
  assert.deepEqual(result.targetIds, ['term_2026_01']);
});

test('apply inserts only Second and Third Term with approved sample dates', async () => {
  const db = database({ terms: [firstTerm] });
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', clock: () => '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(result.inserted, ['Second Term', 'Third Term']);
  assert.equal(db.state.writes, 2);
  assert.deepEqual(db.state.terms.map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })), [
    { id: 'term_2026_01', name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18' },
    { id: 'term_2026_02', name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' },
    { id: 'term_2026_03', name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23' }
  ]);
  assert.equal(result.after.terms.length, 3);
  assert.deepEqual(THREE_TERM_CONFIGURATION.secondTerm, { id: 'term_2026_02', name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' });
});

test('rerunning the configuration is idempotent and writes no duplicates', async () => {
  const db = database({ terms: [firstTerm] });
  await configureThreeTerms(db, { databaseName: 'osaahdaylightschool' });
  const second = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool' });
  assert.deepEqual(second.inserted, []);
  assert.equal(db.state.writes, 2);
  assert.equal(db.state.terms.length, 3);
});

test('conflicting existing term data fails closed before any write', async () => {
  const db = database({ terms: [firstTerm, { id: 'term_2026_02', academicYearId: 'ay_2026_01', name: 'Second Term', startsOn: '2027-01-12', endsOn: '2027-04-09' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'TERM_CONFLICT');
  assert.equal(db.state.writes, 0);
});

test('dry-run performs the complete preflight without writing', async () => {
  const db = database({ terms: [firstTerm] });
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(result.inserted, []);
  assert.equal(db.state.writes, 0);
});
