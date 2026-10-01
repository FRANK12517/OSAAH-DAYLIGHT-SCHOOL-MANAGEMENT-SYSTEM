import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureThreeTerms,
  detectAcademicYearNameUniqueIndexes,
  readThreeTermPreflight,
  THREE_TERM_CONFIGURATION
} from '../src/production-three-term-config.js';

const firstTerm = { id: 'term_2026_01', schoolId: 'sch_default_01', academicYearId: 'ay_2026_01', termNumber: 1, name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18', isCurrent: 1 };
const secondTerm = { id: 'term_2026_02', schoolId: 'sch_default_01', academicYearId: 'ay_2026_01', termNumber: 2, name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09', isCurrent: 0 };
const thirdTerm = { id: 'term_2026_03', schoolId: 'sch_default_01', academicYearId: 'ay_2026_01', termNumber: 3, name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23', isCurrent: 0 };
const uniqueIndexRows = [
  { tableSchema: 'osaahdaylightschool', tableName: 'terms', indexName: 'terms_year_term_name_unique', nonUnique: 0, seqInIndex: 1, columnName: 'academic_year_id', subPart: null },
  { tableSchema: 'osaahdaylightschool', tableName: 'terms', indexName: 'terms_year_term_name_unique', nonUnique: 0, seqInIndex: 2, columnName: 'name', subPart: null }
];

function database({ terms = [firstTerm], indexRows = uniqueIndexRows } = {}) {
  const state = { schools: [{ id: 'sch_default_01', name: 'OsaaH Daylight School' }], terms: structuredClone(terms), writes: 0 };
  const query = async (sql, params = []) => {
    if (sql.includes('FROM schools')) return state.schools.filter((row) => row.id === params[0]);
    if (sql.includes('FROM academic_years')) return [{ id: 'ay_2026_01', schoolId: 'sch_default_01', name: '2026/2027 Academic Year', startsOn: '2026-09-01', endsOn: '2027-07-31' }];
    if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return structuredClone(indexRows);
    if (sql.includes('WHERE id IN')) return state.terms.filter((row) => params.includes(row.id));
    if (sql.includes('FROM terms')) return state.terms.filter((row) => row.academicYearId === params[0]);
    throw new Error(`Unhandled query: ${sql}`);
  };
  const execute = async (sql, params) => {
    assert.match(sql, /INSERT INTO terms/);
    assert.match(sql, /id,school_id,academic_year_id,name,term_number,starts_on,ends_on,is_current,created_at/);
    assert.doesNotMatch(sql, /updated_at/i);
    state.writes += 1;
    const [id, schoolId, academicYearId, name, termNumber, startsOn, endsOn, isCurrent, createdAt] = params;
    state.terms.push({ id, schoolId, academicYearId, name, termNumber, startsOn, endsOn, isCurrent, createdAt });
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

function tidbIndexRows({ schema = 'osaahdaylightschool', table = 'terms', index = 'PRIMARY', unique = 0, columns = ['academic_year_id', 'name'], prefixes = [] } = {}) {
  return columns.map((columnName, indexPosition) => ({
    TABLE_SCHEMA: schema,
    TABLE_NAME: table,
    INDEX_NAME: index,
    NON_UNIQUE: unique,
    SEQ_IN_INDEX: indexPosition + 1,
    COLUMN_NAME: columnName,
    SUB_PART: prefixes[indexPosition] ?? null
  }));
}

test('first term plus missing second and third passes dry-run with two planned writes', async () => {
  const db = database({ terms: [firstTerm] });
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.before.checks.secondTerm, false);
  assert.equal(result.before.checks.thirdTerm, false);
  assert.equal(result.safeToApply, true);
  assert.equal(result.configurationComplete, false);
  assert.deepEqual(result.plannedWrites, ['Second Term', 'Third Term']);
  assert.equal(result.plannedWriteCount, 2);
  assert.equal(db.state.writes, 0);
});

test('preflight queries are serialized to avoid concurrent TiDB pool acquisition', async () => {
  const db = database({ terms: [firstTerm] });
  let active = 0;
  let maximumActive = 0;
  const query = db.query;
  db.query = async (...args) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    try { return await query(...args); } finally { active -= 1; }
  };
  await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(maximumActive, 1);
});

test('first and correct second term plus missing third passes with one planned write', async () => {
  const result = await configureThreeTerms(database({ terms: [firstTerm, secondTerm] }), { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(result.safeToApply, true);
  assert.equal(result.before.checks.secondTerm, true);
  assert.equal(result.before.checks.thirdTerm, false);
  assert.deepEqual(result.plannedWrites, ['Third Term']);
  assert.equal(result.plannedWriteCount, 1);
});

test('all three correct terms pass dry-run with zero planned writes and complete configuration', async () => {
  const result = await configureThreeTerms(database({ terms: [firstTerm, secondTerm, thirdTerm] }), { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(result.safeToApply, true);
  assert.equal(result.configurationComplete, true);
  assert.deepEqual(result.plannedWrites, []);
  assert.equal(result.plannedWriteCount, 0);
});

test('TiDB INFORMATION_SCHEMA row representation recognizes a PRIMARY composite unique index', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows()), [{
    schema: 'osaahdaylightschool', table: 'terms', indexName: 'PRIMARY', nonUnique: 0, columns: ['academic_year_id', 'name']
  }]);
});

test('an arbitrary unique index name is accepted when ordered semantic columns match', () => {
  const rows = tidbIndexRows({ index: 'custom_business_key' });
  assert.equal(detectAcademicYearNameUniqueIndexes(rows).length, 1);
});

test('a NON_UNIQUE index does not satisfy the contract', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ unique: 1 })), []);
});

