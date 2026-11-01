import { createMigrationRunner, discoverMigrations } from './platform/migration-runner.js';

const VERSION = 84;
const MIGRATION_NAME = '084_demo_student_class_assignments.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const MINIMUM_TIDB_VERSION = [8, 5, 0];
const expectedColumns = Object.freeze({
  demo_student_class_assignments: [
    ['school_id', 'varchar', '64', 'NO'],
    ['student_id', 'varchar', '64', 'NO'],
    ['class_id', 'varchar', '64', 'NO'],
    ['created_by', 'varchar', '64', 'YES'],
    ['created_at', 'varchar', '32', 'NO']
  ]
});

function fail(message, details = {}) {
  throw Object.assign(new Error(message), { code: 'MIGRATION_084_POSTCONDITION_FAILED', details });
}

function sameList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function parseTiDBVersion(value) {
  const match = String(value ?? '').match(/(?:release\s+version:\s*)?v?(\d+)\.(\d+)\.(\d+)/i);
  return match ? match.slice(1).map(Number) : null;
}

function meetsMinimumTiDBVersion(version) {
  for (let index = 0; index < MINIMUM_TIDB_VERSION.length; index += 1) {
    if (version[index] > MINIMUM_TIDB_VERSION[index]) return true;
    if (version[index] < MINIMUM_TIDB_VERSION[index]) return false;
  }
  return true;
}

