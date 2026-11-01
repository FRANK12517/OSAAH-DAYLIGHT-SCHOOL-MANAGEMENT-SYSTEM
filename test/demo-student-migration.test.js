import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { applyDemoStudentMigration } from '../src/demo-student-migration.js';

const migrationDirectory = new URL('../schema/', import.meta.url);

async function createTidbFixture({ failAtStatement = null, wrongMarker = false, serverVersion = 'TiDB-v8.5.0' } = {}) {
  const migrations = await discoverMigrations(migrationDirectory);
  const predecessor = migrations.find((item) => item.version === 83);
  const applied = [{ version: 83, name: predecessor.name, checksum: predecessor.checksum, appliedAt: '2026-01-01T00:00:00.000Z' }];
  const state = {
    marker: wrongMarker ? { columnName: 'is_test_record', dataType: 'varchar', columnType: 'varchar(1)', isNullable: 'NO', columnDefault: '0' } : null,
    markerIndex: false,
    assignmentTable: false,
    run: null,
    statementCount: 0,
    applied
  };
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool', serverVersion }];
    if (sql.includes('FROM schema_migration_runs WHERE version=?')) return state.run ? [{ ...state.run }] : [];
    if (sql.includes('FROM schema_migrations WHERE version=?')) return state.applied.filter((item) => item.version === Number(params[0]));
    if (sql.includes('FROM information_schema.COLUMNS')) {
      const table = params[0];
      if (table === 'students') return state.marker ? [{ ...state.marker }] : [];
      if (table === 'demo_student_class_assignments' && state.assignmentTable) return [
        { columnName: 'school_id', dataType: 'varchar', columnType: 'varchar(64)', isNullable: 'NO', columnDefault: null },
        { columnName: 'student_id', dataType: 'varchar', columnType: 'varchar(64)', isNullable: 'NO', columnDefault: null },
        { columnName: 'class_id', dataType: 'varchar', columnType: 'varchar(64)', isNullable: 'NO', columnDefault: null },
        { columnName: 'created_by', dataType: 'varchar', columnType: 'varchar(64)', isNullable: 'YES', columnDefault: null },
        { columnName: 'created_at', dataType: 'varchar', columnType: 'varchar(32)', isNullable: 'NO', columnDefault: null }
      ];
      return [];
    }
    if (sql.includes('FROM information_schema.STATISTICS')) {
      const table = params[0], index = params[1];
      if (table === 'students' && index === 'idx_students_school_demo_status' && state.markerIndex) return ['school_id', 'is_test_record', 'student_status'].map((columnName, index) => ({ indexName: params[1], nonUnique: 1, sequenceInIndex: index + 1, columnName }));
      if (table === 'demo_student_class_assignments' && state.assignmentTable && index === 'PRIMARY') return ['school_id', 'student_id', 'class_id'].map((columnName, index) => ({ indexName: 'PRIMARY', nonUnique: 0, sequenceInIndex: index + 1, columnName }));
      if (table === 'demo_student_class_assignments' && state.assignmentTable && index === 'idx_demo_student_class') return ['school_id', 'class_id', 'student_id'].map((columnName, index) => ({ indexName: params[1], nonUnique: 1, sequenceInIndex: index + 1, columnName }));
      return [];
    }
    if (sql.includes('FROM information_schema.TABLES')) return state.assignmentTable ? [{ tableName: 'demo_student_class_assignments' }] : [];
    if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) return state.assignmentTable ? [
      ['fk_demo_assignment_class', 'class_id', 'classes', 'id'],
      ['fk_demo_assignment_school', 'school_id', 'schools', 'id'],
      ['fk_demo_assignment_student', 'student_id', 'students', 'id']
    ].map(([constraintName, columnName, referencedTableName, referencedColumnName]) => ({ constraintName, columnName, referencedTableName, referencedColumnName })) : [];
    throw new Error(`Unexpected test query: ${sql}`);
  };
  const adapter = {
    dialect: 'tidb',
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata() { return { created: false }; },
    async listApplied() { return structuredClone(state.applied); },
    async listBaselines() { return []; },
    async listMigrationRuns() { return state.run ? [{ ...state.run }] : []; },
    async acquireLock() { return true; },
    async releaseLock() {},
    async transaction(callback) { return callback(this); },
    async execute() { return { affectedRows: 1 }; },
    async startMigration(migration) {
      if (state.run && ['RUNNING', 'FAILED'].includes(state.run.state)) throw Object.assign(new Error('Recovery required.'), { code: 'MIGRATION_RECOVERY_REQUIRED' });
      state.run = { version: migration.version, name: migration.name, checksum: migration.checksum, state: 'RUNNING' };
    },
    async completeMigration(record) { state.run = { version: record.version, name: record.name, checksum: record.checksum, state: 'COMPLETED' }; },
    async failActiveMigration({ version, errorCode }) { state.run = { ...state.run, version, state: 'FAILED', errorCode }; },
    async recordApplied(record) { state.applied.push(structuredClone(record)); },
    async executeMigrationSql(statement) {
      state.statementCount += 1;
      if (failAtStatement === state.statementCount) throw Object.assign(new Error('Injected DDL failure.'), { code: 'INJECTED_DDL_FAILURE' });
      const ddl = statement.replace(/^--[^\n]*(?:\n|$)/gm, '').trim();
      if (ddl.startsWith('ALTER TABLE students')) state.marker ??= { columnName: 'is_test_record', dataType: 'tinyint', columnType: 'tinyint(1)', isNullable: 'NO', columnDefault: '0' };
      else if (ddl.startsWith('CREATE INDEX')) state.markerIndex = true;
      else if (ddl.startsWith('CREATE TABLE')) state.assignmentTable = true;
      else throw new Error(`Unexpected test DDL: ${statement}`);
    },
    async query(sql, params) { return query(sql, params); },
    state
  };
  return adapter;
}

