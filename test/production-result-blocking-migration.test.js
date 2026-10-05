import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertAcademicRecordCountsPreserved, compareAcademicRecordCounts } from '../scripts/academic-record-count-guard.js';
import { createInMemoryMigrationAdapter, createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

test('migration 064 is additive, scoped, and non-destructive', async () => {
  const sql = await readFile(new URL('../schema/064_academic_result_blocking.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS academic_result_blocks/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS academic_result_unblock_requests/i);
  assert.match(sql, /UNIQUE KEY uq_academic_result_block_scope/i);
  assert.match(sql, /idx_academic_result_block_lookup/i);
  assert.match(sql, /idx_academic_result_unblock_lookup/i);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO|UPDATE\s|INSERT\s+INTO)\b/i);
});

test('academic count guard compares the same tables independent of object key order and permits only empty 064-created tables', () => {
  const result = compareAcademicRecordCounts(
    { academic_years: 1, students: 2, terms: 3 },
    { academic_result_unblock_requests: '0', students: '2', academic_result_blocks: 0, terms: '3', academic_years: '1' },
    { migrationCreatedTables: ['academic_result_blocks', 'academic_result_unblock_requests'] }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.differences, {
    missingProtectedTables: [], unexpectedProtectedTables: [], changedCounts: [], nonEmptyMigrationCreatedTables: [], invalidCounts: []
  });
});

test('academic count guard passes identical snapshots with identical ordering', () => {
  const counts = { academic_years: 1, students: 2, terms: 3 };
  assert.equal(compareAcademicRecordCounts(counts, { ...counts }).ok, true);
});

test('academic count guard reports real count changes by table name', () => {
  const result = compareAcademicRecordCounts({ students: 2 }, { students: '3' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.differences.changedCounts, [{ table: 'students', before: '2', after: '3' }]);
});

test('academic count guard fails when a previously protected table disappears', () => {
  const result = compareAcademicRecordCounts({ students: 2, terms: 3 }, { students: 2 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.differences.missingProtectedTables, ['terms']);
});

test('academic count guard fails on unexpected protected tables and non-empty new migration tables', () => {
  const unexpected = compareAcademicRecordCounts({ students: 2 }, { students: 2, result_archive: 0 }, { migrationCreatedTables: ['academic_result_blocks'] });
  assert.equal(unexpected.ok, false);
  assert.deepEqual(unexpected.differences.unexpectedProtectedTables, ['result_archive']);
  const nonEmpty = compareAcademicRecordCounts({ students: 2 }, { students: 2, academic_result_blocks: '1' }, { migrationCreatedTables: ['academic_result_blocks'] });
  assert.equal(nonEmpty.ok, false);
  assert.deepEqual(nonEmpty.differences.nonEmptyMigrationCreatedTables, [{ table: 'academic_result_blocks', after: '1' }]);
});

test('academic count guard safely normalizes numeric, decimal-string, and large BigInt counts', () => {
  const result = compareAcademicRecordCounts(
    { students: 1, academic_years: '0003', terms: 9007199254740993n },
    { STUDENTS: '01', academic_years: 3, terms: '9007199254740993' }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.before, { academic_years: '3', students: '1', terms: '9007199254740993' });
  const unsafeNumber = compareAcademicRecordCounts({ terms: 9007199254740993 }, { terms: '9007199254740993' });
  assert.equal(unsafeNumber.ok, false);
  assert.deepEqual(unsafeNumber.differences.invalidCounts, [{ snapshot: 'before', table: 'terms', value: 9007199254740992, reason: 'INVALID_COUNT' }]);
});

test('a failed pre-ledger count verification does not record Migration 064 as applied', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'academic-count-guard-'));
  try {
    await writeFile(join(directory, '063_predecessor.sql'), 'SELECT 63;');
    await writeFile(join(directory, '064_result_blocking.sql'), 'CREATE TABLE result_blocking_test (id INT);');
    const migrations = await discoverMigrations(directory);
    const predecessor = migrations.find((migration) => migration.version === 63);
    const storage = {};
    const adapter = createInMemoryMigrationAdapter(storage);
    storage.applied.push({ version: 63, name: predecessor.name, checksum: predecessor.checksum, appliedAt: '2026-10-04T00:00:00.000Z' });
    const runner = createMigrationRunner({ adapter, directory });
    await assert.rejects(() => runner.applyVersions({
      versions: [64],
      requiredAppliedVersions: [63],
      verifyMigration: async () => assertAcademicRecordCountsPreserved({ students: 1 }, { students: 2 })
    }), (error) => error.code === 'MIGRATION_064_ACADEMIC_RECORD_COUNT_CHANGED');
    assert.deepEqual(storage.applied.map((record) => record.version), [63]);
    assert.equal(storage.locked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('protected migration 064 runner requires exact production target, predecessor, and approval token', async () => {
  const script = await readFile(new URL('../scripts/production-result-blocking-migrate.mjs', import.meta.url), 'utf8');
  const countGuard = await readFile(new URL('../scripts/academic-record-count-guard.js', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/production-result-blocking-migration-064.yml', import.meta.url), 'utf8');
  assert.match(script, /const VERSION = 64/);
  assert.match(script, /const NAME = '064_academic_result_blocking\.sql'/);
  assert.match(script, /migration\.checksum/);
  assert.match(script, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(script, /requiredAppliedVersions: \[63\]/);
  assert.match(script, /APPLY_RESULT_BLOCKING_064/);
  assert.match(script, /MIGRATION_064_PREEXISTING_OBJECTS/);
  assert.match(script, /MIGRATION_064_PARTIAL_SCHEMA/);
  assert.match(script, /MIGRATION_064_PREREQUISITE_MISSING/);
  assert.match(script, /assertAcademicRecordCountsPreserved/);
  assert.match(script, /verifyMigration:\s*async \(\{ adapter: tx \}\) => \{[\s\S]*academicRecordCounts\(tx\)[\s\S]*assertAcademicRecordCountsPreserved/);
  assert.doesNotMatch(script, /JSON\.stringify\(beforeAcademicCounts\)/);
  assert.match(script, /status: recorded \? 'ALREADY_APPLIED' : 'PENDING'/);
  assert.match(script, /if \(result\.tables\.includes\(table\)\)/);
  assert.match(countGuard, /MIGRATION_064_ACADEMIC_RECORD_COUNT_CHANGED/);
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
