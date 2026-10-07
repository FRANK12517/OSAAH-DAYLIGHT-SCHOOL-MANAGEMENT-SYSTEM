import mysql from 'mysql2/promise';

const safeError = (error) => ({
  ok: false,
  lookupScope: 'schools',
  productionWrites: 'NONE',
  error: { code: error?.code ?? 'SCHOOLS_LOOKUP_FAILED' }
});

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, lookupScope: 'schools', productionWrites: 'NONE', error: { code: 'DATABASE_URL_MISSING' } })}\n`);
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
    const [rows] = await pool.query(
      "SELECT id,name FROM schools WHERE LOWER(name) LIKE '%osaah%' AND LOWER(name) LIKE '%daylight%' ORDER BY id"
    );
    const schools = rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
    const result = {
      ok: schools.length === 1,
      lookupScope: 'schools',
      productionWrites: 'NONE',
      matchCount: schools.length,
      schools
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (schools.length !== 1) process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
