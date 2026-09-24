import mysql from 'mysql2/promise';

const schemaMigrationDdl = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME NOT NULL
)`;
const schemaMigrationLockDdl = `CREATE TABLE IF NOT EXISTS schema_migration_lock (
  lock_id TINYINT PRIMARY KEY,
  locked TINYINT NOT NULL DEFAULT 0,
  acquired_at DATETIME NULL
)`;
const schemaBaselineDdl = `CREATE TABLE IF NOT EXISTS schema_baselines (
  id VARCHAR(64) PRIMARY KEY,
  canonical_database VARCHAR(128) NOT NULL,
  baseline_at DATETIME NOT NULL,
  repository_commit CHAR(40) NOT NULL,
  schema_fingerprint CHAR(64) NOT NULL,
  reconciliation_migration VARCHAR(255) NOT NULL,
  workflow_provenance VARCHAR(255) NOT NULL,
  baseline_type VARCHAR(32) NOT NULL DEFAULT 'HISTORICAL_BASELINE',
  historical_migrations_executed TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL
)`;
const adapterError = (code, message) => Object.assign(new Error(message), { code });

export function createDatabaseAdapter({ environment, poolFactory = mysql.createPool } = {}) {
  const connectionString = environment?.DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for the TiDB database adapter.');
  const pool = poolFactory({
    uri: connectionString,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  const metadataTables = ['schema_migrations', 'schema_migration_lock'];

  return {
    async query(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; },
    async execute(sql, params = []) { const [result] = await pool.execute(sql, params); return { insertId: result.insertId, affectedRows: result.affectedRows }; },
    async transaction(callback) {
      const connection = await pool.getConnection(); await connection.beginTransaction();
      try {
        const transactionalAdapter = {
          async query(sql, params = []) { const [rows] = await connection.query(sql, params); return rows; },
          async execute(sql, params = []) { const [result] = await connection.execute(sql, params); return { insertId: result.insertId, affectedRows: result.affectedRows }; }
        };
        const result = await callback(transactionalAdapter); await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    },
    async healthCheck() { try { await pool.query('SELECT 1'); return { healthy: true }; } catch (error) { return { healthy: false, error: error.message }; } },
    async ensureMetadata({ create = true } = {}) {
      if (create) {
        await pool.query(schemaMigrationDdl);
        await pool.query(schemaMigrationLockDdl);
        await pool.execute('INSERT INTO schema_migration_lock (lock_id, locked) VALUES (1, 0) ON DUPLICATE KEY UPDATE lock_id = lock_id');
        await pool.query(schemaBaselineDdl);
        return { created: true, tables: [...metadataTables, 'schema_baselines'] };
      }
      const rows = await this.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [metadataTables]);
      const present = new Set(rows.map((row) => row.TABLE_NAME));
      const missing = metadataTables.filter((table) => !present.has(table));
      if (missing.length) throw adapterError('MIGRATION_METADATA_MISSING', `Migration metadata is missing: ${missing.join(', ')}`);
      return { created: false, tables: metadataTables };
    },
    async listApplied() { return this.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version ASC'); },
    async recordApplied(record) {
      if (!record || !Number.isInteger(Number(record.version)) || !record.name || !record.checksum || !record.appliedAt) throw new Error('Invalid migration metadata.');
      await this.execute('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [Number(record.version), record.name, record.checksum, record.appliedAt]);
    },
    async acquireLock() { const result = await this.execute('UPDATE schema_migration_lock SET locked = 1, acquired_at = CURRENT_TIMESTAMP WHERE lock_id = 1 AND locked = 0'); return Number(result.affectedRows) === 1; },
    async releaseLock() { await this.execute('UPDATE schema_migration_lock SET locked = 0, acquired_at = NULL WHERE lock_id = 1'); },
    async listBaselines() { return this.query('SELECT id, canonical_database AS canonicalDatabase, baseline_at AS baselineAt, repository_commit AS repositoryCommit, schema_fingerprint AS schemaFingerprint, reconciliation_migration AS reconciliationMigration, workflow_provenance AS workflowProvenance, baseline_type AS baselineType, historical_migrations_executed AS historicalMigrationsExecuted, created_at AS createdAt FROM schema_baselines ORDER BY baseline_at DESC'); },
    async recordBaseline(record) {
      if (!record?.id || !record.canonicalDatabase || !record.baselineAt || !record.repositoryCommit || !record.schemaFingerprint || !record.reconciliationMigration || !record.workflowProvenance || !record.createdAt) throw new Error('Invalid schema baseline metadata.');
      await this.execute('INSERT INTO schema_baselines (id, canonical_database, baseline_at, repository_commit, schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type, historical_migrations_executed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [record.id, record.canonicalDatabase, record.baselineAt, record.repositoryCommit, record.schemaFingerprint, record.reconciliationMigration, record.workflowProvenance, record.baselineType ?? 'HISTORICAL_BASELINE', record.historicalMigrationsExecuted ? 1 : 0, record.createdAt]);
    },
    async close() { await pool.end(); }
  };
}

export { schemaMigrationDdl, schemaMigrationLockDdl, schemaBaselineDdl };
export default createDatabaseAdapter;
