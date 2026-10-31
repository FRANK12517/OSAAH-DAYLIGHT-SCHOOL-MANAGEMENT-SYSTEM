import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';

async function migrationDirectory(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'osaah-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(resolve(directory, '001_add.sql'), 'CREATE TABLE x (id INT);');
  return directory;
}

test('TiDB migration failure preserves applied DDL effects and blocks automatic retry', async (t) => {
  const directory = await migrationDirectory(t);
  const storage = { dialect: 'tidb' }, adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory });
  await assert.rejects(() => runner.apply({ verifyMigration: async ({ statement }) => { if (statement.includes('CREATE TABLE')) throw new Error('Injected postcondition failure.'); } }), /failed safely/i);
  assert.deepEqual(storage.statements, ['CREATE TABLE x (id INT)']);
  assert.equal(storage.runs[0].state, 'FAILED');
  await assert.rejects(() => runner.status(), (error) => error.code === 'MIGRATION_RECOVERY_REQUIRED');
});

test('TiDB migration records checksums and completion state separately from application ledger', async (t) => {
  const directory = await migrationDirectory(t);
  const storage = { dialect: 'tidb', runsTableCreated: true, seedTables: true }, adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory });
  const result = await runner.apply({ verifyMigration: async () => {} });
  assert.equal(result.applied.length, 1);
  assert.equal(storage.applied[0].checksum, storage.runs[0].checksum);
  assert.equal(storage.runs[0].state, 'COMPLETED');
  assert.equal((await runner.status()).pending.length, 0);
});

test('TiDB migration lock prevents a concurrent runner', async (t) => {
  const directory = await migrationDirectory(t);
  const storage = { dialect: 'tidb', locked: true }, adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory });
  await assert.rejects(() => runner.apply(), (error) => error.code === 'MIGRATION_LOCKED');
  assert.deepEqual(storage.statements, []);
});

test('TiDB migration run checksum inconsistency is detected', async (t) => {
  const directory = await migrationDirectory(t);
  const storage = { dialect: 'tidb', runsTableCreated: true }, adapter = createInMemoryMigrationAdapter(storage);
  storage.applied.push({ version:1,name:'001_add.sql',checksum:'applied',appliedAt:'now' });
  storage.runs.push({ version:1,name:'001_add.sql',checksum:'different',state:'COMPLETED' });
  const runner = createMigrationRunner({ adapter, directory });
  await assert.rejects(() => runner.status(), (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH');
});

test('completed TiDB migration without its applied ledger requires manual recovery', async (t) => {
  const directory = await migrationDirectory(t);
  const storage = { dialect: 'tidb', runsTableCreated: true, runs: [{ version: 1, name: '001_add.sql', checksum: 'known-checksum', state: 'COMPLETED' }] };
  const runner = createMigrationRunner({ adapter: createInMemoryMigrationAdapter(storage), directory });
  await assert.rejects(() => runner.status(), (error) => error.code === 'MIGRATION_RECOVERY_REQUIRED');
});

test('TiDB failure recording changes only the specified migration run', async () => {
  const storage = { dialect: 'tidb', runs: [
    { version: 1, name: '001_add.sql', state: 'RUNNING' },
    { version: 2, name: '002_next.sql', state: 'RUNNING' }
  ] };
  const adapter = createInMemoryMigrationAdapter(storage);
  await adapter.failActiveMigration({ version: 1, failedAt: 'now', errorCode: 'DDL_FAILED' });
  assert.equal(storage.runs[0].state, 'FAILED');
  assert.equal(storage.runs[1].state, 'RUNNING');
});
