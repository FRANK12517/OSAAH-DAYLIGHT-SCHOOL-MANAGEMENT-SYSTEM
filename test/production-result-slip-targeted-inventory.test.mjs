import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReadOnlyMetadataQuery,
  collectTargetedProductionMetadata,
  TARGET_TABLES,
  TARGET_VIEWS
} from '../scripts/production-result-slip-targeted-inventory.mjs';

function createPool(database = 'osaahdaylightschool') {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT DATABASE()')) return [[{ inspected_database: database }], []];
      if (sql.includes('information_schema.TABLES')) {
        return [[{ TABLE_NAME: 'student_profiles', TABLE_TYPE: 'BASE TABLE' },
          { TABLE_NAME: 'vw_fee_overview', TABLE_TYPE: 'VIEW' }], []];
      }
      if (sql.includes('information_schema.COLUMNS')) {
        return [[{ TABLE_NAME: 'student_profiles', COLUMN_NAME: 'student_id', COLUMN_TYPE: 'varchar(191)' }], []];
      }
      if (sql.includes('information_schema.STATISTICS')) return [[{ TABLE_NAME: 'student_profiles', INDEX_NAME: 'idx_school_student', NON_UNIQUE: 1, SEQ_IN_INDEX: 1, COLUMN_NAME: 'school_id' }], []];
      if (sql.includes('information_schema.TABLE_CONSTRAINTS')) return [[{ TABLE_NAME: 'student_profiles', CONSTRAINT_NAME: 'PRIMARY', CONSTRAINT_TYPE: 'PRIMARY KEY' }], []];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[{ TABLE_NAME: 'student_profiles', COLUMN_NAME: 'school_id', CONSTRAINT_NAME: 'fk_profile_school', ORDINAL_POSITION: 1, REFERENCED_TABLE_NAME: 'schools', REFERENCED_COLUMN_NAME: 'id' }], []];
      if (sql.includes('information_schema.VIEWS')) return [[{ TABLE_NAME: 'vw_fee_overview', VIEW_DEFINITION: 'SELECT 1' }], []];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('inventory queries only targeted information_schema metadata after DB guard', async () => {
  const pool = createPool();
  const result = await collectTargetedProductionMetadata(pool);

  assert.equal(result.ok, true);
  assert.equal(result.connectedDatabase, 'osaahdaylightschool');
  assert.equal(result.queriedRowData, false);
  assert.deepEqual(result.absentTargetObjects.includes('student_profiles'), false);
  assert.deepEqual(result.absentTargetObjects.includes('vw_invoice_receipt_register'), true);
  assert.equal(pool.calls.length, 7);
  for (const { sql } of pool.calls) assertReadOnlyMetadataQuery(sql);
  for (const { params } of pool.calls.slice(1, 6)) {
    assert.deepEqual(params, TARGET_TABLES.concat(TARGET_VIEWS));
  }
  assert.deepEqual(pool.calls.at(-1).params, TARGET_VIEWS);
  assert.ok(pool.calls.some(({ sql }) => sql.includes('VIEW_DEFINITION')));
  assert.ok(pool.calls.some(({ sql }) => sql.includes('REFERENCED_TABLE_NAME')));
});

test('inventory stops before metadata reads when database guard does not match', async () => {
  const pool = createPool('wrong_database');

  await assert.rejects(
    collectTargetedProductionMetadata(pool),
    (error) => error.code === 'DATABASE_NAME_MISMATCH'
  );
  assert.equal(pool.calls.length, 1);
});

test('query guard rejects writes, non-metadata reads, and multiple statements', () => {
  assert.throws(() => assertReadOnlyMetadataQuery('UPDATE schema_migrations SET version=1'));
  assert.throws(() => assertReadOnlyMetadataQuery('SELECT * FROM students'));
  assert.throws(() => assertReadOnlyMetadataQuery('SELECT DATABASE(); DELETE FROM students'));
  assert.doesNotThrow(() => assertReadOnlyMetadataQuery('SELECT DATABASE() AS inspected_database'));
});

test('scope includes every directly relevant 049/054 table and six 049 views', () => {
  for (const name of [
    'student_fee_payments', 'student_profiles', 'student_enrollments', 'students',
    'class_subjects', 'subject_class_assignments', 'parent_student_links',
    'staff_attendance', 'fee_structures'
  ]) assert.ok(TARGET_TABLES.includes(name), `${name} should be in the bounded inventory`);
  assert.equal(TARGET_VIEWS.length, 6);
  assert.ok(TARGET_VIEWS.includes('vw_invoice_receipt_register'));
  assert.ok(TARGET_VIEWS.includes('vw_fee_collection_summary'));
});

