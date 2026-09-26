import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProductionSchemaMetadata, EXPECTED_DATABASE, RESULT_SUPPORT_TABLES } from '../scripts/production-schema-inventory.mjs';

function fakePool({ database = EXPECTED_DATABASE } = {}) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT DATABASE\(\)/i.test(sql)) return [[{ inspected_database: database }]];
      if (/information_schema\.TABLES/i.test(sql)) return [[{ TABLE_NAME: 'student_attendance', TABLE_TYPE: 'BASE TABLE' }]];
      if (/FROM information_schema\.KEY_COLUMN_USAGE k/i.test(sql)) return [[
        { TABLE_NAME: 'student_attendance', COLUMN_NAME: 'school_id', CONSTRAINT_NAME: 'fk_attendance_school', ORDINAL_POSITION: 1, REFERENCED_TABLE_NAME: 'schools', REFERENCED_COLUMN_NAME: 'id', UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' },
        { TABLE_NAME: 'staff_assignments', COLUMN_NAME: 'staff_id', CONSTRAINT_NAME: 'fk_assignment_staff', ORDINAL_POSITION: 1, REFERENCED_TABLE_NAME: 'staff_profiles', REFERENCED_COLUMN_NAME: 'id', UPDATE_RULE: 'CASCADE', DELETE_RULE: 'RESTRICT' }
      ]];
      if (/information_schema\.COLUMNS/i.test(sql)) return [[{
        TABLE_NAME: 'student_attendance', COLUMN_NAME: 'date', ORDINAL_POSITION: 3, COLUMN_DEFAULT: null,
        IS_NULLABLE: 'NO', DATA_TYPE: 'date', COLUMN_TYPE: 'date', CHARACTER_MAXIMUM_LENGTH: null,
        NUMERIC_PRECISION: null, NUMERIC_SCALE: null, COLUMN_KEY: 'MUL', EXTRA: ''
      }]];
      if (/information_schema\.TABLE_CONSTRAINTS/i.test(sql)) return [[{
        TABLE_NAME: 'student_attendance', CONSTRAINT_NAME: 'PRIMARY', CONSTRAINT_TYPE: 'PRIMARY KEY',
        COLUMN_NAME: 'id', POSITION_IN_CONSTRAINT: 1
      }]];
      if (/information_schema\.STATISTICS/i.test(sql)) return [[{
        TABLE_NAME: 'student_attendance', INDEX_NAME: 'idx_attendance_school_date', NON_UNIQUE: 0,
        SEQ_IN_INDEX: 1, COLUMN_NAME: 'date', INDEX_TYPE: 'BTREE', SUB_PART: null
      }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  return pool;
}

test('production result-support inventory collects only metadata and expands direct foreign-key neighbors', async () => {
  const pool = fakePool();
  const inventory = await collectProductionSchemaMetadata(pool);
  assert.equal(inventory.connectedDatabase, EXPECTED_DATABASE);
  assert.equal(inventory.databaseMatch, true);
  assert.ok(RESULT_SUPPORT_TABLES.every((name) => inventory.metadataTables.includes(name)));
  assert.ok(inventory.metadataTables.includes('schools'));
  assert.ok(inventory.metadataTables.includes('staff_profiles'));
  assert.deepEqual(inventory.columns[0], {
    TABLE_NAME: 'student_attendance', COLUMN_NAME: 'date', ORDINAL_POSITION: 3, COLUMN_DEFAULT: null,
    IS_NULLABLE: 'NO', DATA_TYPE: 'date', COLUMN_TYPE: 'date', CHARACTER_MAXIMUM_LENGTH: null,
    NUMERIC_PRECISION: null, NUMERIC_SCALE: null, COLUMN_KEY: 'MUL', EXTRA: ''
  });
  assert.equal(inventory.constraints[0].CONSTRAINT_TYPE, 'PRIMARY KEY');
  assert.equal(inventory.indexes[0].INDEX_NAME, 'idx_attendance_school_date');
  assert.equal(inventory.foreignKeys[0].REFERENCED_TABLE_NAME, 'schools');
  assert.equal(inventory.foreignKeys[0].DELETE_RULE, 'RESTRICT');
  assert.ok(pool.calls.every(({ sql }) => /^\s*SELECT\b/i.test(sql) && /information_schema|DATABASE\s*\(/i.test(sql)));
  assert.ok(pool.calls.every(({ sql }) => !/;\s*\S/.test(sql)));
  assert.equal(pool.calls.some(({ sql }) => /FROM\s+(?!information_schema\.)[a-z_]+\s/i.test(sql)), false);
});

test('production inventory fails closed on a database identity mismatch before querying table metadata', async () => {
  const pool = fakePool({ database: 'unexpected_database' });
  await assert.rejects(() => collectProductionSchemaMetadata(pool), (error) => error.code === 'DATABASE_NAME_MISMATCH');
  assert.equal(pool.calls.length, 1);
});
