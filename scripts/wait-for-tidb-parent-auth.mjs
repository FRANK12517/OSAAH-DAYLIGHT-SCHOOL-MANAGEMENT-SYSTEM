import mysql from 'mysql2/promise';

const expectedVersion = '8.5.3';
const host = process.env.TIDB_TEST_HOST ?? '';
const port = Number(process.env.TIDB_TEST_PORT ?? '4000');
const user = process.env.TIDB_TEST_BOOTSTRAP_USER ?? '';
const password = process.env.TIDB_TEST_BOOTSTRAP_PASSWORD ?? '';

if (process.env.CI !== 'true' || !['127.0.0.1', 'localhost'].includes(host)
  || port !== 4000 || user !== 'root'
  || process.env.TIDB_TEST_DATABASE !== 'osaah_parent_auth_test') {
  throw new Error('Refusing to wait for a TiDB target outside the isolated CI test configuration.');
}

const deadline = Date.now() + 240_000;
let lastCode = null;
while (Date.now() < deadline) {
  let connection;
  try {
    connection = await mysql.createConnection({ host, port, user, password, database: 'mysql', connectTimeout: 3000 });
    const [rows] = await connection.query('SELECT VERSION() AS version');
    const version = String(rows[0]?.version ?? '');
    if (!/TiDB/i.test(version) || !version.includes(`v${expectedVersion}`)) {
      throw new Error(`Expected TiDB v${expectedVersion}; server identified as ${version || 'unknown'}.`);
    }
    await connection.query('CREATE DATABASE IF NOT EXISTS osaah_parent_auth_test');
    await connection.query('CREATE DATABASE IF NOT EXISTS osaah_parent_auth_bucket_test');
    await connection.query("CREATE USER IF NOT EXISTS 'osaah_ci_parent'@'%' IDENTIFIED BY 'disposable-ci-password-only'");
    await connection.query("GRANT ALL PRIVILEGES ON osaah_parent_auth_test.* TO 'osaah_ci_parent'@'%'");
    await connection.query("GRANT ALL PRIVILEGES ON osaah_parent_auth_bucket_test.* TO 'osaah_ci_parent'@'%'");
    await connection.end();
    process.stdout.write(`Ready: ${version}; isolated databases initialized.\n`);
    process.exit(0);
  } catch (error) {
    lastCode = error?.code ?? error?.message ?? 'unknown';
    try { await connection?.end(); } catch { /* retry until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
throw new Error(`TiDB did not pass a real connection/version query before timeout (${lastCode}).`);
