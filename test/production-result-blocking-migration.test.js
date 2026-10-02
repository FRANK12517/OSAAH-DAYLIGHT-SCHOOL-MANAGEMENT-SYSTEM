import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migration 064 is additive, scoped, and non-destructive', async () => {
  const sql = await readFile(new URL('../schema/064_academic_result_blocking.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS academic_result_blocks/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS academic_result_unblock_requests/i);
  assert.match(sql, /UNIQUE KEY uq_academic_result_block_scope/i);
  assert.match(sql, /idx_academic_result_block_lookup/i);
  assert.match(sql, /idx_academic_result_unblock_lookup/i);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO|UPDATE\s|INSERT\s+INTO)\b/i);
});

test('protected migration 064 runner requires exact production target, predecessor, and approval token', async () => {
  const script = await readFile(new URL('../scripts/production-result-blocking-migrate.mjs', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/production-result-blocking-migration-064.yml', import.meta.url), 'utf8');
  assert.match(script, /const VERSION = 64/);
  assert.match(script, /const NAME = '064_academic_result_blocking\.sql'/);
  assert.match(script, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(script, /requiredAppliedVersions: \[63\]/);
  assert.match(script, /APPLY_RESULT_BLOCKING_064/);
  assert.match(script, /MIGRATION_064_PREEXISTING_OBJECTS/);
  assert.match(script, /MIGRATION_064_ACADEMIC_RECORD_COUNT_CHANGED/);
  assert.match(script, /information_schema\.STATISTICS/);
  assert.doesNotMatch(script, /migrationRunner\.apply\(|npm run migration:apply/i);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /secrets\.DATABASE_URL/);
  assert.match(workflow, /production-result-blocking-migrate\.mjs dry-run/);
  assert.match(workflow, /production-result-blocking-migrate\.mjs apply/);
  assert.match(workflow, /APPLY_RESULT_BLOCKING_064/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.doesNotMatch(workflow, /npm run migration:apply/);
});
