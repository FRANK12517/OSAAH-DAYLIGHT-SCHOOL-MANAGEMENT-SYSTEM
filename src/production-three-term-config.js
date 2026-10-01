const EXPECTED_DATABASE = 'osaahdaylightschool';
export const THREE_TERM_CONFIGURATION = Object.freeze({
  schoolId: 'sch_default_01',
  academicYearId: 'ay_2026_01',
  academicYearName: '2026/2027 Academic Year',
  academicYearStartsOn: '2026-09-01',
  academicYearEndsOn: '2027-07-31',
  firstTerm: Object.freeze({ id: 'term_2026_01', name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18' }),
  secondTerm: Object.freeze({ id: 'term_2026_02', name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' }),
  thirdTerm: Object.freeze({ id: 'term_2026_03', name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23' })
});

const rows = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number(value ?? 0);
const same = (actual, expected) => String(actual ?? '') === String(expected ?? '');
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

function termSnapshot(term) {
  return term ? {
    id: term.id,
    academicYearId: term.academicYearId ?? term.academic_year_id,
    name: term.name,
    startsOn: term.startsOn ?? term.starts_on,
    endsOn: term.endsOn ?? term.ends_on,
    isCurrent: term.isCurrent ?? term.is_current ?? 0
  } : null;
}

function validateTerm(term, expected) {
  if (!term) return false;
  return same(term.id, expected.id) && same(term.name, expected.name)
    && same(term.startsOn ?? term.starts_on, expected.startsOn)
    && same(term.endsOn ?? term.ends_on, expected.endsOn);
}

export async function readThreeTermPreflight(database, { databaseName = null } = {}) {
  if (!database?.query) fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.');
  if (databaseName && databaseName !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: databaseName });
  const config = THREE_TERM_CONFIGURATION;
  const [schools, years, terms, targetIds, uniqueness] = await Promise.all([
    database.query('SELECT id,name FROM schools WHERE id=? LIMIT 1', [config.schoolId]),
    database.query('SELECT id,school_id AS schoolId,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE id=? AND school_id=? LIMIT 1', [config.academicYearId, config.schoolId]),
    database.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM terms WHERE academic_year_id=? ORDER BY starts_on ASC,id', [config.academicYearId]),
    database.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn FROM terms WHERE id IN (?,?,?)', [config.firstTerm.id, config.secondTerm.id, config.thirdTerm.id]),
    database.query(`SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='terms'
      GROUP BY INDEX_NAME, NON_UNIQUE`)
  ]);
  const school = rows(schools)[0] ?? null;
  const academicYear = rows(years)[0] ?? null;
  const relevantTerms = rows(terms).map(termSnapshot);
  const names = relevantTerms.map((term) => String(term.name ?? '').trim().toLowerCase());
  const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  const uniqueAcademicYearName = rows(uniqueness).some((index) => Number(index.nonUnique) === 0 && String(index.columns).toLowerCase() === 'academic_year_id,name');
  const expectedNames = [config.firstTerm.name, config.secondTerm.name, config.thirdTerm.name].map((name) => name.toLowerCase());
  return {
    database: databaseName ?? null,
    school: school ? { id: school.id, name: school.name } : null,
    academicYear,
    terms: relevantTerms,
    targetIds: rows(targetIds).map((row) => row.id),
    duplicateNames,
    uniqueness: { academicYearName: uniqueAcademicYearName },
    checks: {
      school: same(school?.id, config.schoolId),
      academicYear: same(academicYear?.id, config.academicYearId) && same(academicYear?.schoolId, config.schoolId) && same(academicYear?.name, config.academicYearName) && same(academicYear?.startsOn, config.academicYearStartsOn) && same(academicYear?.endsOn, config.academicYearEndsOn),
      firstTerm: relevantTerms.some((term) => validateTerm(term, config.firstTerm)),
      secondTerm: relevantTerms.some((term) => validateTerm(term, config.secondTerm)),
      thirdTerm: relevantTerms.some((term) => validateTerm(term, config.thirdTerm)),
      noEquivalentDuplicateNames: expectedNames.every((name) => names.filter((actual) => actual === name).length <= 1),
      noDuplicateNames: duplicateNames.length === 0,
      targetIdsAvailableOrOwned: rows(targetIds).every((row) => [config.firstTerm.id, config.secondTerm.id, config.thirdTerm.id].includes(row.id) && same(row.academicYearId, config.academicYearId)),
      uniqueness: uniqueAcademicYearName
    }
  };
}

function assertSafePreflight(preflight) {
  const required = ['school', 'academicYear', 'noEquivalentDuplicateNames', 'noDuplicateNames', 'targetIdsAvailableOrOwned', 'uniqueness'];
  const failed = required.filter((key) => !preflight.checks[key]);
  if (!preflight.checks.firstTerm) failed.push('firstTerm');
  if (failed.length) fail('THREE_TERM_PREFLIGHT_FAILED', 'Three-term configuration preflight failed; no data was written.', { failed, preflight });
  for (const term of [THREE_TERM_CONFIGURATION.secondTerm, THREE_TERM_CONFIGURATION.thirdTerm]) {
    const existing = preflight.terms.find((row) => row.id === term.id || String(row.name).toLowerCase() === term.name.toLowerCase());
    if (existing && !validateTerm(existing, term)) fail('TERM_CONFLICT', `Existing ${term.name} conflicts with the approved configuration.`, { existing, expected: term });
  }
}

export async function configureThreeTerms(database, { databaseName = null, clock = () => new Date().toISOString(), dryRun = false } = {}) {
  const before = await readThreeTermPreflight(database, { databaseName });
  assertSafePreflight(before);
  if (dryRun) return { ok: true, mode: 'dry-run', before, inserted: [] };
  if (!database.transaction) fail('DATABASE_TRANSACTION_REQUIRED', 'A transaction-capable database adapter is required for production writes.');
  const inserted = await database.transaction(async (tx) => {
    const current = await readThreeTermPreflight(tx, { databaseName });
    assertSafePreflight(current);
    const created = [];
    const now = clock();
    for (const term of [THREE_TERM_CONFIGURATION.secondTerm, THREE_TERM_CONFIGURATION.thirdTerm]) {
      const existing = current.terms.find((row) => row.id === term.id || String(row.name).toLowerCase() === term.name.toLowerCase());
      if (existing) continue;
      await tx.execute(`INSERT INTO terms (id,academic_year_id,name,starts_on,ends_on,is_current,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, [term.id, THREE_TERM_CONFIGURATION.academicYearId, term.name, term.startsOn, term.endsOn, 0, now, now]);
      created.push(term.name);
      current.terms.push({ id: term.id, academicYearId: THREE_TERM_CONFIGURATION.academicYearId, name: term.name, startsOn: term.startsOn, endsOn: term.endsOn, isCurrent: 0 });
    }
    return created;
  });
  const after = await readThreeTermPreflight(database, { databaseName });
  const expected = [THREE_TERM_CONFIGURATION.firstTerm, THREE_TERM_CONFIGURATION.secondTerm, THREE_TERM_CONFIGURATION.thirdTerm];
  const relevant = after.terms.filter((term) => expected.some((item) => item.name === term.name));
  if (relevant.length !== 3 || !expected.every((term) => relevant.some((row) => validateTerm(row, term)))) fail('THREE_TERM_POSTWRITE_FAILED', 'Post-write verification did not find the exact three configured terms.', { after });
  return { ok: true, mode: 'apply', before, inserted, after };
}

export default configureThreeTerms;
