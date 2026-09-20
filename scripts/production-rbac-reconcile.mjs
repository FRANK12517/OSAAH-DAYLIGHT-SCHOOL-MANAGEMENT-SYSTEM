import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const confirmation = 'APPLY_PART9_RBAC_RECONCILIATION';
const applyMode = process.argv.includes('--apply');
const migration = await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8');
const authTables = ['users', 'user_roles', 'roles', 'role_permissions', 'permissions'];
const baselineTables = ['users', 'user_roles', 'schools', 'students', 'student_enrollments', 'fee_obligations', 'fee_collection_records'];

const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'RBAC_RECONCILIATION_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null, message: error?.safeMessage ?? undefined } });

async function tableSet(connection) {
  const [rows] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [authTables]);
  return new Set(rows.map((row) => row.TABLE_NAME));
}
async function countRows(connection) {
  const counts = {};
  for (const table of baselineTables) {
    try { const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``); counts[table] = Number(row.count); } catch { counts[table] = null; }
  }
  return counts;
}
async function preflight(connection) {
  const [[databaseRow]] = await connection.query('SELECT DATABASE() AS database_name');
  const connectedDatabase = databaseRow?.database_name ?? null;
  if (connectedDatabase !== expectedDatabase) throw Object.assign(new Error('Production database target mismatch.'), { code: 'DATABASE_TARGET_MISMATCH' });
  const tables = await tableSet(connection);
  if (!tables.has('users') || !tables.has('user_roles')) throw Object.assign(new Error('Existing users and user_roles tables are required.'), { code: 'REQUIRED_EXISTING_TABLES_MISSING' });
  for (const table of ['roles', 'role_permissions', 'permissions']) if (tables.has(table)) throw Object.assign(new Error(`Focused reconciliation requires ${table} to be missing; refusing to run.`), { code: 'TARGET_TABLE_ALREADY_EXISTS' });
  const [userColumns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'users\'');
  const users = new Set(userColumns.map((row) => row.COLUMN_NAME));
  for (const column of ['id', 'school_id', 'email', 'password_hash', 'role', 'status']) if (!users.has(column)) throw Object.assign(new Error(`Existing users table is missing required column ${column}.`), { code: 'USERS_SCHEMA_UNEXPECTED' });
  const [userRoleColumns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'user_roles\'');
  const userRoles = new Set(userRoleColumns.map((row) => row.COLUMN_NAME));
  for (const column of ['id', 'user_id', 'role_id']) if (!userRoles.has(column)) throw Object.assign(new Error(`Existing user_roles table is missing required column ${column}.`), { code: 'USER_ROLES_SCHEMA_UNEXPECTED' });
  const baseline = await countRows(connection);
  return { connectedDatabase, databaseMatch: true, existingTables: { users: 'EXISTS', user_roles: 'EXISTS' }, missingTables: { roles: 'MISSING', role_permissions: 'MISSING', permissions: 'MISSING' }, baselineCounts: baseline, migration: '032_production_rbac_reconciliation.sql', destructiveStatements: false };
}

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, multipleStatements: true, connectTimeout: 15000 });
  let connection;
  try {
    connection = await pool.getConnection();
    const plan = await preflight(connection);
    if (!applyMode) {
      process.stdout.write(`${JSON.stringify({ ok: true, mode: 'plan', ...plan })}\n`);
    } else if (process.env.CONFIRM_PRODUCTION_RBAC_RECONCILIATION !== confirmation) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' }, plan })}\n`);
      process.exitCode = 2;
    } else {
      await connection.beginTransaction();
      try {
        await connection.query(migration);
        const after = await preflight(connection);
        for (const table of baselineTables) if (plan.baselineCounts[table] !== null && after.baselineCounts[table] !== plan.baselineCounts[table]) throw Object.assign(new Error(`Protected row count changed unexpectedly for ${table}.`), { code: 'PROTECTED_ROW_COUNT_CHANGED' });
        await connection.commit();
        process.stdout.write(`${JSON.stringify({ ok: true, mode: 'apply', before: plan, after, preservedRowCounts: true, migrationApplied: '032_production_rbac_reconciliation.sql' })}\n`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
  } finally {
    connection?.release();
    await pool.end();
  }
}
