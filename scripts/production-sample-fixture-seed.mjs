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
const termNames = ['1st Term', '2nd Term', '3rd Term'];
const statuses = [
  ['PRESENT', 'PRESENT', 'ABSENT'],
  ['PRESENT', 'LATE', 'PRESENT'],
  ['PRESENT', 'EXCUSED_ABSENCE', 'PRESENT']
];
const dateFor = (termIndex, dayIndex) => `2026-${String(9 + termIndex).padStart(2, '0')}-${String(7 + dayIndex).padStart(2, '0')}`;

function normalizeTerm(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^first\s+term$/, '1st Term').replace(/^second\s+term$/, '2nd Term').replace(/^third\s+term$/, '3rd Term');
}
function payloadFor(studentIndex, termIndex) {
  return {
    label: SAMPLE_LABEL,
    provenance: 'TEST',
    fixtureVersion: 1,
    records: statuses[termIndex].map((status, dayIndex) => ({
      date: dateFor(termIndex, dayIndex + studentIndex),
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
    const rows = await database.query('SELECT id,name,academic_year_id AS academicYearId FROM terms WHERE academic_year_id=? AND LOWER(name)=LOWER(?) LIMIT 1', [year.id, name]);
    const row = rows[0];
    if (!row) throw Object.assign(new Error(`The approved term is not configured: ${name}`), { code: 'SAMPLE_FIXTURE_CONTEXT_MISSING' });
    terms.push(row);
  }
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
        fixturePayload: payloadFor(studentIndex, termIndex)
      });
    }
  }
  return { databaseName, ledger, year, terms, classRow, rows };
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
      terms: plan.terms.map(({ id, name, academicYearId }) => ({ id, name, academicYearId })),
      migrationVersion: Number(plan.ledger.version),
      fixtureTable: 'sample_data_fixtures',
      rowCount: plan.rows.length,
      fixtureTypes: [...new Set(plan.rows.map((row) => row.fixtureType))],
      identities: plan.rows.map(({ sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion }) => ({ sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion })),
      applyExecuted: false
    };
    if (mode === 'apply') {
      const repository = createSampleFixtureRepository({ adapter: database, schoolId });
      const actor = actorFor(schoolId);
      for (const row of plan.rows) await repository.ensureFixture(row, actor);
      summary.applied = plan.rows.length;
      summary.applyExecuted = true;
      const persisted = await repository.listFixtures({ schoolId, fixtureType: 'attendance' }, actor);
      summary.persistedRowCount = persisted.filter((row) => row.fixtureVersion === 1).length;
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
