import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPostgresParameters, createDatabaseAdapter } from '../src/ai/postgres-database-adapter.js';
import { loadConfiguredDatabaseAdapter } from '../src/ai/durable-stores.js';

const environment = { OSAAH_POSTGRES_URL: 'postgresql://osaah:test@localhost:5432/osaah' };

test('legacy bind markers are converted outside quoted text and comments', () => {
  const bound = bindPostgresParameters("SELECT ?, '?' AS literal, \"?\" AS quoted -- ?\n/* ? */ WHERE id=?", ['a', 'b']);
  assert.equal(bound.text, "SELECT $1, '?' AS literal, \"?\" AS quoted -- ?\n/* ? */ WHERE id=$2");
  assert.deepEqual(bound.values, ['a', 'b']);
  assert.deepEqual(bindPostgresParameters("SELECT payload ? 'key' FROM records WHERE id=$1", ['r-1']), { text: "SELECT payload ? 'key' FROM records WHERE id=$1", values: ['r-1'] });
  assert.deepEqual(bindPostgresParameters("SELECT payload ? 'key' FROM records"), { text: "SELECT payload ? 'key' FROM records", values: [] });
  assert.throws(() => bindPostgresParameters('SELECT ?', []), { code: 'DATABASE_PARAMETER_COUNT_MISMATCH' });
  assert.throws(() => bindPostgresParameters('SELECT 1', ['unused']), { code: 'DATABASE_PARAMETER_COUNT_MISMATCH' });
});

test('PostgreSQL pool config, row aliases, numeric metadata, and lifecycle use pg semantics', async () => {
  let options, ended = false, called;
  const pool = {
    async query(text, values) {
      called = { text, values };
      if (text === 'SELECT id AS studentId, amount FROM students WHERE id=$1') return { rows: [{ studentid: 's-1', amount: '12.30' }], rowCount: 1, command: 'SELECT' };
      if (text === 'INSERT INTO students(id) VALUES ($1) RETURNING id') return { rows: [{ id: values[0] }], rowCount: 1, command: 'INSERT' };
      return { rows: [], rowCount: 2, command: 'UPDATE' };
    },
    async end() { ended = true; }
  };
  const adapter = createDatabaseAdapter({ environment, poolFactory: (value) => { options = value; return pool; } });
  assert.equal(options.connectionString, environment.OSAAH_POSTGRES_URL);
  assert.equal(options.max, 10);
  assert.equal(options.ssl.rejectUnauthorized, true);
  const rows = await adapter.query('SELECT id AS studentId, amount FROM students WHERE id=?', ['s-1']);
  assert.deepEqual(rows, [{ studentId: 's-1', amount: '12.30' }]);
  assert.deepEqual(called, { text: 'SELECT id AS studentId, amount FROM students WHERE id=$1', values: ['s-1'] });
  const update = await adapter.execute('UPDATE students SET status=?', ['ACTIVE']);
  assert.equal(update.affectedRows, 2);
  assert.equal(update.rowCount, 2);
  const inserted = await adapter.execute('INSERT INTO students(id) VALUES (?) RETURNING id', ['student-returned']);
  assert.equal(inserted.insertId, 'student-returned');
  await adapter.close();
  assert.equal(ended, true);
});

test('PostgreSQL SSL can be disabled only for an explicit loopback database URL', async () => {
  let options;
  const pool = { async query() { return { rows: [], rowCount: 0 }; }, async end() {} };
  createDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL, OSAAH_PG_SSL_MODE: 'disable' }, poolFactory: (value) => { options = value; return pool; } });
  assert.equal(options.ssl, false);
  assert.throws(() => createDatabaseAdapter({
    environment: { OSAAH_POSTGRES_URL: 'postgresql://user:password@db.example.test:5432/osaah', OSAAH_PG_SSL_MODE: 'disable' },
    poolFactory: () => pool
  }), { code: 'DATABASE_SSL_CONFIGURATION_INVALID' });
});

