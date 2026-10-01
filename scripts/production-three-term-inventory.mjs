import mysql from 'mysql2/promise';
import { detectAcademicYearNameUniqueIndexes } from '../src/production-three-term-config.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const SCHOOL_ID = 'sch_default_01';
const ACADEMIC_YEAR_ID = 'ay_2026_01';
const EXPECTED = [
  { id: 'term_2026_01', termNumber: 1, name: 'First Term', startsOn: '2026-09-01', endsOn: '2026-12-18' },
  { id: 'term_2026_02', termNumber: 2, name: 'Second Term', startsOn: '2027-01-11', endsOn: '2027-04-09' },
  { id: 'term_2026_03', termNumber: 3, name: 'Third Term', startsOn: '2027-05-03', endsOn: '2027-07-23' }
];

const safeError = (error) => ({ ok: false, error: {
  code: error?.code ?? 'THREE_TERM_INVENTORY_FAILED',
  sqlState: error?.sqlState ?? null,
  errno: error?.errno ?? null,
  message: error?.code === 'ETIMEDOUT' ? 'Protected production database connection timed out.' : 'Protected production term inventory failed.'
} });
const same = (actual, expected) => String(actual ?? '') === String(expected ?? '');
const matches = (row, expected) => row && same(row.id, expected.id) && same(row.schoolId, SCHOOL_ID) && same(row.academicYearId, ACADEMIC_YEAR_ID) && Number(row.termNumber) === expected.termNumber && same(row.name, expected.name) && same(row.startsOn, expected.startsOn) && same(row.endsOn, expected.endsOn);

export async function inspectProductionTerms({ databaseUrl = process.env.DATABASE_URL, poolFactory = mysql.createPool } = {}) {
  if (!databaseUrl) return { ok: false, error: { code: 'DATABASE_URL_MISSING' } };
  const pool = poolFactory({ uri: databaseUrl, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[databaseRows], [schoolRows], [academicYearRows], [termRows], [targetRows], [indexRows]] = await Promise.all([
      pool.query('SELECT DATABASE() AS databaseName'),
      pool.query('SELECT id,name FROM schools WHERE id=? LIMIT 1', [SCHOOL_ID]),
      pool.query('SELECT id,school_id AS schoolId,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE id=? AND school_id=? LIMIT 1', [ACADEMIC_YEAR_ID, SCHOOL_ID]),
      pool.query('SELECT id,school_id AS schoolId,academic_year_id AS academicYearId,term_number AS termNumber,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM terms WHERE academic_year_id=? ORDER BY starts_on ASC,id', [ACADEMIC_YEAR_ID]),
      pool.query('SELECT id,school_id AS schoolId,academic_year_id AS academicYearId,term_number AS termNumber,name,starts_on AS startsOn,ends_on AS endsOn FROM terms WHERE id IN (?,?,?)', EXPECTED.map((term) => term.id)),
      pool.query(`SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, INDEX_NAME AS indexName,
          NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS seqInIndex, COLUMN_NAME AS columnName, SUB_PART AS subPart
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [EXPECTED_DATABASE, 'terms'])
    ]);
    const databaseName = databaseRows[0]?.databaseName ?? null;
    const rows = termRows.map((row) => ({ id: row.id, schoolId: row.schoolId, academicYearId: row.academicYearId, termNumber: Number(row.termNumber), name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, isCurrent: row.isCurrent }));
    const names = rows.map((row) => String(row.name ?? '').trim().toLowerCase());
    const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    const duplicateIds = [...new Set(rows.map((row) => row.id).filter((id, index) => rows.findIndex((row) => row.id === id) !== index))];
    const matchingUniqueIndexes = detectAcademicYearNameUniqueIndexes(indexRows, { schemaName: EXPECTED_DATABASE });
    const exact = EXPECTED.every((expected) => rows.filter((row) => row.name === expected.name).length === 1 && rows.some((row) => matches(row, expected)));
    return {
      ok: true,
      mode: 'READ_ONLY_THREE_TERM_INVENTORY',
      database: databaseName,
      school: schoolRows[0] ?? null,
      academicYear: academicYearRows[0] ?? null,
      terms: rows,
      targetIds: targetRows.map((row) => ({ id: row.id, schoolId: row.schoolId, academicYearId: row.academicYearId, termNumber: Number(row.termNumber), name: row.name, startsOn: row.startsOn, endsOn: row.endsOn })),
      indexes: indexRows.map((row) => ({
        tableSchema: row.tableSchema ?? row.TABLE_SCHEMA,
        tableName: row.tableName ?? row.TABLE_NAME,
        indexName: row.indexName ?? row.INDEX_NAME,
        nonUnique: row.nonUnique ?? row.NON_UNIQUE,
        seqInIndex: row.seqInIndex ?? row.SEQ_IN_INDEX,
        columnName: row.columnName ?? row.COLUMN_NAME,
        subPart: row.subPart ?? row.SUB_PART ?? null
      })),
      uniqueness: { academicYearName: matchingUniqueIndexes.length > 0, matchingIndexes: matchingUniqueIndexes },
      checks: {
        expectedDatabase: databaseName === EXPECTED_DATABASE,
        school: schoolRows[0]?.id === SCHOOL_ID,
        academicYear: academicYearRows[0]?.id === ACADEMIC_YEAR_ID && academicYearRows[0]?.schoolId === SCHOOL_ID,
        exactApprovedConfiguration: exact,
        exactlyThreeRows: rows.length === 3,
        correctTermNumbers: EXPECTED.every((expected) => rows.filter((row) => row.termNumber === expected.termNumber).length === 1 && rows.some((row) => matches(row, expected))),
        duplicateNames: duplicateNames.length === 0,
        duplicateIds: duplicateIds.length === 0,
        noUnexpectedTargetOwnership: targetRows.every((row) => row.schoolId === SCHOOL_ID && row.academicYearId === ACADEMIC_YEAR_ID),
        uniqueness: matchingUniqueIndexes.length > 0
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