test('migration 084 verifies all schema postconditions and records the exact filename/checksum', async () => {
  const adapter = await createTidbFixture();
  const result = await applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false });
  assert.equal(result.databaseName, 'osaahdaylightschool');
  assert.equal(result.serverVersion, 'TiDB-v8.5.0');
  assert.equal(result.migration.name, '084_demo_student_class_assignments.sql');
  assert.deepEqual(result.applied.map((item) => item.version), [84]);
  assert.equal(result.schema.verified, true);
  assert.equal(result.ledger.name, '084_demo_student_class_assignments.sql');
  assert.equal(adapter.state.statementCount, 3);
});

test('migration 084 is idempotent after successful verification', async () => {
  const adapter = await createTidbFixture();
  await applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false });
  const second = await applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false });
  assert.deepEqual(second.applied, []);
  assert.equal(adapter.state.statementCount, 3);
});

test('migration 084 records interrupted DDL and refuses an automatic retry with partial-schema diagnostics', async () => {
  const adapter = await createTidbFixture({ failAtStatement: 2 });
  await assert.rejects(() => applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false }), { code: 'MIGRATION_FAILED' });
  assert.equal(adapter.state.run.state, 'FAILED');
  assert.equal(adapter.state.applied.some((item) => item.version === 84), false);
  await assert.rejects(() => applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false }), (error) => {
    assert.equal(error.code, 'MIGRATION_RECOVERY_REQUIRED');
    assert.equal(error.details.schemaDiagnostic.verified, false);
    assert.ok(error.details.schemaDiagnostic.components.some((item) => item.component === 'students.idx_students_school_demo_status' && item.verified === false));
    return true;
  });
  assert.equal(adapter.state.statementCount, 2);
});

test('migration 084 refuses a preexisting conflicting column definition', async () => {
  const adapter = await createTidbFixture({ wrongMarker: true });
  await assert.rejects(() => applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'apply', baselineRequired: false }), { code: 'MIGRATION_084_PREEXISTING_SCHEMA_CONFLICT' });
  assert.equal(adapter.state.applied.some((item) => item.version === 84), false);
  assert.equal(adapter.state.run, null);
  assert.equal(adapter.state.statementCount, 0);
});

test('migration 084 refuses TiDB versions before generally available foreign-key enforcement', async () => {
  const adapter = await createTidbFixture({ serverVersion: 'Release Version: v7.5.3' });
  await assert.rejects(() => applyDemoStudentMigration(adapter, { directory: migrationDirectory, mode: 'dry-run', baselineRequired: false }), { code: 'TIDB_VERSION_UNSUPPORTED' });
  assert.equal(adapter.state.statementCount, 0);
});