test('Supabase root CA is passed to pg while TLS and hostname verification remain enabled', () => {
  let options;
  const pool = { async query() { return { rows: [], rowCount: 0 }; }, async end() {} };
  const ca = '-----BEGIN CERTIFICATE-----\npublic-root-certificate\n-----END CERTIFICATE-----';
  createDatabaseAdapter({
    environment: {
      OSAAH_POSTGRES_URL: `${environment.OSAAH_POSTGRES_URL}?sslmode=no-verify&sslrootcert=%2Ftmp%2Fignored.crt&application_name=osaah-test`,
      OSAAH_PG_SSL_CA: ca
    },
    poolFactory: (value) => { options = value; return pool; }
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, ca);
  assert.doesNotMatch(options.connectionString, /sslmode|sslrootcert/i);
  assert.match(options.connectionString, /application_name=osaah-test/);
});

test('SUPABASE_CA_CERT takes precedence and converts escaped PEM newlines', () => {
  let options;
  const pool = { async query() { return { rows: [], rowCount: 0 }; }, async end() {} };
  const escapedCa = '-----BEGIN CERTIFICATE-----\\npublic-root-certificate\\n-----END CERTIFICATE-----';
  createDatabaseAdapter({
    environment: {
      OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL,
      SUPABASE_CA_CERT: escapedCa,
      OSAAH_PG_SSL_CA: '-----BEGIN CERTIFICATE-----\\nlegacy-certificate\\n-----END CERTIFICATE-----'
    },
    poolFactory: (value) => { options = value; return pool; }
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, escapedCa.replace(/\\n/g, '\n'));
});

test('DB_SSL_CA is accepted when the preferred Supabase certificate variable is absent', () => {
  let options;
  const pool = { async query() { return { rows: [], rowCount: 0 }; }, async end() {} };
  const ca = '-----BEGIN CERTIFICATE-----\nroot-certificate\n-----END CERTIFICATE-----';
  createDatabaseAdapter({
    environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL, DB_SSL_CA: ca },
    poolFactory: (value) => { options = value; return pool; }
  });
  assert.equal(options.ssl.ca, ca);
  assert.equal(options.ssl.rejectUnauthorized, true);
});

test('idle pool errors are consumed and logged without connection details', () => {
  let onError, options;
  const pool = {
    on(event, listener) { if (event === 'error') onError = listener; },
    async query() { return { rows: [], rowCount: 0 }; },
    async end() {}
  };
  const previousError = console.error;
  const diagnostics = [];
  console.error = (...values) => diagnostics.push(values);
  try {
    createDatabaseAdapter({ environment, poolFactory: (value) => { options = value; return pool; } });
    assert.equal(typeof onError, 'function');
    onError(Object.assign(new Error('host=private.example password=secret'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }));
  } finally {
    console.error = previousError;
  }
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0][1], {
    component: 'postgres_database', operation: 'idle_client',
    category: 'TLS_CERTIFICATE_VALIDATION_FAILED', code: 'SELF_SIGNED_CERT_IN_CHAIN'
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /private\.example|secret/);
});

test('PostgreSQL CA configuration cannot be combined with disabled TLS', () => {
  assert.throws(() => createDatabaseAdapter({
    environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL, OSAAH_PG_SSL_MODE: 'disable', OSAAH_PG_SSL_CA: 'certificate' },
    poolFactory: () => ({})
  }), { code: 'DATABASE_SSL_CONFIGURATION_INVALID' });
});

test('PostgreSQL transaction commits, releases, and exposes scoped query methods', async () => {
  const statements = [];
  const client = {
    async query(text, values = []) {
      statements.push([text, values]);
      if (text === 'SELECT id FROM rows WHERE id=$1') return { rows: [{ id: values[0] }], rowCount: 1, command: 'SELECT' };
      return { rows: [], rowCount: 1, command: text };
    },
    release() { statements.push(['RELEASE', []]); }
  };
  const pool = { async query() { return { rows: [], rowCount: 0 }; }, async connect() { return client; }, async end() {} };
  const adapter = createDatabaseAdapter({ environment, poolFactory: () => pool });
  const value = await adapter.transaction(async (tx) => (await tx.query('SELECT id FROM rows WHERE id=?', ['r-1']))[0].id);
  assert.equal(value, 'r-1');
  assert.deepEqual(statements.map(([sql]) => sql), ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT id FROM rows WHERE id=$1', 'COMMIT', 'RELEASE']);
});

test('PostgreSQL transaction rolls back failures and retries only explicit transient failures', async () => {
  let attempts = 0, releases = 0;
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; }, async end() {},
    async connect() {
      return {
        async query(sql) { if (sql === 'SELECT work') { attempts += 1; if (attempts === 1) throw Object.assign(new Error('serialization failure'), { code: '40001' }); } return { rows: [], rowCount: 0 }; },
        release() { releases += 1; }
      };
    }
  };
  const adapter = createDatabaseAdapter({ environment, poolFactory: () => pool, retryDelay: async () => {} });
  await adapter.transaction(async (tx) => tx.query('SELECT work'), { isolationLevel: 'SERIALIZABLE', retries: 1 });
  assert.equal(attempts, 2);
  assert.equal(releases, 2);
  await assert.rejects(() => adapter.transaction(async () => {}, { isolationLevel: 'READ UNCOMMITTED' }), { code: 'DATABASE_ISOLATION_INVALID' });
});

