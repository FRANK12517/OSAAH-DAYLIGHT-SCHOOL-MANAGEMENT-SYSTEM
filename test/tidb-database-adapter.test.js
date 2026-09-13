import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { loadConfiguredAIPersistence } from '../src/ai/durable-stores.js';

test('TiDB database adapter requires DATABASE_URL', () => {
  assert.throws(() => createDatabaseAdapter({ environment: {} }), {
    message: 'DATABASE_URL is required for the TiDB AI persistence adapter.'
  });
});

test('TiDB database adapter exposes the durable persistence contract', async () => {
  const adapter = createDatabaseAdapter({ environment: { DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' } });
  assert.deepEqual(Object.keys(adapter).sort(), ['acquireLock', 'ensureMetadata', 'execute', 'healthCheck', 'listApplied', 'query', 'recordApplied', 'releaseLock', 'transaction']);
  assert.equal(typeof adapter.query, 'function');
  assert.equal(typeof adapter.execute, 'function');
  assert.equal(typeof adapter.transaction, 'function');
  assert.equal(typeof adapter.ensureMetadata, 'function');
  assert.equal(typeof adapter.listApplied, 'function');
  assert.equal(typeof adapter.recordApplied, 'function');
  assert.equal(typeof adapter.acquireLock, 'function');
  assert.equal(typeof adapter.releaseLock, 'function');
  assert.equal(typeof adapter.healthCheck, 'function');
});

test('production persistence auto-loads the bundled adapter when DATABASE_URL is configured', async () => {
  const persistence = await loadConfiguredAIPersistence({ environment: { NODE_ENV: 'production', DATABASE_URL: 'mysql://user:password@example.test:4000/osaah' } });
  assert.equal(persistence.durable, true);
  assert.equal(persistence.auditSink.durable, true);
  assert.equal(persistence.actionStore.durable, true);
});
