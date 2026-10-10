import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { createInMemoryMigrationAdapter, discoverMigrations } from '../src/platform/migration-runner.js';
import { runProductionEnrollmentIsCurrentMigration080 } from '../scripts/production-enrollment-is-current-migrate-080.mjs';

const directory = resolve('schema');
const sql = await readFile(resolve(directory, '080_restore_student_enrollment_is_current.sql'), 'utf8');
const workflow = await readFile(resolve('.github/workflows/production-enrollment-is-current-migration-080.yml'), 'utf8');

async function fixture({ hasColumn = false, count = 17 } = {}) {
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === 80);
  const storage = {
    applied: migrations.filter((item) => item.version <= 79 && item.version !== 78).map((item) => ({ version: item.version, name: item.name, checksum: item.checksum, appliedAt: '2026-10-10T00:00:00.000Z' })),
    baselines: [], statements: [], locked: false
  };
  let currentColumn = hasColumn ? { columnName: 'is_current', columnType: 'tinyint(1)', isNullable: 'NO', columnDefault: '1' } : null;
  const memory = createInMemoryMigrationAdapter(storage);
  const adapter = {
    ...memory,
    async query(statement) {
      if (statement.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
      if (statement.includes('information_schema.TABLES')) return [{ tableName: 'student_enrollments' }];
      if (statement.includes('information_schema.COLUMNS')) return currentColumn ? [currentColumn] : [];
      if (statement === 'SELECT COUNT(*) AS rowCount FROM student_enrollments') return [{ rowCount: count }];
      if (statement.includes('SELECT version,name,checksum')) return storage.applied.filter((record) => record.version === 80).map((record) => ({ ...record }));
      throw new Error(`Unexpected fixture query: ${statement}`);
    },
    async executeMigrationSql(statement) {
      storage.statements.push(statement);
      if (/ALTER TABLE student_enrollments[\s\S]*ADD COLUMN IF NOT EXISTS is_current/i.test(statement)) currentColumn = { columnName: 'is_current', columnType: 'tinyint(1)', isNullable: 'NO', columnDefault: '1' };
    },
    async close() {}
  };
  return { adapter, storage, migration };
}

test('Migration 080 restores the exact additive TiDB-compatible column contract from 038/054', async () => {
  const [migration038, migration054] = await Promise.all([
    readFile(resolve(directory, '038_canonical_class_database_fee_hub.sql'), 'utf8'),
    readFile(resolve(directory, '054_durable_score_entry_academic_contract.sql'), 'utf8')
  ]);
  assert.match(migration038, /ADD COLUMN IF NOT EXISTS is_current TINYINT\(1\) NOT NULL DEFAULT 1/i);
  assert.match(migration054, /ADD COLUMN IF NOT EXISTS is_current TINYINT\(1\) NOT NULL DEFAULT 1/i);
  assert.match(sql.replace(/^\s*--.*$/gm, '').trim(), /^ALTER TABLE student_enrollments\s+ADD COLUMN IF NOT EXISTS is_current TINYINT\(1\) NOT NULL DEFAULT 1;$/i);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|REPLACE|UPDATE)\b/i);
  const migrations = await discoverMigrations(directory);
  assert.deepEqual(migrations.slice(-2).map(({ version, name }) => ({ version, name })), [
    { version: 79, name: '079_attendance_legacy_schema_compatibility.sql' },
    { version: 80, name: '080_restore_student_enrollment_is_current.sql' }
  ]);
});

test('Migration 080 dry-run is read-only and plans only version 080 after recorded 079', async () => {
  const { adapter, storage } = await fixture();
  const result = await runProductionEnrollmentIsCurrentMigration080({ adapter, mode: 'dry-run', baselineRequired: false });
  assert.equal(result.ok, true);
  assert.equal(result.productionWrites, 'NONE');
  assert.deepEqual(result.plan.pending.map((item) => item.version), [80]);
  assert.equal(storage.statements.length, 0);
  assert.equal(storage.applied.some((item) => item.version === 80), false);
});

test('Migration 080 apply requires both exact authorization and backup confirmation', async () => {
  const { adapter } = await fixture();
  await assert.rejects(() => runProductionEnrollmentIsCurrentMigration080({ adapter, mode: 'apply', executionToken: 'wrong', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false }), /explicit.*authorization/i);
  await assert.rejects(() => runProductionEnrollmentIsCurrentMigration080({ adapter, mode: 'apply', executionToken: 'APPLY_ENROLLMENT_IS_CURRENT_080', backupConfirmation: 'wrong', baselineRequired: false }), /backup confirmation/i);
});

test('Migration 080 applies one additive statement, preserves enrollment count, and records only version 080', async () => {
  const { adapter, storage, migration } = await fixture({ count: 43 });
  const result = await runProductionEnrollmentIsCurrentMigration080({ adapter, mode: 'apply', executionToken: 'APPLY_ENROLLMENT_IS_CURRENT_080', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false });
  assert.equal(result.ok, true);
  assert.equal(result.productionWrites, 'MIGRATION_080_ONLY');
  assert.equal(result.before.enrollmentRowCount, 43);
  assert.equal(result.after.enrollmentRowCount, 43);
  assert.deepEqual(storage.statements, [migration.sql]);
  assert.deepEqual(storage.applied.filter((item) => item.version === 80).map((item) => item.name), ['080_restore_student_enrollment_is_current.sql']);
});

test('Migration 080 refuses incompatible columns, wrong databases, and unrelated pending migrations', async () => {
  const incompatible = await fixture({ hasColumn: true });
  incompatible.adapter.query = async (statement) => {
    if (statement.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
    if (statement.includes('information_schema.TABLES')) return [{ tableName: 'student_enrollments' }];
    if (statement.includes('information_schema.COLUMNS')) return [{ columnName: 'is_current', columnType: 'varchar(4)', isNullable: 'YES', columnDefault: null }];
    throw new Error(`Unexpected fixture query: ${statement}`);
  };
  await assert.rejects(() => runProductionEnrollmentIsCurrentMigration080({ adapter: incompatible.adapter, mode: 'dry-run', baselineRequired: false }), { code: 'MIGRATION_080_COLUMN_INCOMPATIBLE' });
  assert.equal(incompatible.storage.statements.length, 0);

  const wrongDatabase = await fixture();
  const originalQuery = wrongDatabase.adapter.query;
  wrongDatabase.adapter.query = async (statement) => statement.includes('SELECT DATABASE()') ? [{ databaseName: 'other_database' }] : originalQuery(statement);
  await assert.rejects(() => runProductionEnrollmentIsCurrentMigration080({ adapter: wrongDatabase.adapter, mode: 'dry-run', baselineRequired: false }), { code: 'DATABASE_TARGET_MISMATCH' });

  const pending = await fixture();
  pending.storage.applied = pending.storage.applied.filter((item) => item.version !== 76);
  await assert.rejects(() => runProductionEnrollmentIsCurrentMigration080({ adapter: pending.adapter, mode: 'dry-run', baselineRequired: false }), { code: 'UNRELATED_MIGRATIONS_PENDING' });
});

test('Migration 080 production workflow is exact-main, protected, backup-gated, and limited to this migration', () => {
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$RELEASE_REF"/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_ENROLLMENT_IS_CURRENT_080/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /production-enrollment-is-current-migrate-080\.mjs dry-run/);
  assert.match(workflow, /production-enrollment-is-current-migrate-080\.mjs apply/);
  assert.doesNotMatch(workflow, /node scripts\/migrate\.mjs apply/);
});