test('PostgreSQL adapter refuses non-PostgreSQL URLs', () => {
  assert.throws(() => createDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: 'mysql://example/db' } }), { code: 'DATABASE_URL_INVALID' });
  assert.throws(() => createDatabaseAdapter({ environment: { DATABASE_URL: 'postgresql://legacy@example/db' } }), { code: 'POSTGRES_URL_REQUIRED' });
  assert.throws(() => createDatabaseAdapter({ environment: {} }), { code: 'POSTGRES_URL_REQUIRED' });
  assert.throws(
    () => createDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: 'postgresql://private:secret@[' } }),
    (error) => error.code === 'DATABASE_URL_INVALID' && !error.message.includes('secret')
  );
});

test('configured app adapter selects PostgreSQL only when the separate PostgreSQL URL is set', async () => {
  const adapter = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL } });
  assert.equal(typeof adapter?.transaction, 'function');
  assert.equal(typeof adapter?.healthCheck, 'function');
  await adapter.close();
});

test('application adapter refuses TiDB DATABASE_URL instead of loading the legacy adapter', async () => {
  await assert.rejects(
    () => loadConfiguredDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@localhost:4000/osaah' } }),
    (error) => error.code === 'POSTGRES_URL_REQUIRED' && !error.message.includes('password')
  );
});

test('application adapter requires explicit OSAAH_POSTGRES_URL for PostgreSQL', async () => {
  await assert.rejects(
    () => loadConfiguredDatabaseAdapter({ environment: { DATABASE_URL: 'postgresql://private:secret@localhost:5432/osaah' } }),
    (error) => error.code === 'POSTGRES_URL_REQUIRED' && !error.message.includes('secret')
  );
  await assert.rejects(
    () => loadConfiguredDatabaseAdapter({ environment: {}, required: true }),
    (error) => error.code === 'POSTGRES_URL_REQUIRED'
  );
});

test('production/serverless startup fails closed when OSAAH_POSTGRES_URL is missing', async () => {
  await assert.rejects(
    () => loadConfiguredDatabaseAdapter({ environment: { NODE_ENV: 'production' }, required: true }),
    { code: 'POSTGRES_URL_REQUIRED' }
  );
});

test('explicit OSAAH PostgreSQL URL takes precedence over stale DATABASE_URL without exposing either value', async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    for (const legacyUrl of [
      'mysql://user:password@legacy.example.test:4000/osaah',
      'postgresql://other:secret@different.example.test:5432/osaah'
    ]) {
      const adapter = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL, DATABASE_URL: legacyUrl } });
      assert.equal(typeof adapter?.transaction, 'function');
      await adapter.close();
    }
    assert.equal(warnings.length, 2);
    for (const warning of warnings) {
      assert.match(warning, /DATABASE_URL is set but ignored/);
      assert.doesNotMatch(warning, /password|secret|legacy\.example|different\.example|postgresql:/i);
    }
  } finally {
    console.warn = previousWarn;
  }
});

test('legacy DATABASE_URL alone cannot configure application runtime', async () => {
  await assert.rejects(
    () => loadConfiguredDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@legacy.example.test:4000/osaah' } }),
    (error) => error.code === 'POSTGRES_URL_REQUIRED' && !error.message.includes('password')
  );
  const adapter = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: environment.OSAAH_POSTGRES_URL, DATABASE_URL: environment.OSAAH_POSTGRES_URL } });
  assert.equal(typeof adapter?.transaction, 'function');
  await adapter.close();
});
