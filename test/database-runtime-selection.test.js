import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfiguredAIPersistence, loadConfiguredDatabaseAdapter } from '../src/ai/durable-stores.js';

const pgUrl = 'postgresql://user:password@localhost:5432/osaah';
const tidbUrl = 'mysql://user:password@localhost:4000/osaahdaylightschool';

async function assertTiDBAdapter(environment) {
  const adapter = await loadConfiguredDatabaseAdapter({ environment });
  try {
    assert.equal(adapter.dialect, 'tidb');
    assert.equal(adapter.supportsDurableAuthSessions, true);
    assert.equal(typeof adapter.query, 'function');
    assert.equal(typeof adapter.execute, 'function');
    assert.equal(typeof adapter.transaction, 'function');
  } finally { await adapter.close(); }
}

test('MySQL DATABASE_URL selects only TiDB and the configured school database', async () => {
  await assertTiDBAdapter({ DATABASE_URL: tidbUrl });
  await assertTiDBAdapter({ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl });
});

test('PostgreSQL adapter selection and URL configuration are rejected', async () => {
  for (const environment of [
    { OSAAH_DATABASE_ADAPTER: 'postgres', OSAAH_POSTGRES_URL: pgUrl },
    { POSTGRES_URL: pgUrl },
    { DATABASE_URL: pgUrl },
    { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, OSAAH_POSTGRES_URL: pgUrl },
    { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, POSTGRES_URL: pgUrl }
  ]) {
    await assert.rejects(() => loadConfiguredDatabaseAdapter({ environment }), (error) =>
      ['DATABASE_ADAPTER_INVALID', 'DATABASE_CONFIGURATION_CONFLICT', 'DATABASE_URL_INVALID'].includes(error.code)
      && !/password|localhost/.test(error.message));
  }
});

test('invalid or missing TiDB configuration fails safely', async () => {
  const invalid = [
    [{ OSAAH_DATABASE_ADAPTER: 'unknown', DATABASE_URL: tidbUrl }, 'DATABASE_ADAPTER_INVALID'],
    [{ DATABASE_URL: 'sqlite://localhost/osaah' }, 'DATABASE_URL_INVALID'],
    [{ DATABASE_URL: 'mysql://bad[' }, 'DATABASE_URL_INVALID'],
    [{ DATABASE_URL: 'mysql://user@localhost/osaahdaylightschool' }, 'DATABASE_CONFIGURATION_INVALID'],
    [{ DATABASE_URL: 'mysql://user:password@localhost/osaah' }, 'DATABASE_NAME_MISMATCH']
  ];
  for (const [environment, code] of invalid) {
    await assert.rejects(() => loadConfiguredDatabaseAdapter({ environment }), (error) => error.code === code);
  }
  await assert.rejects(() => loadConfiguredDatabaseAdapter({ environment: {}, required: true }), (error) => error.code === 'TIDB_DATABASE_URL_REQUIRED');
  await assert.rejects(() => loadConfiguredAIPersistence({ environment: { NODE_ENV: 'production' } }), (error) => error.code === 'TIDB_DATABASE_URL_REQUIRED');
});