test('wrong column order does not satisfy the contract', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ columns: ['name', 'academic_year_id'] })), []);
});

test('an index with extra columns does not satisfy the exact contract', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ columns: ['academic_year_id', 'name', 'school_id'] })), []);
});

test('metadata from another schema or table does not satisfy the contract', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ schema: 'other_database' })), []);
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ table: 'academic_years' })), []);
});

test('prefix uniqueness does not satisfy full-column uniqueness', () => {
  assert.deepEqual(detectAcademicYearNameUniqueIndexes(tidbIndexRows({ prefixes: [null, 12] })), []);
});

test('preflight fails closed when the uniqueness guarantee is absent', async () => {
  await assert.rejects(
    () => configureThreeTerms(database({ indexRows: [] }), { databaseName: 'osaahdaylightschool', dryRun: true }),
    (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('uniqueness')
  );
});

test('duplicate names fail before any write', async () => {
  const db = database({ terms: [firstTerm, { ...secondTerm, id: 'another-id', name: 'FIRST TERM' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('noDuplicateNames'));
  assert.equal(db.state.writes, 0);
});

test('equivalent duplicate desired-term name fails before any write', async () => {
  const db = database({ terms: [firstTerm, secondTerm, { ...secondTerm, id: 'another-id', name: '  second term  ' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && (error.details.failed.includes('noEquivalentDuplicateNames') || error.details.failed.includes('noDuplicateNames')));
  assert.equal(db.state.writes, 0);
});

test('legacy ordinal aliases are treated as equivalent conflicts and never silently duplicated', async () => {
  const db = database({ terms: [{ ...firstTerm, name: '1st Term' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && (error.details.failed.includes('firstTerm') || error.details.failed.includes('noEquivalentDuplicateNames')));
  assert.equal(db.state.writes, 0);
});

test('duplicate production term_number conflicts fail before any write', async () => {
  const db = database({ terms: [firstTerm, { ...secondTerm, termNumber: 1, name: 'Midterm' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('noDuplicateTermNumbers'));
  assert.equal(db.state.writes, 0);
});

test('target ID owned by another academic year fails before any write', async () => {
  const db = database({ terms: [firstTerm, { ...secondTerm, academicYearId: 'ay_other' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('targetIdsAvailableOrOwned'));
  assert.equal(db.state.writes, 0);
});

test('wrong Second Term dates fail before any write', async () => {
  const db = database({ terms: [firstTerm, { ...secondTerm, startsOn: '2027-01-12' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('noConflictingTerms'));
  assert.equal(db.state.writes, 0);
});

test('wrong Third Term dates fail before any write', async () => {
  const db = database({ terms: [firstTerm, { ...thirdTerm, endsOn: '2027-07-22' }] });
  await assert.rejects(() => configureThreeTerms(db, { databaseName: 'osaahdaylightschool' }), (error) => error.code === 'THREE_TERM_PREFLIGHT_FAILED' && error.details.failed.includes('noConflictingTerms'));
  assert.equal(db.state.writes, 0);
});

test('apply creates only missing rows and leaves an existing correct term unchanged', async () => {
  const db = database({ terms: [firstTerm, secondTerm] });
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', clock: () => '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(result.inserted, ['Third Term']);
  assert.equal(result.plannedWriteCount, 1);
  assert.equal(db.state.writes, 1);
  assert.equal(result.configurationComplete, true);
  assert.deepEqual(db.state.terms.map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })), [
    { id: firstTerm.id, name: firstTerm.name, startsOn: firstTerm.startsOn, endsOn: firstTerm.endsOn },
    { id: secondTerm.id, name: secondTerm.name, startsOn: secondTerm.startsOn, endsOn: secondTerm.endsOn },
    { id: thirdTerm.id, name: thirdTerm.name, startsOn: thirdTerm.startsOn, endsOn: thirdTerm.endsOn }
  ]);
});

test('apply creates missing Second and Third terms using approved dates', async () => {
  const db = database({ terms: [firstTerm] });
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', clock: () => '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(result.inserted, ['Second Term', 'Third Term']);
  assert.equal(db.state.writes, 2);
  assert.deepEqual(db.state.terms.map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })), [firstTerm, secondTerm, thirdTerm].map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })));
  assert.equal(result.after.desiredState.configurationComplete, true);
  assert.deepEqual(THREE_TERM_CONFIGURATION.secondTerm, { id: 'term_2026_02', termNumber: 2, name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' });
});

test('reapplying is idempotent and writes no duplicates', async () => {
  const db = database({ terms: [firstTerm] });
  await configureThreeTerms(db, { databaseName: 'osaahdaylightschool' });
  const second = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool' });
  assert.deepEqual(second.inserted, []);
  assert.equal(second.plannedWriteCount, 0);
  assert.equal(db.state.writes, 2);
  assert.equal(db.state.terms.length, 3);
});

test('post-apply dry-run reports zero planned writes and performs no writes', async () => {
  const db = database({ terms: [firstTerm] });
  await configureThreeTerms(db, { databaseName: 'osaahdaylightschool' });
  const writesBeforeDryRun = db.state.writes;
  const result = await configureThreeTerms(db, { databaseName: 'osaahdaylightschool', dryRun: true });
  assert.equal(result.configurationComplete, true);
  assert.equal(result.plannedWriteCount, 0);
  assert.deepEqual(result.plannedWrites, []);
  assert.equal(db.state.writes, writesBeforeDryRun);
});
