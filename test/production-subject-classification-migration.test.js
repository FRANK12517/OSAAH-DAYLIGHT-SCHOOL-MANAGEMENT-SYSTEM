import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../scripts/production-subject-classification-migrate.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-subject-classification-migration-063.yml', import.meta.url), 'utf8');
const migration = await readFile(new URL('../schema/063_subject_classification.sql', import.meta.url));

 test('Migration 063 application wrapper is bound to the reviewed migration identity', () => {
  assert.equal(createHash('sha256').update(migration).digest('hex'), 'd2961b713998d7e8231de3c27c0179a005e8caa4abf79361ad76f92804dc9abb');
  assert.match(script, /const VERSION = 63/);
  assert.match(script, /const NAME = '063_subject_classification\.sql'/);
  assert.match(script, /APPLY_SUBJECT_CLASSIFICATION_063/);
});

test('Migration 063 application is lock-protected and verifies preservation before ledger recording', () => {
  assert.match(script, /createMigrationRunner\(\{ adapter, directory, baselineRequired: true \}\)/);
  assert.match(script, /applyVersions\(\{\s*\n\s*versions: \[VERSION\],\s*\n\s*dryRun: false/);
  assert.match(script, /beforeApply: async \(\)/);
  assert.match(script, /verifyMigration: async \(\{ adapter: transaction \}\)/);
  assert.match(script, /verifyPreservedSubjects\(beforeSchema, afterSchema\)/);
  assert.match(script, /MIGRATION_063_LEDGER_VERIFICATION_FAILED/);
});

test('Migration 063 workflow requires the protected Production environment and exact apply token', () => {
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_SUBJECT_CLASSIFICATION_063/);
  assert.match(workflow, /if: \$\{\{ inputs\.execution_token == 'APPLY_SUBJECT_CLASSIFICATION_063' \}\}/);
  assert.match(workflow, /node scripts\/production-subject-classification-migrate\.mjs dry-run/);
  assert.match(workflow, /node scripts\/production-subject-classification-migrate\.mjs apply/);
});
