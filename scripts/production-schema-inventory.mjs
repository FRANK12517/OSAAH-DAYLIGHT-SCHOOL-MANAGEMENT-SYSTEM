import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const expectedTables = [
  'schools', 'users', 'staff', 'roles', 'permissions', 'user_roles', 'role_permissions',
  'sessions', 'classes', 'levels', 'students', 'student_enrollments', 'academic_years',
  'terms', 'fee_structures', 'fee_obligations', 'fee_collection_records', 'fee_payments'
];
const attendanceTables = ['student_attendance', 'staff_attendance'];

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
    const [attendanceColumnRows] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [attendanceTables]
    );
    const [attendanceIndexRows] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [attendanceTables]
    );
    const [migrationRows] = await pool.query(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
    );
    const [lockRows] = await pool.query(
      'SELECT lock_id, locked, acquired_at FROM schema_migration_lock ORDER BY lock_id'
    );
    const [baselineRows] = await pool.query(
      'SELECT id, canonical_database, baseline_at, repository_commit, schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type, historical_migrations_executed, created_at FROM schema_baselines ORDER BY created_at DESC'
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
      attendanceSchema: Object.fromEntries(attendanceTables.map((table) => [table, attendanceColumnRows.filter((row) => row.TABLE_NAME === table).map((row) => ({ name: row.COLUMN_NAME, type: row.COLUMN_TYPE, nullable: row.IS_NULLABLE, key: row.COLUMN_KEY }))])),
      attendanceIndexes: attendanceIndexRows.map((row) => ({ table: row.TABLE_NAME, name: row.INDEX_NAME, nonUnique: row.NON_UNIQUE, sequence: row.SEQ_IN_INDEX, column: row.COLUMN_NAME })),
      migrationLedger: migrationRows.map((row) => ({ version: row.version, name: row.name, checksum: row.checksum, appliedAt: row.applied_at })),
      migrationLock: lockRows.map((row) => ({ lockId: row.lock_id, locked: row.locked, acquiredAt: row.acquired_at })),
      baselines: baselineRows.map((row) => ({ id: row.id, canonicalDatabase: row.canonical_database, baselineAt: row.baseline_at, repositoryCommit: row.repository_commit, schemaFingerprint: row.schema_fingerprint, reconciliationMigration: row.reconciliation_migration, workflowProvenance: row.workflow_provenance, baselineType: row.baseline_type, historicalMigrationsExecuted: row.historical_migrations_executed, createdAt: row.created_at })),
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
