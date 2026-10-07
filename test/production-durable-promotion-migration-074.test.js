import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverMigrations, createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';

const migration = await readFile(new URL('../schema/074_durable_promotion_rollover.sql', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-durable-promotion-migration-074.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-durable-promotion-migrate-074.mjs', import.meta.url), 'utf8');

test('Migration 074 is the unique additive migration version and retains the legacy student FK contract', async () => {
  const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
  assert.equal(migrations.find((item) => item.version === 74)?.name, '074_durable_promotion_rollover.sql');
  assert.equal(migrations.at(-1)?.version, 74);
  for (const column of ['class_id', 'term_id', 'to_class_id', 'next_academic_year_id', 'next_term_id', 'completion_year', 'source_enrollment_id', 'idempotency_key']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, 'i'));
  }
  assert.match(migration, /uq_promotion_decision_idempotency[\s\S]*ON promotion_decisions \(school_id, idempotency_key\)/i);
  assert.match(migration, /idx_promotion_decision_context[\s\S]*ON promotion_decisions \(school_id, academic_year_id, class_id, term_id\)/i);
  assert.doesNotMatch(migration, /\b(DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|RENAME TABLE)\b/i);
  assert.match(script, /student_id[\s\S]*student_profiles[\s\S]*student_id foreign key/i);
});

test('Migration 074 dry-run and apply use an explicit single-version allowlist', async () => {
  const directory = new URL('../schema/', import.meta.url);
  const migrations = await discoverMigrations(directory);
  const target = migrations.find((item) => item.version === 74);
  const storage = { applied: [{ version: 73, name: '073_subject_updated_at.sql', checksum: migrations.find((item) => item.version === 73).checksum }] };
  const adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory });
  const dryRun = await runner.applyVersions({ versions: [74], requiredAppliedVersions: [73], dryRun: true });
  assert.deepEqual(dryRun.pending.map(({ version }) => version), [74]);
  assert.deepEqual(storage.statements, []);
  const applied = await runner.applyVersions({ versions: [74], requiredAppliedVersions: [73] });
  assert.deepEqual(applied.applied.map(({ version }) => version), [74]);
  assert.equal(storage.applied.find(({ version }) => version === 74).checksum, target.checksum);
  assert.deepEqual(storage.statements, [target.sql]);
  const missingPredecessorRunner = createMigrationRunner({ adapter: createInMemoryMigrationAdapter(), directory });
  await assert.rejects(() => missingPredecessorRunner.applyVersions({ versions: [74], requiredAppliedVersions: [73], dryRun: true }), /predecessor/i);
});

test('Migration 074 production workflow is manual, protected, SHA-scoped, backup-gated and never applies all pending migrations', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /release_ref/);
  assert.match(workflow, /RELEASE_REF.*0-9a-f.*40/);
  assert.match(workflow, /git merge-base --is-ancestor origin\/main "\$RELEASE_REF"/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_DURABLE_PROMOTION_074/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /production-durable-promotion-migrate-074\.mjs dry-run/);
  assert.match(workflow, /production-durable-promotion-migrate-074\.mjs apply/);
  assert.doesNotMatch(workflow, /npm run migration:apply|scripts\/migrate\.mjs apply/);
  assert.match(script, /versions: \[VERSION\]/);
  assert.match(script, /pendingMigrationsOutsideScope/);
  assert.match(script, /BACKUP_CONFIRMATION_REQUIRED/);
  assert.match(script, /uq_promotion_decision_idempotency/);
});
