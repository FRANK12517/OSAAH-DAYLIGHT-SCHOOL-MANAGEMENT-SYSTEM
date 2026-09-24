import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { loadConfiguredAIPersistence } from '../src/ai/durable-stores.js';

function fakeAdapter({ resolver = () => [] } = {}) {
  return createDatabaseAdapter({
    environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' },
    poolFactory: () => ({
      async query(sql, params) { return [resolver(sql, params), []]; },
      async execute() { return [{ insertId: 0, affectedRows: 0 }, []]; },
      async getConnection() { throw new Error('getConnection is not used by query contract tests.'); },
      async end() {}
    })
  });
}

test('TiDB database adapter requires DATABASE_URL', () => {
  const original = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.throws(() => createDatabaseAdapter({ environment: {} }), {
      message: 'DATABASE_URL is required for the TiDB database adapter.'
    });
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});

test('TiDB database adapter exposes the durable persistence contract', async () => {
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' } });
  assert.deepEqual(Object.keys(adapter).sort(), ['acquireLock', 'close', 'ensureMetadata', 'execute', 'healthCheck', 'listApplied', 'listBaselines', 'query', 'recordApplied', 'recordBaseline', 'releaseLock', 'supportsDurableAuthSessions', 'transaction']);
  assert.equal(adapter.supportsDurableAuthSessions, true);
  assert.equal(typeof adapter.query, 'function');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.transaction, 'function');
  assert.equal(typeof adapter.healthCheck, 'function');
  assert.equal(typeof adapter.ensureMetadata, 'function');
  assert.equal(typeof adapter.listApplied, 'function');
  assert.equal(typeof adapter.recordBaseline, 'function');
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

test('production persistence auto-loads the bundled adapter when DATABASE_URL is configured', async () => {
  const persistence = await loadConfiguredAIPersistence({ environment: { NODE_ENV: 'production', DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' } });
  assert.equal(persistence.durable, true);
  assert.equal(persistence.auditSink.durable, true);
  assert.equal(persistence.actionStore.durable, true);
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
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' }, poolFactory: (options) => { poolOptions = options; return pool; } });
  try {
    await adapter.transaction(async (transaction) => transaction.executeMigrationSql("-- comment;\nCREATE TABLE one (value TEXT DEFAULT 'a;b'); CREATE TABLE two (id TEXT);", { migrationName: '049_production_schema_reconciliation.sql', version: 49 }));
    assert.deepEqual(statements, ["-- comment;\nCREATE TABLE one (value TEXT DEFAULT 'a;b')", 'CREATE TABLE two (id TEXT)']);
    assert.equal(poolOptions.multipleStatements, undefined);
  } finally { await adapter.close(); }
});

test('migration execution reports statement diagnostics without private database details', async () => {
  const { pool, statements } = migrationPool({ failOn: 'BROKEN' });
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' }, poolFactory: () => pool });
  try {
    await assert.rejects(() => adapter.transaction((transaction) => transaction.executeMigrationSql('CREATE TABLE ok (id TEXT); BROKEN;', { migrationName: '049_production_schema_reconciliation.sql', version: 49 })), (error) => {
      assert.equal(error.code, 'MIGRATION_STATEMENT_FAILED');
      assert.deepEqual(error.details, { migration: '049_production_schema_reconciliation.sql', version: 49, statementIndex: 2, operation: 'BROKEN', databaseCode: 'ER_TEST', sqlState: '42000', databaseMessage: 'private database detail' });
      return true;
    });
    assert.equal(statements.length, 2);
  } finally { await adapter.close(); }
});
