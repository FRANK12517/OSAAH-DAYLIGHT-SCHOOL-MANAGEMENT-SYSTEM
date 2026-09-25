import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const expectedTables = [
  'schools', 'users', 'staff', 'roles', 'permissions', 'user_roles', 'role_permissions',
  'sessions', 'classes', 'levels', 'students', 'student_enrollments', 'academic_years',
  'terms', 'fee_structures', 'fee_obligations', 'fee_collection_records', 'fee_payments'
];

function safeFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? 'DATABASE_INVENTORY_FAILED',
      errno: error?.errno ?? null,
      sqlState: error?.sqlState ?? null
    }
  };
}

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    const database = databaseRow?.database_name ?? null;
    const [tableRows] = await pool.query(
      'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
    );
    const tables = tableRows.map((row) => ({ name: row.TABLE_NAME, type: row.TABLE_TYPE }));
    const present = new Set(tables.map((table) => table.name));
    const [migrationCandidates] = await pool.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) LIKE '%migration%' ORDER BY TABLE_NAME"
    );
    const [columnRows] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [expectedTables]
    );
    const columns = {};
    for (const row of columnRows) {
      (columns[row.TABLE_NAME] ??= []).push({
        name: row.COLUMN_NAME,
        type: row.COLUMN_TYPE,
        nullable: row.IS_NULLABLE,
        key: row.COLUMN_KEY
      });
    }
    const result = {
      ok: true,
      connectedDatabase: database,
      expectedDatabase,
      databaseMatch: database === expectedDatabase,
      select1: true,
      tableInventory: tables,
      missingExpectedTables: expectedTables.filter((table) => !present.has(table)),
      migrationTableCandidates: migrationCandidates.map((row) => row.TABLE_NAME),
      expectedTableColumns: columns,
      authenticationExpectation: {
        missingTableFromRuntime: 'users',
        querySource: 'src/auth.js:createAuthService().loginFromDatabase',
        queryTables: ['users', 'user_roles', 'roles', 'role_permissions', 'permissions']
      }
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
