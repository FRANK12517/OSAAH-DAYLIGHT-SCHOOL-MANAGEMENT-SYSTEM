import assert from 'node:assert/strict';
import { after } from 'node:test';
import { test } from 'node:test';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInMemoryMigrationAdapter, discoverMigrations } from '../src/platform/migration-runner.js';
import { runProductionAdmissionsMigration078 } from '../scripts/production-admissions-migration-078.mjs';

const schemaDirectory = resolve('schema');
const tempDirectories = [];
after(async () => { await Promise.all(tempDirectories.map((path) => rm(path, { recursive: true, force: true }))); });

const indexRows = [
  ['admission_applications', 'uq_admission_applications_enquiry_request', ['school_id', 'enquiry_request_id']],
  ['admission_applications', 'uq_admission_application_student_id', ['student_id']],
  ['admission_applications', 'uq_admission_application_permanent_student_id', ['school_id', 'permanent_student_id']],
  ['student_enrollments', 'uq_student_enrollment_context', ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current']]
].flatMap(([tableName, indexName, columns]) => columns.map((columnName, index) => ({ tableName, indexName, columnName, sequence: index + 1, nonUnique: 0 })));

async function adapterFixture({ databaseName = 'osaahdaylightschool', appliedThrough = 77, indexFixture = indexRows } = {}) {
  const migrations = await discoverMigrations(schemaDirectory);
  const storage = {
    applied: migrations.filter((item) => item.version <= appliedThrough).map((item) => ({ version: item.version, name: item.name, checksum: item.checksum, appliedAt: '2026-10-09T00:00:00.000Z' })),
    baselines: [], statements: [], locked: false
  };
  const memory = createInMemoryMigrationAdapter(storage);
  const adapter = {
    ...memory,
    async query(sql) {
      if (sql.includes('SELECT DATABASE()')) return [{ databaseName }];
      if (sql.includes('information_schema.COLUMNS')) return [
        { columnName: 'enquiry_request_id', columnType: 'varchar(64)', isNullable: 'YES' },
        { columnName: 'permanent_student_id', columnType: 'varchar(128)', isNullable: 'YES' }
      ];
      if (sql.includes('information_schema.STATISTICS')) return indexFixture;
      if (sql.includes('COUNT(DISTINCT r.role_key)')) return [{ roleCount: 2 }];
      throw new Error(`Unexpected test query: ${sql}`);
    },
    async close() {}
  };
  return { adapter, storage, migrations };
}

test('Migration 078 dry-run produces an exact one-version plan without writes', async () => {
  const { adapter, storage } = await adapterFixture();
  const report = await runProductionAdmissionsMigration078({ adapter, mode: 'dry-run', baselineRequired: false });
  assert.equal(report.ok, true);
  assert.equal(report.productionWrites, 'NONE');
  assert.deepEqual(report.result.pending.map((item) => item.version), [78]);
  assert.equal(storage.statements.length, 0);
  assert.equal(storage.applied.some((item) => item.version === 78), false);
});

test('Migration 078 apply requires both exact authorization and backup confirmation', async () => {
  const { adapter } = await adapterFixture();
  await assert.rejects(() => runProductionAdmissionsMigration078({ adapter, mode: 'apply', executionToken: 'wrong', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false }), /explicit.*authorization/i);
  await assert.rejects(() => runProductionAdmissionsMigration078({ adapter, mode: 'apply', executionToken: 'APPLY_ADMISSIONS_MIGRATION_078', backupConfirmation: 'wrong', baselineRequired: false }), /backup confirmation/i);
});

test('Migration 078 apply verifies the exact schema and records only version 078', async () => {
  const { adapter, storage } = await adapterFixture();
  const report = await runProductionAdmissionsMigration078({ adapter, mode: 'apply', executionToken: 'APPLY_ADMISSIONS_MIGRATION_078', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false });
  assert.equal(report.ok, true);
  assert.equal(report.productionWrites, 'MIGRATION_078_ONLY');
  assert.equal(report.applied, 1);
  assert.equal(report.verifiedSchema.uniqueIndexesVerified, 4);
  assert.deepEqual(storage.applied.filter((item) => item.version === 78).map((item) => item.name), ['078_admissions_leadership_access.sql']);
  assert.equal(storage.statements.length, 1);
  assert.match(storage.statements[0], /uq_student_enrollment_context/);
});

test('Migration 078 refuses an unexpected database target before any migration write', async () => {
  const { adapter, storage } = await adapterFixture({ databaseName: 'not_the_school_database' });
  await assert.rejects(() => runProductionAdmissionsMigration078({ adapter, mode: 'apply', executionToken: 'APPLY_ADMISSIONS_MIGRATION_078', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false }), /unexpected production database target/i);
  assert.equal(storage.statements.length, 0);
});

test('Migration 078 refuses to run while any other migration is pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'admissions-078-test-'));
  tempDirectories.push(directory);
  const migrations = await discoverMigrations(schemaDirectory);
  const prior = migrations.find((item) => item.version === 77);
  const current = migrations.find((item) => item.version === 78);
  await copyFile(resolve(schemaDirectory, prior.name), join(directory, prior.name));
  await copyFile(resolve(schemaDirectory, current.name), join(directory, current.name));
  await writeFile(join(directory, '079_future_test.sql'), 'SELECT 1;\n');
  const storage = { applied: [{ version: 77, name: prior.name, checksum: prior.checksum, appliedAt: '2026-10-09T00:00:00.000Z' }], baselines: [], statements: [], locked: false };
  const memory = createInMemoryMigrationAdapter(storage);
  const adapter = { ...memory, async query(sql) { if (sql.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }]; throw new Error(`Unexpected test query: ${sql}`); }, async close() {} };
  await assert.rejects(() => runProductionAdmissionsMigration078({ adapter, directory, mode: 'apply', executionToken: 'APPLY_ADMISSIONS_MIGRATION_078', backupConfirmation: 'BACKUP_CONFIRMED', baselineRequired: false }), { code: 'UNRELATED_MIGRATIONS_PENDING' });
  assert.equal(storage.statements.length, 0);
});
