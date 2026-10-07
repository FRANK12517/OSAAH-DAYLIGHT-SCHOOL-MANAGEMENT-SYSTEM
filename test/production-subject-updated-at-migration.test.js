import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Migration 073 only adds nullable subjects.updated_at and does not rewrite stored rows', async () => {
  const sql = await read('../schema/073_subject_updated_at.sql');
  assert.match(sql, /ALTER TABLE subjects\s+ADD COLUMN IF NOT EXISTS updated_at VARCHAR\(50\) NULL DEFAULT NULL/i);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|REPLACE|UPDATE|INSERT|CREATE)\b/i);
});

test('Migration 073 runner is target-bound, checksums the exact file, and scopes execution to version 73', async () => {
  const script = await read('../scripts/production-subject-updated-at-migrate-073.mjs');
  assert.match(script, /const VERSION = 73/);
  assert.match(script, /const NAME = '073_subject_updated_at\.sql'/);
  assert.match(script, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(script, /APPLY_SUBJECT_UPDATED_AT_073/);
  assert.match(script, /BACKUP_CONFIRMED/);
  assert.match(script, /REQUIRED_MIGRATIONS = \[63, 65, 66\]/);
  assert.match(script, /versions: \[VERSION\]/);
  assert.match(script, /requiredAppliedVersions: REQUIRED_MIGRATIONS/);
  assert.match(script, /MIGRATION_073_PREEXISTING_COLUMN/);
  assert.match(script, /MIGRATION_073_LEDGER_SCHEMA_MISMATCH/);
  assert.match(script, /pendingMigrationsOutsideScope/);
  assert.match(script, /information_schema\.COLUMNS/);
  assert.match(script, /MIGRATION_073_ONLY/);
  assert.doesNotMatch(script, /runner\.apply\(\)|npm run migration:apply/i);
});

test('Migration 073 workflow is protected, defaults to read-only, and never applies unrelated migrations', async () => {
  const workflow = await read('../.github/workflows/production-subject-updated-at-migration-073.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/i);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /default: DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_SUBJECT_UPDATED_AT_073/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /production-subject-updated-at-migrate-073\.mjs dry-run/);
  assert.match(workflow, /production-subject-updated-at-migrate-073\.mjs apply/);
  assert.doesNotMatch(workflow, /npm run migration:apply/i);
});
