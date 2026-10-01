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
const same = (actual, expected) => String(actual ?? '') === String(expected ?? '');
const normalize = (value) => String(value ?? '').trim().toLowerCase();
const field = (row, camel, upper) => row?.[camel] ?? row?.[upper];
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
    && same(term.academicYearId ?? term.academic_year_id, THREE_TERM_CONFIGURATION.academicYearId)
    && same(term.startsOn ?? term.starts_on, expected.startsOn)
    && same(term.endsOn ?? term.ends_on, expected.endsOn);
}

/**
 * Recognize the semantic uniqueness contract from INFORMATION_SCHEMA.STATISTICS.
 * No index name is prescribed: any full-column unique index on exactly
 * (academic_year_id, name), in that order, satisfies the contract.
 */
export function detectAcademicYearNameUniqueIndexes(indexRows, {
  schemaName = EXPECTED_DATABASE,
  tableName = 'terms'
} = {}) {
  const indexes = new Map();
  for (const row of rows(indexRows)) {
    const schema = field(row, 'tableSchema', 'TABLE_SCHEMA');
    const table = field(row, 'tableName', 'TABLE_NAME');
    const indexName = field(row, 'indexName', 'INDEX_NAME');
    const nonUnique = field(row, 'nonUnique', 'NON_UNIQUE');
    const sequence = Number(field(row, 'seqInIndex', 'SEQ_IN_INDEX'));
    const column = field(row, 'columnName', 'COLUMN_NAME');
    const prefixLength = field(row, 'subPart', 'SUB_PART');
    if (normalize(schema) !== normalize(schemaName) || normalize(table) !== normalize(tableName)) continue;
    if (indexName == null || nonUnique == null || !Number.isFinite(sequence) || sequence < 1 || !column) continue;
    const key = `${normalize(schema)}\u0000${normalize(table)}\u0000${String(indexName)}\u0000${String(nonUnique)}`;
    const group = indexes.get(key) ?? { schema, table, indexName, nonUnique, columns: [] };
    group.columns.push({ sequence, name: normalize(column), prefixLength });
    indexes.set(key, group);
  }

  return [...indexes.values()]
    .filter((index) => {
      if (Number(index.nonUnique) !== 0 || index.columns.length !== 2) return false;
      const columns = [...index.columns].sort((left, right) => left.sequence - right.sequence);
      return columns[0].sequence === 1 && columns[1].sequence === 2
        && columns[0].name === 'academic_year_id' && columns[1].name === 'name'
        && columns.every((column) => column.prefixLength == null);
    })
    .map((index) => ({
      schema: index.schema,
      table: index.table,
      indexName: index.indexName,
      nonUnique: Number(index.nonUnique),
      columns: ['academic_year_id', 'name']
    }));
}

function stateForTerm(terms, expected) {
  const existing = terms.find((term) => term.id === expected.id || normalize(term.name) === normalize(expected.name)) ?? null;
  if (!existing) return { status: 'missing', term: null };
  return { status: validateTerm(existing, expected) ? 'correct' : 'conflict', term: existing };
}

