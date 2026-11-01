import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { loadConfiguredAIPersistence } from '../src/ai/durable-stores.js';

function fakeAdapter({ resolver = () => [] } = {}) {
  return createDatabaseAdapter({
    environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' },
    poolFactory: () => ({
      async query(sql, params) { return [resolver(sql, params), []]; },
      async execute() { return [{ insertId: 0, affectedRows: 0 }, []]; },
      async getConnection() { throw new Error('getConnection is not used by query contract tests.'); },
      async end() {}
    })
  });
}

test('TiDB database adapter accepts direct environment-variable connection settings', () => {
  let options;
  const adapter = createDatabaseAdapter({
    environment: { TIDB_HOST: 'db.example.test', TIDB_USER: 'user', TIDB_PASSWORD: 'password', TIDB_DATABASE: 'osaahdaylightschool', TIDB_PORT: '4000', TIDB_CA_CERT: 'ca\\ncertificate' },
    poolFactory: (value) => { options = value; return { async end() {} }; }
  });
  assert.equal(options.host, 'db.example.test');
  assert.equal(options.user, 'user');
  assert.equal(options.password, 'password');
  assert.equal(options.database, 'osaahdaylightschool');
  assert.equal(options.port, 4000);
  assert.deepEqual(options.ssl, { minVersion: 'TLSv1.2', rejectUnauthorized: true, ca: 'ca\ncertificate' });
  return adapter.close();
});

test('TiDB database URL supplies credentials while HOST, PORT, and DATABASE override its destination', async () => {
  let options;
  const adapter = createDatabaseAdapter({
    environment: {
      DATABASE_URL: 'mysql://uri-user:p%40ssword@uri.example.test:4000/uri_database',
      HOST: 'tidb.example.test',
      PORT: '4100',
      DATABASE: 'osaahdaylightschool',
      TIDB_CA_CERT: '-----BEGIN CERTIFICATE-----\\nca-data\\n-----END CERTIFICATE-----'
    },
    poolFactory: (value) => { options = value; return { async end() {} }; }
  });
  try {
    assert.equal(options.host, 'tidb.example.test');
    assert.equal(options.port, 4100);
    assert.equal(options.database, 'osaahdaylightschool');
    assert.equal(options.user, 'uri-user');
    assert.equal(options.password, 'p@ssword');
    assert.deepEqual(options.ssl, { minVersion: 'TLSv1.2', rejectUnauthorized: true, ca: '-----BEGIN CERTIFICATE-----\nca-data\n-----END CERTIFICATE-----' });
  } finally { await adapter.close(); }
});

test('TiDB database URL supplies connection fields when component variables are absent', async () => {
  let options;
  const adapter = createDatabaseAdapter({
    environment: { DATABASE_URL: 'mysql://uri-user:uri-password@tidb.example.test:4000/osaahdaylightschool' },
    poolFactory: (value) => { options = value; return { async end() {} }; }
  });
  try {
    assert.deepEqual({ host: options.host, port: options.port, database: options.database, user: options.user, password: options.password }, {
      host: 'tidb.example.test', port: 4000, database: 'osaahdaylightschool', user: 'uri-user', password: 'uri-password'
    });
    assert.deepEqual(options.ssl, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  } finally { await adapter.close(); }
});

test('TiDB database adapter exposes the durable persistence contract', async () => {
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' } });
  assert.deepEqual(Object.keys(adapter).sort(), ['acquireLock', 'close', 'completeMigration', 'dialect', 'ensureMetadata', 'execute', 'failActiveMigration', 'healthCheck', 'listApplied', 'listBaselines', 'listMigrationRuns', 'query', 'recordApplied', 'recordBaseline', 'releaseLock', 'startMigration', 'supportsDurableAuthSessions', 'transaction', 'verifyReadiness']);
  assert.equal(adapter.dialect, 'tidb');
  assert.equal(adapter.supportsDurableAuthSessions, true);
  assert.equal(typeof adapter.query, 'function');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.transaction, 'function');
  assert.equal(typeof adapter.healthCheck, 'function');
  assert.equal(typeof adapter.ensureMetadata, 'function');
  assert.equal(typeof adapter.listApplied, 'function');
  assert.equal(typeof adapter.recordBaseline, 'function');
});

test('readiness verifies the TiDB identity and durable authentication schema', async () => {
  const adapter = createDatabaseAdapter({
    environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' },
    poolFactory: () => ({ async query(sql) {
      if (sql.startsWith('SELECT DATABASE()')) return [[{ database_name: 'osaahdaylightschool', server_version: '5.7.25-TiDB-v8.5.0' }]];
      if (sql.includes('FROM auth_sessions')) return [[], []];
      throw new Error('unexpected query');
    }, async end() {} })
  });
  assert.deepEqual(await adapter.verifyReadiness(), { ready: true, database: 'osaahdaylightschool', engine: 'TiDB', serverVersion: '5.7.25-TiDB-v8.5.0', authenticationSchemaReady: true, schemaErrorCode: null });
  await adapter.close();
});

