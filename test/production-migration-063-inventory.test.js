import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  MIGRATION_063,
  assertReadOnlyQuery,
  collectMigration063Inventory
} from '../scripts/production-migration-063-inventory.mjs';

test('Migration 063 checksum matches the immutable repository SQL', async () => {
  const sql = await readFile(new URL('../schema/063_subject_classification.sql', import.meta.url));
  const checksum = createHash('sha256').update(sql).digest('hex');
  assert.equal(checksum, MIGRATION_063.checksum);
});

test('Migration 063 inventory rejects non-read-only or multi-statement SQL', () => {
  assert.throws(() => assertReadOnlyQuery('ALTER TABLE subjects ADD COLUMN x INT'));
  assert.throws(() => assertReadOnlyQuery('SELECT 1; UPDATE subjects SET is_scoring = 1'));
  assert.doesNotThrow(() => assertReadOnlyQuery('SELECT DATABASE() AS database_name'));
});

test('Migration 063 inventory is target-bound and reports subject and dependency state', async () => {
  const statements = [];
  const pool = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('SELECT DATABASE()')) return [[{ database_name: 'osaahdaylightschool' }]];
      if (sql.includes('information_schema.TABLES')) return [[
        { table_name: 'schema_migrations', table_type: 'BASE TABLE' },
        { table_name: 'schema_baselines', table_type: 'BASE TABLE' },
        { table_name: 'subjects', table_type: 'BASE TABLE' },
        { table_name: 'class_subjects', table_type: 'BASE TABLE' },
        { table_name: 'result_signatures', table_type: 'BASE TABLE' }
      ]];
      if (sql.includes('information_schema.COLUMNS')) return [[
        { table_name: 'subjects', column_name: 'subject_type', column_type: 'varchar(32)', is_nullable: 'NO', column_default: 'ELECTIVE', column_key: '', ordinal_position: 1 },
        { table_name: 'subjects', column_name: 'is_scoring', column_type: 'tinyint', is_nullable: 'NO', column_default: '1', column_key: '', ordinal_position: 2 }
      ]];
      if (sql.includes('information_schema.STATISTICS')) return [[]];
      if (sql.includes('GROUP BY subject_type')) return [[{ subject_type: 'ELECTIVE', is_scoring: 1, row_count: 8 }]];
      if (sql.includes('COUNT(*) AS row_count FROM subjects')) return [[{ row_count: 8 }]];
      if (sql.includes('COUNT(*) AS row_count FROM `')) return [[{ row_count: 0 }]];
      if (sql.includes('FROM schema_migrations')) return [[{ version: 63, name: '063_subject_classification.sql', checksum: MIGRATION_063.checksum, applied_at: '2026-10-03' }]];
      if (sql.includes('FROM schema_baselines')) return [[{ id: 'baseline-1' }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const result = await collectMigration063Inventory(pool);
  assert.equal(result.connectedDatabase, 'osaahdaylightschool');
  assert.equal(result.productionWrites, 'NONE');
  assert.equal(result.subjectCount, 8);
  assert.deepEqual(result.migrationRows[0].version, 63);
  assert.equal(result.dependentCounts.academic_score_records, null);
  assert.equal(result.dependentCounts.class_subjects, 0);
  assert.ok(statements.every((sql) => /^\s*SELECT\b/i.test(sql)));
});
