import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { splitMigrationSql } from '../src/ai/tidb-database-adapter.js';
import { assert075SafeState, migration075SchemaExpectations } from '../src/platform/academic-result-blocking-075-schema.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const baseSnapshot = () => {
  const { tables, baseColumns, oldIndexes } = migration075SchemaExpectations;
  let ordinalPosition = 0;
  const columns = Object.entries(baseColumns).flatMap(([tableName, names]) => names.map((columnName) => ({
    tableName, columnName, columnType: columnName === 'id' ? 'varchar(64)' : 'varchar(128)',
    nullable: columnName === 'unblocked_by' || columnName === 'unblocked_at' || columnName === 'decided_by' || columnName === 'decided_at' ? 'YES' : 'NO',
    defaultValue: null, ordinalPosition: ++ordinalPosition
  })));
  const indexes = oldIndexes.flatMap((index) => index.columns.map((columnName, position) => ({
    tableName: index.table, indexName: index.name, nonUnique: index.unique ? 0 : 1,
    columnName, seqInIndex: position + 1
  })));
  for (const tableName of tables) {
    indexes.push({ tableName, indexName: 'PRIMARY', nonUnique: 0, columnName: 'id', seqInIndex: 1 });
  }
  return { tables: [...tables], columns, indexes };
};

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

test('migration 075 isolates terminal and Mock blocks without deleting data', async () => {
  const sql = await readFile(new URL('../schema/075_result_blocking_examination_scope.sql', import.meta.url), 'utf8');
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  assert.equal(migrations.find((item) => item.version === 75)?.name, '075_result_blocking_examination_scope.sql');
  assert.match(sql, /result_type/i);
  assert.match(sql, /mock_examination/i);
  assert.match(sql, /uq_academic_result_block_examination_scope/i);
  assert.doesNotMatch(sql, /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i);
});

test('migration 075 adds result_type before mock_examination in separate ALTER statements', async () => {
  const sql = await readFile(new URL('../schema/075_result_blocking_examination_scope.sql', import.meta.url), 'utf8');
  const statements = splitMigrationSql(sql);
  const columnAdds = statements.filter((statement) => /ADD COLUMN IF NOT EXISTS/i.test(statement));
  assert.equal(columnAdds.length, 4);
  for (const table of ['academic_result_blocks', 'academic_result_unblock_requests']) {
    const resultType = columnAdds.find((statement) => new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS result_type`, 'i').test(statement));
    const mockExam = columnAdds.find((statement) => new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS mock_examination`, 'i').test(statement));
    assert.ok(resultType, `${table} adds result_type`);
    assert.ok(mockExam, `${table} adds mock_examination`);
    assert.doesNotMatch(resultType, /mock_examination/i);
    assert.doesNotMatch(mockExam, /ADD COLUMN IF NOT EXISTS result_type/i);
    assert.match(mockExam, /AFTER result_type/i);
  }
});

test('Migration 075 preflight accepts only clean 064 state and rejects partial/unrecorded postconditions', () => {
  const clean = baseSnapshot();
  assert.equal(assert075SafeState(clean, []), 'UNAPPLIED');

  const partial = structuredClone(clean);
  partial.columns.push({ tableName: 'academic_result_blocks', columnName: 'result_type', columnType: "enum('TERMINAL','MOCK')", nullable: 'NO', defaultValue: 'TERMINAL', ordinalPosition: 5 });
  assert.throws(() => assert075SafeState(partial, []), { code: 'MIGRATION_075_PARTIAL_SCHEMA' });

  const missingBaseIndex = structuredClone(clean);
  missingBaseIndex.indexes = missingBaseIndex.indexes.filter((row) => row.indexName !== 'idx_academic_result_block_lookup');
  assert.throws(() => assert075SafeState(missingBaseIndex, []), { code: 'MIGRATION_075_BASE_SCHEMA_MISMATCH' });
});

test('Migration 075 refuses to fabricate history when every new schema object exists without a ledger row', () => {
  const snapshot = baseSnapshot();
  const { newColumns, newIndexes } = migration075SchemaExpectations;
  let nextPosition = 100;
  for (const column of newColumns) {
    const prior = snapshot.columns.find((row) => row.tableName === column.table && row.columnName === column.after);
    const ordinalPosition = Number(prior.ordinalPosition) + 1;
    snapshot.columns.push({
      tableName: column.table, columnName: column.name, columnType: column.type,
      nullable: column.nullable, defaultValue: column.defaultValue, ordinalPosition: ordinalPosition || nextPosition++
    });
  }
  snapshot.indexes = snapshot.indexes.filter((row) => row.indexName !== 'uq_academic_result_block_scope');
  for (const index of newIndexes) {
    snapshot.indexes.push(...index.columns.map((columnName, position) => ({
      tableName: index.table, indexName: index.name, nonUnique: index.unique ? 0 : 1,
      columnName, seqInIndex: position + 1
    })));
  }
  assert.throws(() => assert075SafeState(snapshot, []), { code: 'MIGRATION_075_SCHEMA_APPLIED_UNRECORDED' });
});

test('Migration 075 is protected by an exact release and backup-gated workflow', async () => {
  assert.throws(() => assertProductionAcademicMigrationAllowed({ version: 75, name: '075_result_blocking_examination_scope.sql' }), { code: 'RESULT_BLOCKING_MIGRATION_REQUIRES_PROTECTED_RELEASE' });
  const workflow = await readFile(new URL('../.github/workflows/production-result-blocking-migration-075.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/production-result-blocking-migrate-075.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /APPLY_RESULT_BLOCKING_075/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /production-result-blocking-migrate-075\.mjs/);
  assert.match(script, /requiredAppliedVersions: \[74\]/);
  assert.match(script, /read075SchemaSnapshot/);
  assert.match(script, /assert075Postconditions/);
  assert.match(script, /assert075SafeState/);
  assert.match(script, /productionWrites: 'NONE'/);
});