async function columnsFor(adapter, tableName) {
  return adapter.query(`SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
      IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [tableName]);
}

async function indexFor(adapter, tableName, indexName) {
  return adapter.query(`SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS sequenceInIndex, COLUMN_NAME AS columnName
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX`, [tableName, indexName]);
}

function assertIndex(rows, name, columns, unique = false) {
  const actualColumns = rows.map((row) => String(row.columnName ?? row.COLUMN_NAME ?? ''));
  const uniqueValues = new Set(rows.map((row) => Number(row.nonUnique ?? row.NON_UNIQUE)));
  if (!sameList(actualColumns, columns) || uniqueValues.size !== 1 || !uniqueValues.has(unique ? 0 : 1)) {
    fail(`Migration 084 index ${name} does not match its expected definition.`, { index: name, expectedColumns: columns, actualColumns, expectedUnique: unique, actualNonUnique: [...uniqueValues] });
  }
}

async function verifyStudentMarker(adapter) {
  const rows = await columnsFor(adapter, 'students');
  const marker = rows.find((row) => String(row.columnName ?? row.COLUMN_NAME).toLowerCase() === 'is_test_record');
  const dataType = String(marker?.dataType ?? marker?.DATA_TYPE ?? '').toLowerCase();
  const columnType = String(marker?.columnType ?? marker?.COLUMN_TYPE ?? '').toLowerCase();
  const nullable = String(marker?.isNullable ?? marker?.IS_NULLABLE ?? '').toUpperCase();
  const defaultValue = String(marker?.columnDefault ?? marker?.COLUMN_DEFAULT ?? '');
  if (!marker || dataType !== 'tinyint' || columnType !== 'tinyint(1)' || nullable !== 'NO' || !['0', '0.0'].includes(defaultValue)) {
    fail('Migration 084 students.is_test_record has an unexpected definition.', { column: 'students.is_test_record', expected: { dataType: 'tinyint', columnType: 'tinyint(1)', nullable: 'NO', default: '0' }, actual: marker ?? null });
  }
}

async function verifyStudentMarkerIndex(adapter) {
  await verifyStudentMarker(adapter);
  const rows = await indexFor(adapter, 'students', 'idx_students_school_demo_status');
  assertIndex(rows, 'idx_students_school_demo_status', ['school_id', 'is_test_record', 'student_status']);
}

async function verifyAssignmentTable(adapter) {
  const tables = await adapter.query(`SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='demo_student_class_assignments'`);
  if (!tables.length) fail('Migration 084 table demo_student_class_assignments is missing.', { table: 'demo_student_class_assignments' });

  const columns = await columnsFor(adapter, 'demo_student_class_assignments');
  const actualColumns = columns.map((row) => [
    String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase(),
    String(row.dataType ?? row.DATA_TYPE ?? '').toLowerCase(),
    String(row.columnType ?? row.COLUMN_TYPE ?? '').match(/\((\d+)\)/)?.[1] ?? '',
    String(row.isNullable ?? row.IS_NULLABLE ?? '').toUpperCase()
  ]);
  for (const expected of expectedColumns.demo_student_class_assignments) {
    const actual = actualColumns.find((item) => item[0] === expected[0]);
    if (!actual || !sameList(actual, expected)) fail(`Migration 084 column ${expected[0]} has an unexpected definition.`, { column: expected[0], expected, actual: actual ?? null });
    const source = columns.find((row) => String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase() === expected[0]);
    if ((source?.columnDefault ?? source?.COLUMN_DEFAULT ?? null) !== null) fail(`Migration 084 column ${expected[0]} has an unexpected default.`, { column: expected[0], expectedDefault: null, actualDefault: source?.columnDefault ?? source?.COLUMN_DEFAULT ?? null });
  }
  if (actualColumns.length !== expectedColumns.demo_student_class_assignments.length) {
    fail('Migration 084 assignment table has an unexpected column set.', { expectedColumns: expectedColumns.demo_student_class_assignments.map((row) => row[0]), actualColumns: actualColumns.map((row) => row[0]) });
  }

  const primary = await indexFor(adapter, 'demo_student_class_assignments', 'PRIMARY');
  assertIndex(primary, 'PRIMARY', ['school_id', 'student_id', 'class_id'], true);
  const classIndex = await indexFor(adapter, 'demo_student_class_assignments', 'idx_demo_student_class');
  assertIndex(classIndex, 'idx_demo_student_class', ['school_id', 'class_id', 'student_id']);

  const foreignKeys = await adapter.query(`SELECT CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS referencedTableName, REFERENCED_COLUMN_NAME AS referencedColumnName
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='demo_student_class_assignments'
      AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME`);
  const actualForeignKeys = foreignKeys.map((row) => [
    String(row.constraintName ?? row.CONSTRAINT_NAME ?? '').toLowerCase(),
    String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase(),
    String(row.referencedTableName ?? row.REFERENCED_TABLE_NAME ?? '').toLowerCase(),
    String(row.referencedColumnName ?? row.REFERENCED_COLUMN_NAME ?? '').toLowerCase()
  ]);
  const expectedForeignKeys = [
    ['fk_demo_assignment_class', 'class_id', 'classes', 'id'],
    ['fk_demo_assignment_school', 'school_id', 'schools', 'id'],
    ['fk_demo_assignment_student', 'student_id', 'students', 'id']
  ];
  for (const expected of expectedForeignKeys) {
    if (!actualForeignKeys.some((actual) => sameList(actual, expected))) fail(`Migration 084 foreign key ${expected[0]} is missing or incorrect.`, { constraint: expected[0], expected, actual: actualForeignKeys.filter((row) => row[0] === expected[0]) });
  }
  if (actualForeignKeys.length !== expectedForeignKeys.length) fail('Migration 084 assignment table has an unexpected foreign key set.', { expected: expectedForeignKeys, actual: actualForeignKeys });
}

export async function verifyDemoStudentMigrationPostcondition({ adapter, migration, statementIndex } = {}) {
  if (!adapter?.query) throw Object.assign(new Error('Migration verification requires a database query adapter.'), { code: 'DATABASE_ADAPTER_INVALID' });
  if (Number(migration?.version) !== VERSION || migration?.name !== MIGRATION_NAME) {
    throw Object.assign(new Error('The migration verifier only accepts canonical migration 084.'), { code: 'DEMO_MIGRATION_IDENTITY_MISMATCH' });
  }
  if (statementIndex === 1) await verifyStudentMarker(adapter);
  else if (statementIndex === 2) await verifyStudentMarkerIndex(adapter);
  else if (statementIndex === 3) {
    await verifyStudentMarkerIndex(adapter);
    await verifyAssignmentTable(adapter);
  } else fail('Migration 084 verifier received an unexpected DDL statement index.', { statementIndex });
}

export async function verifyDemoStudentMigrationSchema(adapter) {
  await verifyStudentMarkerIndex(adapter);
  await verifyAssignmentTable(adapter);
  return { version: VERSION, name: MIGRATION_NAME, verified: true };
}

export async function diagnoseDemoStudentMigrationSchema(adapter) {
  const checks = [
    ['students.is_test_record', () => verifyStudentMarker(adapter)],
    ['students.idx_students_school_demo_status', () => verifyStudentMarkerIndex(adapter)],
    ['demo_student_class_assignments schema', () => verifyAssignmentTable(adapter)]
  ];
  const components = [];
  for (const [component, verify] of checks) {
    try { await verify(); components.push({ component, verified: true }); }
    catch (cause) { components.push({ component, verified: false, code: cause?.code ?? 'SCHEMA_DIAGNOSTIC_FAILED', details: cause?.details ?? null }); }
  }
  return { version: VERSION, name: MIGRATION_NAME, verified: components.every((item) => item.verified), components };
}

async function preflightExistingSchema(adapter) {
  const studentColumns = await columnsFor(adapter, 'students');
  const markerExists = studentColumns.some((row) => String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase() === 'is_test_record');
  if (markerExists) await verifyStudentMarker(adapter);

  const markerIndex = await indexFor(adapter, 'students', 'idx_students_school_demo_status');
  if (markerIndex.length) await verifyStudentMarkerIndex(adapter);

  const assignments = await adapter.query(`SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='demo_student_class_assignments'`);
  if (assignments.length) await verifyAssignmentTable(adapter);
}

export async function applyDemoStudentMigration(adapter, {
  directory,
  mode = 'dry-run',
  expectedDatabase = EXPECTED_DATABASE,
  baselineRequired = true,
  runnerFactory = createMigrationRunner
} = {}) {
  if (adapter?.dialect !== 'tidb' || typeof adapter?.query !== 'function') {
    throw Object.assign(new Error('Migration 084 requires the TiDB database adapter.'), { code: 'TIDB_ADAPTER_REQUIRED' });
  }
  if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run and apply modes are supported.'), { code: 'INVALID_MIGRATION_MODE' });
  if (!directory) throw Object.assign(new Error('Migration directory is required.'), { code: 'MIGRATION_DIRECTORY_REQUIRED' });

  const identity = (await adapter.query('SELECT DATABASE() AS databaseName, TIDB_VERSION() AS serverVersion'))[0] ?? {};
  const databaseName = identity.databaseName ?? identity.database_name ?? identity['DATABASE()'];
  const serverVersion = identity.serverVersion ?? identity.server_version ?? identity['TIDB_VERSION()'];
  if (databaseName !== expectedDatabase) {
    throw Object.assign(new Error('Unexpected database target for migration 084.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase, actualDatabase: databaseName ?? null } });
  }
  const parsedVersion = parseTiDBVersion(serverVersion);
  if (!parsedVersion) throw Object.assign(new Error('Could not parse the TiDB server version.'), { code: 'TIDB_VERSION_UNRECOGNIZED' });
  if (!meetsMinimumTiDBVersion(parsedVersion)) throw Object.assign(new Error('Migration 084 requires TiDB 8.5.0 or newer for generally available foreign-key enforcement.'), { code: 'TIDB_VERSION_UNSUPPORTED', details: { minimumVersion: '8.5.0', actualVersion: parsedVersion.join('.') } });

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== MIGRATION_NAME) throw Object.assign(new Error('Canonical migration 084 is missing or has a mismatched filename.'), { code: 'DEMO_MIGRATION_IDENTITY_MISMATCH' });
  const runner = runnerFactory({ adapter, directory, baselineRequired });
  const runs = await adapter.query('SELECT version,name,checksum,state FROM schema_migration_runs WHERE version=?', [VERSION]);
  const priorRun = runs[0] ?? null;
  if (priorRun && ['RUNNING', 'FAILED'].includes(String(priorRun.state).toUpperCase())) {
    const schemaDiagnostic = await diagnoseDemoStudentMigrationSchema(adapter);
    throw Object.assign(new Error(`Migration 084 has an unresolved ${String(priorRun.state).toUpperCase()} run; inspect actual schema before recovery.`), {
      code: 'MIGRATION_RECOVERY_REQUIRED',
      details: { version: VERSION, name: priorRun.name, state: priorRun.state, schemaDiagnostic }
    });
  }

  try { await preflightExistingSchema(adapter); }
  catch (cause) {
    throw Object.assign(new Error('Existing schema objects conflict with migration 084; no DDL was attempted.'), {
      code: 'MIGRATION_084_PREEXISTING_SCHEMA_CONFLICT',
      details: { code: cause?.code ?? null, details: cause?.details ?? null }
    });
  }

  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [83], dryRun: true });
  if (mode === 'dry-run') {
    const existingLedger = (await adapter.query('SELECT version,name,checksum FROM schema_migrations WHERE version=?', [VERSION]))[0] ?? null;
    const schemaDiagnostic = await diagnoseDemoStudentMigrationSchema(adapter);
    return { mode: 'DRY_RUN', databaseName, serverVersion, migration: { version: VERSION, name: migration.name, checksum: migration.checksum }, pending: dryRun.pending, existingLedger, schemaDiagnostic };
  }

  const result = await runner.applyVersions({
    versions: [VERSION],
    requiredAppliedVersions: [83],
    verifyMigration: async ({ adapter: transaction, migration: selected, statementIndex }) =>
      verifyDemoStudentMigrationPostcondition({ adapter: transaction, migration: selected, statementIndex })
  });
  const schema = await verifyDemoStudentMigrationSchema(adapter);
  const ledger = (await adapter.query('SELECT version,name,checksum FROM schema_migrations WHERE version=?', [VERSION]))[0] ?? null;
  if (!ledger || Number(ledger.version) !== VERSION || ledger.name !== MIGRATION_NAME || ledger.checksum !== migration.checksum) {
    throw Object.assign(new Error('Migration 084 ledger entry does not match the verified migration file.'), { code: 'MIGRATION_LEDGER_VERIFICATION_FAILED', details: { version: ledger?.version ?? null, name: ledger?.name ?? null } });
  }
  return { mode: 'APPLIED_OR_ALREADY_CURRENT', databaseName, serverVersion, migration: { version: VERSION, name: migration.name, checksum: migration.checksum }, applied: result.applied, schema, ledger: { version: Number(ledger.version), name: ledger.name, checksum: ledger.checksum } };
}
