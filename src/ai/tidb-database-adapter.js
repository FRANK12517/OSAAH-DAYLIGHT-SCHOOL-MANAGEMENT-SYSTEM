import mysql from 'mysql2/promise';

function normalizeTrustedMigrationSql(sql) {
  return String(sql)
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;?/gim, '')
    .replace(/\bTEXT\b/g, 'VARCHAR(191)')
    .replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE INDEX')
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO')
    .replace(/(official_use\s+JSON\s+NOT\s+NULL)\s+DEFAULT\s+'\{\}'/gi, '$1')
    .replace(/(?<!`)\bcondition\b(?!`)/gi, '`condition`')
    .replace(/'category-'\s*\|\|\s*lower\(replace\(category_name,\s*' ',\s*'-'\)\)/gi, "CONCAT('category-', LOWER(REPLACE(category_name, ' ', '-')))")
    .replace(/FROM\s*\(SELECT\s+'ADMINISTRATIVE'/i, "FROM (SELECT 'ADMINISTRATIVE'")
    .replace(/(UNION ALL SELECT 'SYSTEM & SECURITY', 20)\s*\)/i, '$1) AS seed');
}

export function createDatabaseAdapter({ environment } = {}) {
  const connectionString = environment?.DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the TiDB AI persistence adapter.');
  }

  const testConnection = environment?.OSAAH_TEST_DATABASE_URL || process.env.OSAAH_TEST_DATABASE_URL;
  const pool = mysql.createPool({
    uri: connectionString,
    ...(testConnection ? {} : { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }),
    waitForConnections: true,
    multipleStatements: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return {
    async query(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },

    async execute(sql, params = []) {
      const statement = params.length === 0 ? normalizeTrustedMigrationSql(sql).trim() : sql;
      const [result] = params.length === 0 && statement.includes(';') ? await pool.query(statement) : await pool.execute(statement, params);
      return {
        insertId: result.insertId,
        affectedRows: result.affectedRows
      };
    },

    async transaction(callback) {
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      try {
        const transactionalAdapter = {
          async query(sql, params = []) {
            const [rows] = await connection.query(sql, params);
            return rows;
          },
          async execute(sql, params = []) {
            const statement = params.length === 0 ? normalizeTrustedMigrationSql(sql).trim() : sql;
            const [result] = params.length === 0 && statement.includes(';')
              ? await connection.query(statement)
              : await connection.execute(statement, params);
            return {
              insertId: result.insertId,
              affectedRows: result.affectedRows
            };
          }
        };

        const result = await callback(transactionalAdapter);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async healthCheck() {
      try {
        await pool.query('SELECT 1');
        return { healthy: true };
      } catch (error) {
        return { healthy: false, error: error.message };
      }
    },

    async close() {
      await pool.end();
    },

    async ensureMetadata() {
      await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, name VARCHAR(255) NOT NULL, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration_lock (lock_id TINYINT PRIMARY KEY, locked TINYINT NOT NULL DEFAULT 0, acquired_at DATETIME NULL)`);
      await pool.query(`INSERT INTO schema_migration_lock (lock_id, locked) VALUES (1, 0) ON DUPLICATE KEY UPDATE lock_id = lock_id`);
    },

    async listApplied() {
      const [rows] = await pool.query('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version ASC');
      return rows;
    },

    async recordApplied(record) {
      if (!record || !Number.isInteger(Number(record.version)) || !record.name || !record.checksum || !record.appliedAt) throw new Error('Invalid migration metadata.');
      const appliedAt = new Date(record.appliedAt);
      if (Number.isNaN(appliedAt.getTime())) throw new Error('Invalid migration metadata.');
      const mysqlTimestamp = appliedAt.toISOString().slice(0, 19).replace('T', ' ');
      await pool.execute('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [Number(record.version), record.name, record.checksum, mysqlTimestamp]);
    },

    async acquireLock() {
      const [result] = await pool.execute('UPDATE schema_migration_lock SET locked = 1, acquired_at = CURRENT_TIMESTAMP WHERE lock_id = 1 AND locked = 0', []);
      return Number(result.affectedRows) === 1;
    },

    async releaseLock() {
      await pool.execute('UPDATE schema_migration_lock SET locked = 0, acquired_at = NULL WHERE lock_id = 1', []);
    }
  };
}

export default createDatabaseAdapter;
