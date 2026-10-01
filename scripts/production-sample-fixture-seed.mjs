import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createSampleFixtureRepository } from '../src/sample-fixture-repository.js';
import { DEFAULT_PRODUCTION_SCHOOL_ID } from '../src/school-context.js';
import { TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const CANONICAL_ACADEMIC_YEAR_ID = 'ay_2026_01';
const SAMPLE_LABEL = 'SAMPLE DATA';
const actorFor = (schoolId) => ({ id: 'production-sample-fixture-seeder', schoolId, portal: 'school', roleKey: 'HEADTEACHER', permissions: new Set(['sample.fixtures.write', 'sample.fixtures.read']) });
const termNames = ['First Term', 'Second Term', 'Third Term'];
const statuses = [
  ['PRESENT', 'PRESENT', 'ABSENT'],
  ['PRESENT', 'LATE', 'PRESENT'],
  ['PRESENT', 'EXCUSED_ABSENCE', 'PRESENT']
];
function isCalendarDate(value) {
  const result = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return false;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result;
}
function termDateRange(term) {
  const startsOn = term?.startsOn ?? term?.starts_on;
  const endsOn = term?.endsOn ?? term?.ends_on;
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn) || endsOn < startsOn) {
    throw Object.assign(new Error('The canonical term date range is invalid.'), { code: 'SAMPLE_FIXTURE_TERM_DATES_INVALID', details: { termId: term?.id ?? null, startsOn: startsOn ?? null, endsOn: endsOn ?? null } });
  }
  return { startsOn, endsOn };
}
function addDays(value, days) {
  const result = new Date(`${value}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function sampleDatesForTerm(term, studentIndex) {
  const { startsOn } = termDateRange(term);
  // Choose synthetic weekday examples in the second week of each term. These
  // are demonstrations, not claims of recorded or official student attendance.
  const afterOpeningWeek = addDays(startsOn, 7);
  const weekday = new Date(`${afterOpeningWeek}T00:00:00.000Z`).getUTCDay();
  const monday = addDays(afterOpeningWeek, (1 - weekday + 7) % 7);
  return [0, 2, 4].map((offset) => addDays(monday, studentIndex * 7 + offset));
}
export function validateAttendanceFixtureDates(records, term) {
  const { startsOn, endsOn } = termDateRange(term);
  if (!Array.isArray(records) || records.length === 0) {
    throw Object.assign(new Error('Attendance fixture must contain dated records.'), { code: 'SAMPLE_FIXTURE_DATE_OUTSIDE_TERM', details: { termId: term?.id ?? null, startsOn, endsOn, date: null } });
  }
  for (const record of records) {
    const date = String(record?.date ?? '').trim();
    if (!isCalendarDate(date) || date < startsOn || date > endsOn) {
      throw Object.assign(new Error('Attendance fixture date is outside its canonical term.'), { code: 'SAMPLE_FIXTURE_DATE_OUTSIDE_TERM', details: { termId: term?.id ?? null, startsOn, endsOn, date: date || null } });
    }
  }
  return true;
}

function normalizeTerm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^first\s+term$/, '1st Term').replace(/^second\s+term$/, '2nd Term').replace(/^third\s+term$/, '3rd Term');
}
function payloadFor(termIndex, dates) {
  return {
    label: SAMPLE_LABEL,
    provenance: 'TEST',
    fixtureVersion: 1,
    records: statuses[termIndex].map((status, dayIndex) => ({
      date: dates[dayIndex],
      status,
      subjectId: 'daily-attendance'
    }))
  };
}
async function oneRow(database, sql, params, message) {
  const rows = await database.query(sql, params);
  if (!rows[0]) throw Object.assign(new Error(message), { code: 'SAMPLE_FIXTURE_CONTEXT_MISSING' });
  return rows[0];
}
const identityFields = ['schoolId', 'sampleStudentId', 'academicYearId', 'termId', 'classId', 'fixtureType', 'fixtureVersion'];
const identityKey = (row) => identityFields.map((field) => String(row[field] ?? '')).join('|');
function stableJson(value) {
  const parsed = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  const json = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  const sort = (item) => Array.isArray(item)
    ? item.map(sort)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]))
      : item;
  return JSON.stringify(sort(json));
}
function payloadMatches(existing, planned) {
  try { return stableJson(existing) === stableJson(planned); } catch { return false; }
}
async function classifyExistingFixtures(database, rows) {
  const first = rows[0];
  const sampleStudentIds = [...new Set(rows.map((row) => row.sampleStudentId))];
  const termIds = [...new Set(rows.map((row) => row.termId))];
  const studentSlots = sampleStudentIds.map(() => '?').join(',');
  const termSlots = termIds.map(() => '?').join(',');
  const existing = await database.query(`SELECT school_id AS schoolId,sample_student_id AS sampleStudentId,academic_year_id AS academicYearId,term_id AS termId,class_id AS classId,fixture_type AS fixtureType,fixture_payload AS fixturePayload,fixture_version AS fixtureVersion FROM sample_data_fixtures WHERE school_id=? AND academic_year_id=? AND class_id=? AND fixture_type=? AND fixture_version=? AND sample_student_id IN (${studentSlots}) AND term_id IN (${termSlots})`, [first.schoolId, first.academicYearId, first.classId, first.fixtureType, first.fixtureVersion, ...sampleStudentIds, ...termIds]);
  const newRows = [];
  const existingFixtures = [];
  const conflicts = [];
  for (const planned of rows) {
    const matches = existing.filter((row) => identityKey(row) === identityKey(planned));
    const identity = Object.fromEntries(identityFields.map((field) => [field, planned[field]]));
    if (matches.length > 1) conflicts.push({ ...identity, reason: 'DUPLICATE_EXISTING_IDENTITY' });
    else if (matches.length === 1 && !payloadMatches(matches[0].fixturePayload, planned.fixturePayload)) conflicts.push({ ...identity, reason: 'FIXTURE_PAYLOAD_MISMATCH' });
    else if (matches.length === 1) existingFixtures.push(planned);
    else newRows.push(planned);
  }
  return { newRows, existingFixtures, conflicts };
}

export async function buildPlan(database, { schoolId = DEFAULT_PRODUCTION_SCHOOL_ID } = {}) {
  const databaseRows = await database.query('SELECT DATABASE() AS databaseName');
  const databaseName = databaseRows[0]?.databaseName ?? databaseRows[0]?.database_name ?? null;
  if (databaseName !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: databaseName } });
  const table = await database.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sample_data_fixtures'");
  if (table.length !== 1) throw Object.assign(new Error('Migration 061 fixture table is missing.'), { code: 'MIGRATION_061_SCHEMA_MISSING' });
  const ledger = await oneRow(database, 'SELECT version,name,checksum FROM schema_migrations WHERE version=?', [61], 'Migration 061 is not recorded.');
  // Resolve only the canonical existing row, scoped to its verified owner. Its display
  // name is returned for diagnostics; it is not used as an identifier or rewritten.
  const year = await oneRow(database, 'SELECT id,name FROM academic_years WHERE id=? AND school_id=? LIMIT 1', [CANONICAL_ACADEMIC_YEAR_ID, schoolId], 'The approved academic year is not configured.');
  const terms = [];
  for (const name of termNames) {
    const rows = await database.query('SELECT id,name,academic_year_id AS academicYearId,starts_on AS startsOn,ends_on AS endsOn FROM terms WHERE academic_year_id=? AND LOWER(name)=LOWER(?) LIMIT 1', [year.id, name]);
    const row = rows[0];
    if (!row) throw Object.assign(new Error(`The approved term is not configured: ${name}`), { code: 'SAMPLE_FIXTURE_CONTEXT_MISSING' });
    terms.push(row);
  }
  const plannedDates = terms.map((term) => TEST_PARENT_STUDENT_IDS.map((_, studentIndex) => {
    const dates = sampleDatesForTerm(term, studentIndex);
    validateAttendanceFixtureDates(dates.map((date) => ({ date })), term);
    return dates;
  }));
  const classes = await database.query("SELECT id,name FROM classes WHERE school_id=? AND LOWER(name) IN ('primary 6','basic 6') ORDER BY CASE WHEN LOWER(name)='primary 6' THEN 0 ELSE 1 END LIMIT 1", [schoolId]);
  const classRow = classes[0];
  if (!classRow) throw Object.assign(new Error('The approved Basic 6 / Primary 6 class is not configured.'), { code: 'SAMPLE_FIXTURE_CONTEXT_MISSING' });
  const rows = [];
  for (const [studentIndex, sampleStudentId] of TEST_PARENT_STUDENT_IDS.entries()) {
    for (const [termIndex, term] of terms.entries()) {
      rows.push({
        schoolId,
        sampleStudentId,
        academicYearId: year.id,
        academicYearName: year.name,
        termId: term.id,
        termName: normalizeTerm(term.name),
        classId: classRow.id,
        className: classRow.name,
        fixtureType: 'attendance',
        fixtureVersion: 1,
        fixturePayload: payloadFor(termIndex, plannedDates[termIndex][studentIndex])
      });
    }
  }
  const fixtureDisposition = await classifyExistingFixtures(database, rows);
  if (fixtureDisposition.conflicts.length) throw Object.assign(new Error('Existing sample fixtures conflict with the canonical read-only plan.'), { code: 'SAMPLE_FIXTURE_CONFLICT', details: { conflicts: fixtureDisposition.conflicts } });
  return { databaseName, ledger, year, terms, classRow, rows, ...fixtureDisposition };
}

export async function runSeed({ mode = process.argv[2] ?? 'dry-run', environment = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_SEED_MODE' });
  if (!environment.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL_MISSING'), { code: 'DATABASE_URL_MISSING' });
  const schoolId = environment.OSAAH_SCHOOL_ID ?? DEFAULT_PRODUCTION_SCHOOL_ID;
  const database = createDatabaseAdapter({ environment });
  try {
    const plan = await buildPlan(database, { schoolId });
    const summary = {
      ok: true,
      mode,
      database: plan.databaseName,
      schoolId,
      academicYear: { id: plan.year.id, name: plan.year.name },
      terms: plan.terms.map(({ id, name, academicYearId, startsOn, endsOn }) => ({ id, name, academicYearId, startsOn, endsOn })),
      migrationVersion: Number(plan.ledger.version),
      fixtureTable: 'sample_data_fixtures',
      rowCount: plan.rows.length,
      plannedInsertCount: plan.newRows.length,
      existingFixtureCount: plan.existingFixtures.length,
      conflicts: plan.conflicts,
      conflictCount: plan.conflicts.length,
      fixtureTypes: [...new Set(plan.rows.map((row) => row.fixtureType))],
      identities: plan.rows.map(({ sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion }) => ({ sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion })),
      plannedFixtures: plan.newRows,
      productionWrites: 'NONE',
      actualWriteCount: 0,
      unexpectedWriteCount: 0,
      applyExecuted: false
    };
    if (mode === 'apply') {
      const repository = createSampleFixtureRepository({ adapter: database, schoolId });
      const actor = actorFor(schoolId);
      for (const row of plan.newRows) await repository.ensureFixture(row, actor);
      summary.applied = plan.newRows.length;
      summary.applyExecuted = true;
      summary.actualWriteCount = plan.newRows.length;
      summary.productionWrites = plan.newRows.length ? 'SAMPLE_FIXTURE_TABLE_ONLY' : 'NONE';
      const persisted = await repository.listFixtures({ schoolId, fixtureType: 'attendance' }, actor);
      const plannedKeys = new Set(plan.rows.map(identityKey));
      summary.persistedRowCount = persisted.filter((row) => plannedKeys.has(identityKey(row))).length;
      if (summary.persistedRowCount < plan.rows.length) throw Object.assign(new Error('Fixture row verification failed.'), { code: 'SAMPLE_FIXTURE_VERIFY_FAILED' });
    }
    stdout.write(`${JSON.stringify(summary)}\n`);
    return summary;
  } catch (cause) {
    stderr.write(`${JSON.stringify({ ok: false, error: { code: cause?.code ?? 'SAMPLE_FIXTURE_SEED_FAILED', message: cause?.code ? cause.message : 'Sample fixture seed failed safely.', details: cause?.details ?? null } })}\n`);
    throw cause;
  } finally {
    await database.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runSeed();
  } catch {
    process.exitCode = 1;
  }
}
