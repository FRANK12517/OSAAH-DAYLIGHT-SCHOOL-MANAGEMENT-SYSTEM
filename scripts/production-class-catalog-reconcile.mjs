import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const schoolId = 'sch_default_01';
const confirmation = 'APPLY_PART9_CLASS_CATALOG_RECONCILIATION';
const names = ['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const migration = await readFile(new URL('../schema/033_canonical_class_catalog_reconciliation.sql', import.meta.url), 'utf8');
const applyMode = process.argv.includes('--apply');

const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'CLASS_CATALOG_RECONCILIATION_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } });
async function inventory(connection) {
  const [[db]] = await connection.query('SELECT DATABASE() AS database_name');
  if (db?.database_name !== expectedDatabase) throw Object.assign(new Error('Database target mismatch.'), { code: 'DATABASE_TARGET_MISMATCH' });
  const [[school]] = await connection.query('SELECT id FROM schools WHERE id=?', [schoolId]);
  if (!school) throw Object.assign(new Error('Expected school is missing.'), { code: 'SCHOOL_MISSING' });
  const [[before]] = await connection.query('SELECT COUNT(*) AS count FROM classes WHERE school_id=?', [schoolId]);
  const [rows] = await connection.query('SELECT id,name,level,department_id FROM classes WHERE school_id=? AND name IN (?) ORDER BY name', [schoolId, names]);
  return { connectedDatabase: db.database_name, schoolId, classCountBefore: Number(before.count), canonicalClassesBefore: rows.map((row) => ({ id: row.id, name: row.name, level: row.level, departmentId: row.department_id })), protectedTablesUntouched: ['users', 'user_roles', 'students', 'fee_structures', 'fee_payments'] };
}
if (!process.env.DATABASE_URL) { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`); process.exitCode = 1; } else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, multipleStatements: true, connectTimeout: 15000 });
  let connection;
  try {
    connection = await pool.getConnection();
    const before = await inventory(connection);
    if (!applyMode) process.stdout.write(`${JSON.stringify({ ok: true, mode: 'plan', ...before, migration: '033_canonical_class_catalog_reconciliation.sql', missingCanonicalClasses: names.filter((name) => !before.canonicalClassesBefore.some((row) => row.name === name)) })}\n`);
    else if (process.env.CONFIRM_PRODUCTION_CLASS_CATALOG_RECONCILIATION !== confirmation) { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' }, plan: before })}\n`); process.exitCode = 2; }
    else {
      await connection.beginTransaction();
      try {
        await connection.query(migration);
        const after = await inventory(connection);
        if (after.classCountBefore < before.classCountBefore) throw Object.assign(new Error('Class count decreased unexpectedly.'), { code: 'CLASS_COUNT_DECREASED' });
        const missing = names.filter((name) => !after.canonicalClassesBefore.some((row) => row.name === name));
        if (missing.length) throw Object.assign(new Error('Canonical class catalog remains incomplete.'), { code: 'CANONICAL_CLASSES_MISSING' });
        await connection.commit();
        process.stdout.write(`${JSON.stringify({ ok: true, mode: 'apply', before, after, canonicalClassCount: names.length, insertedMissingCount: names.length - before.canonicalClassesBefore.length, migrationApplied: '033_canonical_class_catalog_reconciliation.sql' })}\n`);
      } catch (error) { await connection.rollback(); throw error; }
    }
  } catch (error) { process.stdout.write(`${JSON.stringify(safeError(error))}\n`); process.exitCode = 1; }
  finally { connection?.release(); await pool.end(); }
}