export async function readThreeTermPreflight(database, { databaseName = null } = {}) {
  if (!database?.query) fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.');
  if (databaseName && databaseName !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: databaseName });
  const config = THREE_TERM_CONFIGURATION;
  const schemaName = databaseName ?? EXPECTED_DATABASE;
  const [schools, years, terms, targetIds, indexRows] = await Promise.all([
    database.query('SELECT id,name FROM schools WHERE id=? LIMIT 1', [config.schoolId]),
    database.query('SELECT id,school_id AS schoolId,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE id=? AND school_id=? LIMIT 1', [config.academicYearId, config.schoolId]),
    database.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM terms WHERE academic_year_id=? ORDER BY starts_on ASC,id', [config.academicYearId]),
    database.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn FROM terms WHERE id IN (?,?,?)', [config.firstTerm.id, config.secondTerm.id, config.thirdTerm.id]),
    database.query(`SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, INDEX_NAME AS indexName,
        NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [schemaName, 'terms'])
  ]);
  const school = rows(schools)[0] ?? null;
  const academicYear = rows(years)[0] ?? null;
  const relevantTerms = rows(terms).map(termSnapshot);
  const names = relevantTerms.map((term) => normalize(term.name));
  const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  const matchingUniqueIndexes = detectAcademicYearNameUniqueIndexes(indexRows, { schemaName });
  const expectedNames = [config.firstTerm.name, config.secondTerm.name, config.thirdTerm.name].map(normalize);
  const secondTerm = stateForTerm(relevantTerms, config.secondTerm);
  const thirdTerm = stateForTerm(relevantTerms, config.thirdTerm);
  const conflicts = [secondTerm, thirdTerm].filter((state) => state.status === 'conflict').map((state) => state.term);
  const checks = {
    school: same(school?.id, config.schoolId),
    academicYear: same(academicYear?.id, config.academicYearId) && same(academicYear?.schoolId, config.schoolId) && same(academicYear?.name, config.academicYearName) && same(academicYear?.startsOn, config.academicYearStartsOn) && same(academicYear?.endsOn, config.academicYearEndsOn),
    firstTerm: relevantTerms.some((term) => validateTerm(term, config.firstTerm)),
    secondTerm: secondTerm.status === 'correct',
    thirdTerm: thirdTerm.status === 'correct',
    noEquivalentDuplicateNames: expectedNames.every((name) => names.filter((actual) => actual === name).length <= 1),
    noDuplicateNames: duplicateNames.length === 0,
    targetIdsAvailableOrOwned: rows(targetIds).every((row) => [config.firstTerm.id, config.secondTerm.id, config.thirdTerm.id].includes(row.id) && same(row.academicYearId, config.academicYearId)),
    uniqueness: matchingUniqueIndexes.length > 0,
    noConflictingTerms: conflicts.length === 0
  };
  const requiredSafetyChecks = ['school', 'academicYear', 'firstTerm', 'noEquivalentDuplicateNames', 'noDuplicateNames', 'targetIdsAvailableOrOwned', 'uniqueness', 'noConflictingTerms'];
  const plannedWrites = [
    ...(secondTerm.status === 'missing' ? [config.secondTerm.name] : []),
    ...(thirdTerm.status === 'missing' ? [config.thirdTerm.name] : [])
  ];
  const configurationComplete = secondTerm.status === 'correct' && thirdTerm.status === 'correct';
  return {
    database: databaseName ?? null,
    school: school ? { id: school.id, name: school.name } : null,
    academicYear,
    terms: relevantTerms,
    targetIds: rows(targetIds).map((row) => row.id),
    duplicateNames,
    uniqueness: { academicYearName: matchingUniqueIndexes.length > 0, matchingIndexes: matchingUniqueIndexes },
    desiredState: {
      firstTerm: checks.firstTerm ? 'correct' : 'conflict',
      secondTerm: secondTerm.status,
      thirdTerm: thirdTerm.status,
      conflicts,
      plannedWrites,
      plannedWriteCount: plannedWrites.length,
      configurationComplete
    },
    checks,
    safeToApply: requiredSafetyChecks.every((key) => checks[key])
  };
}

function assertSafePreflight(preflight) {
  const required = ['school', 'academicYear', 'firstTerm', 'noEquivalentDuplicateNames', 'noDuplicateNames', 'targetIdsAvailableOrOwned', 'uniqueness', 'noConflictingTerms'];
  const failed = required.filter((key) => !preflight.checks[key]);
  if (failed.length) fail('THREE_TERM_PREFLIGHT_FAILED', 'Three-term configuration preflight failed; no data was written.', { failed, preflight });
}

export async function configureThreeTerms(database, { databaseName = null, clock = () => new Date().toISOString(), dryRun = false } = {}) {
  const before = await readThreeTermPreflight(database, { databaseName });
  assertSafePreflight(before);
  if (dryRun) return {
    ok: true,
    mode: 'dry-run',
    before,
    inserted: [],
    plannedWrites: before.desiredState.plannedWrites,
    plannedWriteCount: before.desiredState.plannedWriteCount,
    safeToApply: true,
    configurationComplete: before.desiredState.configurationComplete
  };
  if (!database.transaction) fail('DATABASE_TRANSACTION_REQUIRED', 'A transaction-capable database adapter is required for production writes.');
  const inserted = await database.transaction(async (tx) => {
    const current = await readThreeTermPreflight(tx, { databaseName });
    assertSafePreflight(current);
    const created = [];
    const now = clock();
    for (const term of [THREE_TERM_CONFIGURATION.secondTerm, THREE_TERM_CONFIGURATION.thirdTerm]) {
      const state = stateForTerm(current.terms, term);
      if (state.status === 'correct') continue;
      if (state.status !== 'missing') fail('TERM_CONFLICT', `Existing ${term.name} conflicts with the approved configuration.`, { existing: state.term, expected: term });
      await tx.execute(`INSERT INTO terms (id,academic_year_id,name,starts_on,ends_on,is_current,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, [term.id, THREE_TERM_CONFIGURATION.academicYearId, term.name, term.startsOn, term.endsOn, 0, now, now]);
      created.push(term.name);
    }
    return created;
  });
  const after = await readThreeTermPreflight(database, { databaseName });
  assertSafePreflight(after);
  if (!after.desiredState.configurationComplete) fail('THREE_TERM_POSTWRITE_FAILED', 'Post-write verification did not find the exact three configured terms.', { after });
  return {
    ok: true,
    mode: 'apply',
    before,
    inserted,
    after,
    plannedWrites: before.desiredState.plannedWrites,
    plannedWriteCount: before.desiredState.plannedWriteCount,
    safeToApply: true,
    configurationComplete: after.desiredState.configurationComplete
  };
}

export default configureThreeTerms;
