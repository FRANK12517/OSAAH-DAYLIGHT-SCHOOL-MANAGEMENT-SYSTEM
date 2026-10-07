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
  assert.match(script, /MIGRATION_064_PARTIAL_SCHEMA/);
  assert.match(script, /MIGRATION_064_PREREQUISITE_MISSING/);
  assert.match(script, /status: recorded \? 'ALREADY_APPLIED' : 'PENDING'/);
  assert.match(script, /if \(result\.tables\.includes\(table\)\)/);
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

import { discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';
test('migration 075 isolates terminal and Mock blocks without deleting data', async () => {
  const sql = await readFile(new URL('../schema/075_result_blocking_examination_scope.sql', import.meta.url), 'utf8');
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  assert.equal(migrations.find((item) => item.version === 75)?.name, '075_result_blocking_examination_scope.sql');
  assert.match(sql, /result_type/i); assert.match(sql, /mock_examination/i); assert.match(sql, /uq_academic_result_block_examination_scope/i);
  assert.doesNotMatch(sql, /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i);
});
test('migration 075 is protected by an exact release and backup-gated workflow', async () => {
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 75, name: '075_result_blocking_examination_scope.sql' }), { code: 'RESULT_BLOCKING_MIGRATION_REQUIRES_PROTECTED_RELEASE' });
  const workflow = await readFile(new URL('../.github/workflows/production-result-blocking-migration-075.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/production-result-blocking-migrate-075.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /APPLY_RESULT_BLOCKING_075/); assert.match(workflow, /BACKUP_CONFIRMED/); assert.match(workflow, /production-result-blocking-migrate-075\.mjs/);
  assert.match(script, /applyVersions/); assert.match(script, /requiredAppliedVersions: \[74\]/);
});
