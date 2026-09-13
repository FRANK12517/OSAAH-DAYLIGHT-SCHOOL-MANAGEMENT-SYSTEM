import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL_MISSING', 'The protected production DATABASE_URL secret is unavailable.');

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, connectionLimit: 1, connectTimeout: 15000 });
const requiredTables = ['admission_applications', 'students', 'student_profiles', 'student_enrollments', 'parent_student_links', 'users'];
const expectedForeignKeys = [
  ['student_profiles', 'student_master_id', 'students', 'id'],
  ['student_enrollments', 'student_id', 'students', 'id'],
  ['parent_student_links', 'parent_user_id', 'users', 'id'],
  ['parent_student_links', 'student_id', 'student_profiles', 'id']
];
const output = { databaseUrlAvailable: true, connectivity: false, migration027: null, migration028: null, acceptance: null };

async function columns(table) {
  const [rows] = await pool.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
  return rows;
}
async function foreignKey(table, column) {
  const [rows] = await pool.query('SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL', [table, column]);
  return rows[0] ?? null;
}
function sequenceMatches(rows) {
  const expected = [['admission_year', 'smallint', 'NO', 'PRI'], ['next_sequence', 'int unsigned', 'NO', ''], ['updated_at', 'datetime', 'NO', '']];
  return expected.every(([name, type, nullable, key]) => rows.some((row) => row.COLUMN_NAME === name && row.COLUMN_TYPE === type && row.IS_NULLABLE === nullable && row.COLUMN_KEY === key));
}
async function applyFile(name) {
  const sql = await readFile(new URL(`../schema/${name}`, import.meta.url), 'utf8');
  await pool.query(sql);
}

try {
  const [selected] = await pool.query('SELECT DATABASE() AS database_name');
  const database = selected[0]?.database_name;
  if (database !== 'osaahdaylightschool') fail('DATABASE_TARGET_MISMATCH', 'The production database target is not osaahdaylightschool.');
  output.connectivity = true;
  output.database = database;
  const [tables] = await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [requiredTables]);
  const missing = requiredTables.filter((table) => !tables.some((row) => row.TABLE_NAME === table));
  if (missing.length) fail('REQUIRED_TABLES_MISSING', `Required production tables are missing: ${missing.join(', ')}`);

  let sequenceColumns = await columns('student_id_sequences');
  if (sequenceColumns.length && !sequenceMatches(sequenceColumns)) fail('SEQUENCE_SCHEMA_MISMATCH', 'The existing student_id_sequences table does not match the required contract.');
  if (!sequenceColumns.length) { await applyFile('027_student_id_sequences.sql'); sequenceColumns = await columns('student_id_sequences'); }
  if (!sequenceMatches(sequenceColumns)) fail('MIGRATION_027_VERIFICATION_FAILED', 'Migration 027 did not produce the required sequence contract.');
  output.migration027 = { satisfied: true, columns: sequenceColumns.map((row) => ({ name: row.COLUMN_NAME, type: row.COLUMN_TYPE, nullable: row.IS_NULLABLE, primary: row.COLUMN_KEY === 'PRI' })) };

  const beforeFk = await foreignKey('admission_applications', 'student_id');
  if (!beforeFk) fail('APPLICATION_FK_MISSING', 'admission_applications.student_id has no foreign key.');
  const [compatibility] = await pool.query('SELECT COUNT(*) AS incompatible_count FROM admission_applications aa LEFT JOIN students s ON s.id=aa.student_id WHERE aa.student_id IS NOT NULL AND s.id IS NULL');
  const incompatibleCount = Number(compatibility[0]?.incompatible_count ?? 0);
  if (incompatibleCount) fail('APPLICATION_STUDENT_IDS_INCOMPATIBLE', `${incompatibleCount} admission application student IDs require reconciliation.`);
  if (beforeFk.REFERENCED_TABLE_NAME === 'student_profiles') await applyFile('028_admission_student_master_fk.sql');
  else if (beforeFk.REFERENCED_TABLE_NAME !== 'students' || beforeFk.REFERENCED_COLUMN_NAME !== 'id') fail('APPLICATION_FK_UNEXPECTED', 'admission_applications.student_id has an unexpected foreign key target.');
  const afterFk = await foreignKey('admission_applications', 'student_id');
  if (afterFk?.REFERENCED_TABLE_NAME !== 'students' || afterFk?.REFERENCED_COLUMN_NAME !== 'id') fail('MIGRATION_028_VERIFICATION_FAILED', 'Migration 028 did not establish the master student foreign key.');
  output.migration028 = { compatibleRows: true, incompatibleCount, priorTarget: beforeFk.REFERENCED_TABLE_NAME, finalTarget: 'students.id', satisfied: true };

  const [allForeignKeys] = await pool.query('SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
  const missingForeignKeys = expectedForeignKeys.filter(([table, column, referencedTable, referencedColumn]) => !allForeignKeys.some((row) => row.TABLE_NAME === table && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === referencedTable && row.REFERENCED_COLUMN_NAME === referencedColumn));
  if (missingForeignKeys.length) fail('FINAL_SCHEMA_ACCEPTANCE_FAILED', 'One or more required production foreign keys are missing.');
  output.acceptance = { passed: true, requiredTablesPresent: true, requiredForeignKeysPresent: true };
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (cause) {
  process.stderr.write(`${JSON.stringify({ error: cause.code ?? 'PRODUCTION_MIGRATION_FAILED', message: cause.code ? cause.message : 'Production migration failed safely.', partial: output })}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