test('missing authentication schema is reported without preventing server startup', async () => {
  const adapter = createDatabaseAdapter({
    environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' },
    poolFactory: () => ({ async query(sql) {
      if (sql.startsWith('SELECT DATABASE()')) return [[{ database_name: 'osaahdaylightschool', server_version: '5.7.25-TiDB-v8.5.0' }]];
      throw Object.assign(new Error('mysql://private-user:secret@private-host/private-db'), { code: 'ER_NO_SUCH_TABLE' });
    }, async end() {} })
  });
  assert.deepEqual(await adapter.verifyReadiness(), { ready: true, database: 'osaahdaylightschool', engine: 'TiDB', serverVersion: '5.7.25-TiDB-v8.5.0', authenticationSchemaReady: false, schemaErrorCode: 'AUTH_SCHEMA_NOT_READY' });
  await adapter.close();
});

test('TiDB adapter query returns rows directly for database, zero, single, multiple, and parameterized SELECTs', async () => {
  const adapter = fakeAdapter({ resolver: (sql, params) => {
    if (sql.includes('SELECT DATABASE()')) return [{ database_name: 'osaahdaylightschool' }];
    if (sql.includes('zero_rows')) return [];
    if (sql.includes('single_row')) return [{ id: params[0] }];
    if (sql.includes('multiple_rows')) return [{ id: 1 }, { id: 2 }];
    return [];
  } });
  try {
    assert.deepEqual(await adapter.query('SELECT DATABASE() AS database_name'), [{ database_name: 'osaahdaylightschool' }]);
    assert.deepEqual(await adapter.query('SELECT * FROM zero_rows'), []);
    assert.deepEqual(await adapter.query('SELECT * FROM single_row WHERE id = ?', ['one']), [{ id: 'one' }]);
    assert.deepEqual(await adapter.query('SELECT * FROM multiple_rows'), [{ id: 1 }, { id: 2 }]);
    const parameterized = await adapter.query('SELECT * FROM single_row WHERE id = ?', ['two']);
    assert.deepEqual(parameterized, [{ id: 'two' }]);
    assert.equal(Array.isArray(parameterized[0]), false);
  } finally { await adapter.close(); }
});

test('application AI persistence selects TiDB from the explicit adapter setting', async () => {
  const persistence = await loadConfiguredAIPersistence({ environment: { NODE_ENV: 'production', OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' } });
  assert.equal(persistence.durable, true);
  await persistence.close();
});

test('application adapter auto-detects a MySQL DATABASE_URL when no adapter is specified', async () => {
  const persistence = await loadConfiguredAIPersistence({ environment: { NODE_ENV: 'production', DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' } });
  assert.equal(persistence.durable, true);
  await persistence.close();
});

function migrationPool({ failOn } = {}) {
  const statements = [];
  const connection = {
    async beginTransaction() {},
    async execute(sql) { statements.push(sql); if (failOn && sql.includes(failOn)) throw Object.assign(new Error('private database detail'), { code: 'ER_TEST', sqlState: '42000' }); return [{ affectedRows: 1 }, []]; },
    async query() { return [[], []]; },
    async commit() {},
    async rollback() {},
    release() {}
  };
  return { statements, pool: { async query() { return [[], []]; }, async execute() { return [{ affectedRows: 1 }, []]; }, async getConnection() { return connection; }, async end() {} } };
}

test('migration execution runs statements individually without enabling normal multi-statements', async () => {
  const { pool, statements } = migrationPool();
  let poolOptions;
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' }, poolFactory: (options) => { poolOptions = options; return pool; } });
  try {
    await adapter.transaction(async (transaction) => transaction.executeMigrationSql("-- comment;\nCREATE TABLE one (value TEXT DEFAULT 'a;b'); CREATE TABLE two (id TEXT);", { migrationName: '049_production_schema_reconciliation.sql', version: 49 }));
    assert.deepEqual(statements, ["-- comment;\nCREATE TABLE one (value TEXT DEFAULT 'a;b')", 'CREATE TABLE two (id TEXT)']);
    assert.equal(poolOptions.multipleStatements, undefined);
  } finally { await adapter.close(); }
});

test('migration execution reports statement diagnostics without private database details', async () => {
  const { pool, statements } = migrationPool({ failOn: 'BROKEN' });
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaahdaylightschool' }, poolFactory: () => pool });
  try {
    await assert.rejects(() => adapter.transaction((transaction) => transaction.executeMigrationSql('CREATE TABLE ok (id TEXT); BROKEN;', { migrationName: '049_production_schema_reconciliation.sql', version: 49 })), (error) => {
      assert.equal(error.code, 'MIGRATION_STATEMENT_FAILED');
      assert.deepEqual(error.details, { migration: '049_production_schema_reconciliation.sql', version: 49, statementIndex: 2, operation: 'BROKEN', databaseCode: 'ER_TEST', sqlState: '42000', databaseMessage: 'private database detail' });
      return true;
    });
    assert.equal(statements.length, 2);
  } finally { await adapter.close(); }
});
