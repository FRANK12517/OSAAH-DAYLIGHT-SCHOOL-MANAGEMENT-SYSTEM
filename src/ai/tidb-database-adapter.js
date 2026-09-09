import mysql from 'mysql2/promise';

export function createDatabaseAdapter({ environment } = {}) {
  const connectionString = environment?.DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the TiDB AI persistence adapter.');
  }

  const pool = mysql.createPool({
    uri: connectionString,
    ssl: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return {
    async query(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },

    async execute(sql, params = []) {
      const [result] = await pool.execute(sql, params);
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
            const [result] = await connection.execute(sql, params);
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
    }
  };
}

export default createDatabaseAdapter;
