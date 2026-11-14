import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInMemoryMigrationAdapter } from '../src/platform/migration-runner.js';
import { runGlobalStudentIdUniqueMigration085 } from '../scripts/production-global-student-id-unique-migrate-085.mjs';

const sql = await readFile(new URL('../schema/085_global_student_id_unique.sql', import.meta.url), 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');

function fixture({ duplicates = 0, hasIndex = false } = {}) {
  const storage = { applied: [], baselines: [{ id: 'baseline-085', canonicalDatabase: 'osaahdaylightschool', repositoryCommit: 'a'.repeat(40), schemaFingerprint: 'b'.repeat(64), workflowProvenance: 'test', reconciliationMigration: '049_production_schema_reconciliation.sql', baselineType: 'HISTORICAL_BASELINE', historicalMigrationsExecuted: 0 }], dialect: 'tidb' };
  const memory = createInMemoryMigrationAdapter(storage);
  const adapter = {
    ...memory,
    dialect: 'tidb',
    async query(statement) {
      if (statement.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
      if (statement.includes('information_schema.TABLES')) return [{ tableName: 'students' }, { tableName: 'schema_migrations' }];
      if (statement.includes('information_schema.COLUMNS')) return [{ columnName: 'permanent_student_id' }];
      if (statement.includes('duplicateGroupCount')) return [{ duplicateGroupCount: duplicates }];
      if (statement.includes('information_schema.STATISTICS')) return hasIndex ? [{ indexName: 'uq_students_permanent_student_id_global', nonUnique: 0, columnName: 'permanent_student_id', sequence: 1 }] : [];
      if (statement.includes('WHERE version=?')) return storage.applied.filter((row) => row.version === 85);
      throw new Error(`Unexpected fixture query: ${statement}`);
    },
    async close() {}
  };
  return { adapter, storage };
}

test('Migration 085 is an additive, globally unique student ID index migration', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_students_permanent_student_id_global\s+ON students \(permanent_student_id\)/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i);
});

test('Migration 085 dry-run verifies the target, schema, duplicates and plans only version 85', async () => {
  const { adapter } = fixture();
  const result = await runGlobalStudentIdUniqueMigration085({ adapter, mode: 'dry-run' });
  assert.equal(result.ok, true);
  assert.equal(result.productionWrites, 'NONE');
  assert.deepEqual(result.plan.pending.map((item) => item.version), [85]);
  assert.equal(result.preflight.duplicateGroupCount, 0);
});

test('Migration 085 blocks existing duplicate IDs without writing', async () => {
  const { adapter, storage } = fixture({ duplicates: 2 });
  await assert.rejects(() => runGlobalStudentIdUniqueMigration085({ adapter }), (error) => error.code === 'MIGRATION_085_DUPLICATE_IDS' && error.details.duplicateGroupCount === 2);
  assert.equal(storage.statements.length, 0);
});

test('Migration 085 fails closed if its ledger entry exists but the unique index is absent', async () => {
  const { adapter, storage } = fixture();
  storage.applied.push({ version: 85, name: '085_global_student_id_unique.sql', checksum, appliedAt: '2026-11-14T00:00:00.000Z' });
  await assert.rejects(() => runGlobalStudentIdUniqueMigration085({ adapter }), (error) => error.code === 'MIGRATION_085_LEDGER_SCHEMA_MISMATCH');
});

test('Migration 085 apply requires an exact token and recent backup confirmation', async () => {
  const { adapter } = fixture();
  await assert.rejects(() => runGlobalStudentIdUniqueMigration085({ adapter, mode: 'apply' }), /Explicit Migration 085 apply authorization/);
  await assert.rejects(() => runGlobalStudentIdUniqueMigration085({ adapter, mode: 'apply', executionToken: 'APPLY_GLOBAL_STUDENT_ID_UNIQUE_085' }), /backup confirmation/);
});

test('Migration 085 production workflow is exact-main, protected, duplicate-gated and scoped to 085', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-global-student-id-unique-migration-085.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /node scripts\/verify-migration-085-release\.mjs/);
  assert.match(workflow, /APPLY_GLOBAL_STUDENT_ID_UNIQUE_085/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /production-global-student-id-unique-migrate-085\.mjs dry-run/);
  assert.match(workflow, /production-global-student-id-unique-migrate-085\.mjs apply/);
  assert.equal(checksum.length, 64);
});
