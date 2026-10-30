import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfiguredDatabaseAdapter } from '../src/ai/durable-stores.js';

const pgUrl = 'postgresql://user:password@localhost:5432/osaah';
const tidbUrl = 'mysql://user:password@localhost:4000/osaah';

async function assertTiDBAdapter(environment) {
  const adapter = await loadConfiguredDatabaseAdapter({ environment });
  try {
    assert.equal(adapter.supportsDurableAuthSessions, true);
    assert.equal(typeof adapter.query, 'function');
    assert.equal(typeof adapter.execute, 'function');
    assert.equal(typeof adapter.transaction, 'function');
  } finally {
    await adapter.close();
  }
}

test('MySQL DATABASE_URL selects TiDB without a PostgreSQL URL, with or without explicit selection', async () => {
  await assertTiDBAdapter({ DATABASE_URL: tidbUrl });
  await assertTiDBAdapter({ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl });
});

test('TiDB selection rejects conflicting PostgreSQL runtime URLs without exposing them', async () => {
  for (const environment of [
    { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, OSAAH_POSTGRES_URL: pgUrl },
    { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: tidbUrl, POSTGRES_URL: 'postgresql://other:secret@other.example.test:5432/osaah' },
    { OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'postgresql://private:secret@localhost:5432/osaah' }
  ]) {
    await assert.rejects(
      () => loadConfiguredDatabaseAdapter({ environment }),
      (error) => error.code === 'DATABASE_CONFIGURATION_CONFLICT' && !/secret|localhost|other\.example/.test(error.message)
    );
  }
});

test('PostgreSQL runtime remains selectable from the application or Vercel URL', async () => {
  for (const environment of [
    { OSAAH_POSTGRES_URL: pgUrl },
    { POSTGRES_URL: pgUrl },
    { OSAAH_DATABASE_ADAPTER: 'postgres', OSAAH_POSTGRES_URL: pgUrl },
    { OSAAH_POSTGRES_URL: pgUrl, POSTGRES_URL: 'not-selected-as-a-fallback' }
  ]) {
    const adapter = await loadConfiguredDatabaseAdapter({ environment });
    try {
      assert.equal(typeof adapter.query, 'function');
      assert.equal(typeof adapter.transaction, 'function');
      assert.equal(typeof adapter.healthCheck, 'function');
    } finally {
      await adapter.close();
    }
  }
});

test('invalid adapter and incomplete or malformed database settings fail safely', async () => {
  const invalid = [
    [{ OSAAH_DATABASE_ADAPTER: 'unknown', DATABASE_URL: tidbUrl }, 'DATABASE_ADAPTER_INVALID'],
    [{ OSAAH_DATABASE_ADAPTER: 'postgres', DATABASE_URL: tidbUrl, OSAAH_POSTGRES_URL: pgUrl }, 'DATABASE_CONFIGURATION_CONFLICT'],
    [{ OSAAH_DATABASE_ADAPTER: 'postgres' }, 'POSTGRES_URL_REQUIRED'],
    [{ DATABASE_URL: pgUrl }, 'POSTGRES_URL_REQUIRED'],
    [{ DATABASE_URL: 'sqlite://localhost/osaah' }, 'DATABASE_URL_INVALID'],
    [{ OSAAH_POSTGRES_URL: 'not-a-postgres-url' }, 'DATABASE_URL_INVALID'],
    [{ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'mysql://bad[' }, 'DATABASE_URL_INVALID'],
    [{ OSAAH_DATABASE_ADAPTER: 'tidb', DATABASE_URL: 'mysql://user@localhost/osaah' }, 'DATABASE_CONFIGURATION_INVALID']
  ];
  for (const [environment, code] of invalid) {
    await assert.rejects(
      () => loadConfiguredDatabaseAdapter({ environment }),
      (error) => error.code === code && !/secret|localhost|bad\[/.test(error.message)
    );
  }
});

test('configured PostgreSQL URL wins over a stale DATABASE_URL with a sanitized warning', async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    const adapter = await loadConfiguredDatabaseAdapter({
      environment: { OSAAH_POSTGRES_URL: pgUrl, DATABASE_URL: 'mysql://private:secret@legacy.example.test:4000/osaah' }
    });
    try {
      assert.equal(typeof adapter.query, 'function');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /DATABASE_URL is set but ignored/);
      assert.doesNotMatch(warnings[0], /private|secret|legacy\.example|mysql:/i);
    } finally {
      await adapter.close();
    }
  } finally {
    console.warn = previousWarn;
  }
});
