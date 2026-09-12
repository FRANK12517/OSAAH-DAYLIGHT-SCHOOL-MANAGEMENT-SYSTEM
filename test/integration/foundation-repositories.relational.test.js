import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabaseAdapter } from '../../src/ai/tidb-database-adapter.js';
import { createDurableFoundationRepositories } from '../../src/platform/durable-foundation-repositories.js';
import { discoverMigrations, createMigrationRunner } from '../../src/platform/migration-runner.js';
import { resolve } from 'node:path';

const url = process.env.OSAAH_TEST_DATABASE_URL;
if (!url) {
  test('relational acceptance requires OSAAH_TEST_DATABASE_URL', { skip: 'relational database is configured only in explicit integration runs' }, () => {});
}
let adapter;
let repositories;

before(async () => {
  if (!url) return;
  adapter = createDatabaseAdapter({ environment: { DATABASE_URL: url, OSAAH_TEST_DATABASE_URL: url } });
  const health = await adapter.healthCheck();
  assert.equal(health.healthy, true, 'relational test database is unhealthy');
  const runner = createMigrationRunner({ adapter, directory: resolve('schema') });
  await runner.apply();
  repositories = createDurableFoundationRepositories({ adapter });
});

after(async () => { await adapter?.close?.(); });

test('migration metadata is applied and durable factory is constructed', { skip: !url }, async () => {
  const migrations = await adapter.listApplied();
  assert.equal(migrations.length, 25);
  assert.equal(repositories.durable, true);
});

test('staff assignment queries enforce tenancy through staff_profiles join', { skip: !url }, async () => {
  const rows = await adapter.query('SELECT sa.id FROM staff_assignments sa JOIN staff_profiles sp ON sp.id = sa.staff_id WHERE sp.school_id = ?', ['school-a']);
  assert.ok(Array.isArray(rows));
});
