import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfiguredDatabaseAdapter, validateRuntimeDatabaseConfiguration } from '../src/ai/durable-stores.js';

const pgUrl = 'postgresql://user:password@localhost:5432/osaah';
const tidbUrl = 'mysql://user:password@localhost:4000/osaah';

test('TiDB selection requires an explicit adapter and selects mysql2 adapter when requested', async () => {
  await assert.rejects(() => loadConfiguredDatabaseAdapter({ environment: { DATABASE_URL: tidbUrl } }), { code: 'DATABASE_ADAPTER_REQUIRED' });
  const adapter = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl } });
  assert.equal(adapter.supportsDurableAuthSessions, true);
  assert.equal(typeof adapter.query, 'function');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.transaction, 'function');
  await adapter.close();
});

test('existing PostgreSQL runtime URL selection stays supported', async () => {
  const adapter = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: pgUrl } });
  assert.equal(typeof adapter.query, 'function');
  assert.equal(typeof adapter.transaction, 'function');
  await adapter.close();
  const explicit = await loadConfiguredDatabaseAdapter({ environment: { OSAAH_DATABASE_ADAPTER: 'postgres', OSAAH_POSTGRES_URL: pgUrl } });
  assert.equal(typeof explicit.query, 'function');
  await explicit.close();
});

test('conflicting adapter URLs, invalid selection, and malformed TiDB URLs fail safely', async () => {
  const invalid = [
    [{ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, OSAAH_POSTGRES_URL: pgUrl }, 'DATABASE_CONFIGURATION_CONFLICT'],
    [{ OSAAH_DATABASE_ADAPTER: 'postgres', DATABASE_URL: tidbUrl, OSAAH_POSTGRES_URL: pgUrl }, 'DATABASE_CONFIGURATION_CONFLICT'],
    [{ OSAAH_DATABASE_ADAPTER: 'postgres', DATABASE_URL: 'postgresql://other:secret@other.example.test:5432/osaah', OSAAH_POSTGRES_URL: pgUrl }, 'DATABASE_CONFIGURATION_CONFLICT'],
    [{ OSAAH_POSTGRES_URL: pgUrl, POSTGRES_URL: 'postgresql://other:secret@db.example.test:5432/osaah' }, 'DATABASE_CONFIGURATION_CONFLICT'],
    [{ OSAAH_DATABASE_ADAPTER: 'unknown', DATABASE_URL: tidbUrl }, 'DATABASE_ADAPTER_INVALID'],
    [{ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'mysql://bad[' }, 'DATABASE_URL_INVALID'],
    [{ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'mysql://user@localhost/osaah' }, 'DATABASE_URL_INVALID']
  ];
  for (const [environment, code] of invalid) {
    await assert.rejects(() => loadConfiguredDatabaseAdapter({ environment }), (error) => error.code === code && !/secret|localhost/.test(error.message));
  }
});

test('production configuration requires a session secret and a supported explicit database configuration', () => {
  assert.deepEqual(validateRuntimeDatabaseConfiguration({ NODE_ENV: 'production' }, { log: false }), {
    ok: false,
    missing: ['OSAAH_SESSION_SECRET (minimum 32 characters)', 'database adapter and connection URL']
  });
  assert.equal(validateRuntimeDatabaseConfiguration({
    NODE_ENV: 'production', OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, OSAAH_SESSION_SECRET: 'x'.repeat(32)
  }, { log: false }).ok, true);
});
