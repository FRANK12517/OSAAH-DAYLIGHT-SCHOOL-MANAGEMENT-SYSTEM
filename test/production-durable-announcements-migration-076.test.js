import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverMigrations, createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';

const migration = await readFile(new URL('../schema/076_durable_announcements.sql', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-durable-announcements-migrate-076.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-durable-announcements-migration-076.yml', import.meta.url), 'utf8');

test('Migration 076 is uniquely numbered, additive, and protects existing data', async () => {
  const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
  const target = migrations.find((item) => item.version === 76);
  assert.equal(target?.name, '076_durable_announcements.sql');
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
  assert.doesNotMatch(migration, /\b(DROP\s+(TABLE|COLUMN|DATABASE)|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO|RENAME\s+TABLE)\b/i);
  assert.match(migration, /priority\s+VARCHAR\(32\)\s+NOT NULL DEFAULT 'NORMAL'/i);
  assert.match(migration, /status\s+VARCHAR\(32\)\s+NOT NULL DEFAULT 'DRAFT'/i);
  assert.doesNotMatch(migration, /(?:TEXT|BLOB|JSON)\s+NOT NULL\s+DEFAULT/i);
  assert.doesNotMatch(migration, /TEXT\s+PRIMARY KEY/i);
  assert.doesNotMatch(migration, /scheduled_for\s+TEXT/i);
  for (const table of ['announcement_records', 'announcement_recipients', 'announcement_reads']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  for (const index of ['idx_announcement_recipient', 'idx_announcement_due', 'idx_announcement_reads']) assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`, 'i'));
});

test('Migration 076 runner scope requires migration 075 and is idempotent', async () => {
  const directory = new URL('../schema/', import.meta.url); const migrations = await discoverMigrations(directory); const target = migrations.find((item) => item.version === 76);
  const storage = { applied: [{ version: 75, name: '075_result_blocking_examination_scope.sql', checksum: migrations.find((item) => item.version === 75).checksum }] };
  const adapter = createInMemoryMigrationAdapter(storage); const runner = createMigrationRunner({ adapter, directory });
  const dryRun = await runner.applyVersions({ versions: [76], requiredAppliedVersions: [75], dryRun: true });
  assert.deepEqual(dryRun.pending.map(({ version }) => version), [76]); assert.deepEqual(storage.statements, []);
  const applied = await runner.applyVersions({ versions: [76], requiredAppliedVersions: [75] });
  assert.deepEqual(applied.applied.map(({ version }) => version), [76]); assert.equal(storage.applied.at(-1).checksum, target.checksum);
  const repeat = await runner.applyVersions({ versions: [76], requiredAppliedVersions: [75] }); assert.deepEqual(repeat.applied, []);
  await assert.rejects(() => createMigrationRunner({ adapter: createInMemoryMigrationAdapter(), directory }).applyVersions({ versions: [76], requiredAppliedVersions: [75], dryRun: true }), /predecessor/i);
});

test('Migration 076 production workflow is manual, SHA-scoped, backup-gated, and never applies all pending migrations', () => {
  assert.match(workflow, /workflow_dispatch/); assert.match(workflow, /environment: production/); assert.match(workflow, /release_ref/); assert.match(workflow, /RELEASE_REF.*0-9a-f.*40/); assert.match(workflow, /git merge-base --is-ancestor origin\/main/); assert.match(workflow, /DRY_RUN_ONLY/); assert.match(workflow, /APPLY_DURABLE_ANNOUNCEMENTS_076/); assert.match(workflow, /BACKUP_CONFIRMED/); assert.match(workflow, /production-durable-announcements-migrate-076\.mjs dry-run/); assert.match(workflow, /production-durable-announcements-migrate-076\.mjs apply/); assert.doesNotMatch(workflow, /scripts\/migrate\.mjs apply/); assert.match(script, /versions: \[VERSION\]/); assert.match(script, /requiredAppliedVersions: \[75\]/); assert.match(script, /information_schema/); assert.match(script, /schema_migrations/);
});
