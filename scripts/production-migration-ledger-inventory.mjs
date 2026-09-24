import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const metadataTables = ['schema_migrations', 'schema_migration_lock', 'schema_baselines'];
const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'MIGRATION_LEDGER_INVENTORY_FAILED', sqlState: error?.sqlState ?? null } });

if (!process.env.DATABASE_URL) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } }) + '\n');
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    if (databaseRow?.database_name !== expectedDatabase) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const [tableRows] = await pool.query("SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('schema_migrations','schema_migration_lock','schema_baselines') ORDER BY TABLE_NAME");
    const [columnRows] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('schema_migrations','schema_migration_lock','schema_baselines') ORDER BY TABLE_NAME, ORDINAL_POSITION");
    const [indexRows] = await pool.query("SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('schema_migrations','schema_migration_lock','schema_baselines') ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
    const present = new Set(tableRows.map((row) => row.TABLE_NAME));
    const result = { ok: true, mode: 'READ_ONLY_MIGRATION_LEDGER_INVENTORY', connectedDatabase: databaseRow.database_name, metadataTables, presentTables: [...present], tableDefinitions: tableRows, columns: columnRows, indexes: indexRows, migrationRows: [], baselineRows: [], lockRows: [] };
    if (present.has('schema_migrations')) {
      const [rows] = await pool.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');
      result.migrationRows = rows;
    }
    if (present.has('schema_baselines')) {
      const [rows] = await pool.query('SELECT id, canonical_database, baseline_at, repository_commit, schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type, historical_migrations_executed, created_at FROM schema_baselines ORDER BY baseline_at ASC');
      result.baselineRows = rows;
    }
    if (present.has('schema_migration_lock')) {
      const [rows] = await pool.query('SELECT lock_id, locked, acquired_at FROM schema_migration_lock ORDER BY lock_id ASC');
      result.lockRows = rows;
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify(safeError(error)) + '\n');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
