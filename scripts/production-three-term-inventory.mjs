import mysql from 'mysql2/promise';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const SCHOOL_ID = 'sch_default_01';
const ACADEMIC_YEAR_ID = 'ay_2026_01';
const EXPECTED = [
  { id: 'term_2026_01', name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18' },
  { id: 'term_2026_02', name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' },
  { id: 'term_2026_03', name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23' }
];

const safeError = (error) => ({ ok: false, error: {
  code: error?.code ?? 'THREE_TERM_INVENTORY_FAILED',
  sqlState: error?.sqlState ?? null,
  errno: error?.errno ?? null,
  message: error?.code === 'ETIMEDOUT' ? 'Protected production database connection timed out.' : 'Protected production term inventory failed.'
} });
const same = (actual, expected) => String(actual ?? '') === String(expected ?? '');
const matches = (row, expected) => row && same(row.id, expected.id) && same(row.name, expected.name) && same(row.startsOn, expected.startsOn) && same(row.endsOn, expected.endsOn) && same(row.academicYearId, ACADEMIC_YEAR_ID);

export async function inspectProductionTerms({ databaseUrl = process.env.DATABASE_URL, poolFactory = mysql.createPool } = {}) {
  if (!databaseUrl) return { ok: false, error: { code: 'DATABASE_URL_MISSING' } };
  const pool = poolFactory({ uri: databaseUrl, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[databaseRows], [schoolRows], [academicYearRows], [termRows], [targetRows]] = await Promise.all([
      pool.query('SELECT DATABASE() AS databaseName'),
      pool.query('SELECT id,name FROM schools WHERE id=? LIMIT 1', [SCHOOL_ID]),
      pool.query('SELECT id,school_id AS schoolId,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE id=? AND school_id=? LIMIT 1', [ACADEMIC_YEAR_ID, SCHOOL_ID]),
      pool.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM terms WHERE academic_year_id=? ORDER BY starts_on ASC,id', [ACADEMIC_YEAR_ID]),
      pool.query('SELECT id,academic_year_id AS academicYearId,name,starts_on AS startsOn,ends_on AS endsOn FROM terms WHERE id IN (?,?,?)', EXPECTED.map((term) => term.id))
    ]);
    const rows = termRows.map((row) => ({ id: row.id, academicYearId: row.academicYearId, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, isCurrent: row.isCurrent }));
    const names = rows.map((row) => String(row.name ?? '').trim().toLowerCase());
    const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    const duplicateIds = [...new Set(rows.map((row) => row.id).filter((id, index) => rows.findIndex((row) => row.id === id) !== index))];
    const exact = EXPECTED.every((expected) => rows.filter((row) => row.name === expected.name).length === 1 && rows.some((row) => matches(row, expected)));
    return {
      ok: true,
      mode: 'READ_ONLY_THREE_TERM_INVENTORY',
      database: databaseRows[0]?.databaseName ?? null,
      school: schoolRows[0] ?? null,
      academicYear: academicYearRows[0] ?? null,
      terms: rows,
      targetIds: targetRows.map((row) => ({ id: row.id, academicYearId: row.academicYearId, name: row.name, startsOn: row.startsOn, endsOn: row.endsOn })),
      checks: {
        expectedDatabase: databaseRows[0]?.databaseName === EXPECTED_DATABASE,
        school: schoolRows[0]?.id === SCHOOL_ID,
        academicYear: academicYearRows[0]?.id === ACADEMIC_YEAR_ID && academicYearRows[0]?.schoolId === SCHOOL_ID,
        exactApprovedConfiguration: exact,
        exactlyThreeRows: rows.length === 3,
        duplicateNames: duplicateNames.length === 0,
        duplicateIds: duplicateIds.length === 0,
        noUnexpectedTargetOwnership: targetRows.every((row) => row.academicYearId === ACADEMIC_YEAR_ID)
      },
      productionWrites: 'NONE'
    };
  } catch (error) {
    return safeError(error);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await inspectProductionTerms();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
