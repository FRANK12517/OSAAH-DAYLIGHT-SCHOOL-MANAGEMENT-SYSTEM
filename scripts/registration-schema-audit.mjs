import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { discoverMigrations } from '../src/platform/migration-runner.js';

export const REGISTRATION_SCHEMA_REQUIREMENTS = Object.freeze({
  schools: ['id'],
  students: ['id', 'permanent_student_id', 'school_id', 'admission_number', 'current_class_id', 'first_name', 'middle_name', 'last_name', 'full_name', 'gender', 'date_of_birth', 'parent_guardian_name', 'parent_phone', 'admission_date', 'admission_type', 'student_status', 'is_test_record', 'created_at', 'updated_at'],
  student_profiles: ['id', 'student_master_id', 'student_id', 'permanent_student_id', 'school_id', 'admission_number', 'first_name', 'middle_name', 'surname', 'gender', 'date_of_birth', 'place_of_birth', 'class_id', 'home_address', 'nationality', 'previous_school', 'previous_class', 'admission_type', 'qr_code', 'enrollment_status', 'created_at', 'updated_at'],
  student_family_contacts: ['id', 'student_id', 'contact_type', 'full_name', 'relationship', 'telephone', 'address', 'email', 'occupation', 'national_id', 'created_at', 'updated_at'],
  student_health_records: ['student_id', 'allergies', 'conditions', 'medications', 'emergency_notes', 'created_at', 'updated_at'],
  classes: ['id', 'name', 'school_id', 'status'],
  academic_years: ['id', 'school_id', 'name', 'starts_on'],
  terms: ['id', 'academic_year_id', 'name'],
  student_enrollments: ['id', 'student_id', 'school_id', 'class_id', 'academic_year_id', 'term_id', 'enrollment_status', 'is_current', 'enrolled_at'],
  users: ['id', 'school_id', 'email', 'phone', 'username', 'status'],
  user_roles: ['user_id', 'role_id'],
  roles: ['id', 'school_id', 'role_key'],
  parent_student_links: ['parent_user_id', 'student_id', 'permanent_student_id', 'telephone', 'relationship', 'relationship_type', 'link_status', 'created_at', 'updated_at'],
  student_id_sequences: ['admission_year', 'next_sequence', 'updated_at'],
  student_id_reservations: ['id', 'reservation_token', 'permanent_student_id', 'admission_year', 'sequence_number', 'reservation_status', 'student_id', 'reserved_by', 'created_at', 'consumed_at'],
  ai_audit_logs: ['id', 'request_id', 'correlation_id', 'occurred_at', 'event_type', 'severity', 'school_id', 'user_id', 'role_key', 'capability_id', 'request_status', 'environment', 'metadata_json'],
  schema_migrations: ['version', 'name', 'checksum', 'applied_at']
});

export const REGISTRATION_SCHEMA_INDEXES = Object.freeze([
  { table: 'students', columns: ['school_id', 'admission_number'], unique: true },
  { table: 'students', columns: ['permanent_student_id'], unique: true },
  { table: 'student_profiles', columns: ['school_id', 'admission_number'], unique: true },
  { table: 'student_profiles', columns: ['qr_code'], unique: true },
  { table: 'student_id_sequences', columns: ['admission_year'], unique: true },
  { table: 'student_id_reservations', columns: ['reservation_token'], unique: true },
  { table: 'student_id_reservations', columns: ['permanent_student_id'], unique: true },
  { table: 'student_id_reservations', columns: ['admission_year', 'sequence_number'], unique: true },
  { table: 'parent_student_links', columns: ['parent_user_id', 'student_id'], unique: true },
  { table: 'student_enrollments', columns: ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current'], unique: true }
]);

const MIGRATION_VERSIONS = [18, 23, 27, 38, 54, 78, 84, 85, 86];
const auditFailure = (code) => Object.assign(new Error(code), { code });
const tableColumns = (rows) => new Map(rows.map((row) => {
  const table = String(row.tableName ?? row.TABLE_NAME).toLowerCase();
  const name = String(row.columnName ?? row.COLUMN_NAME).toLowerCase();
  return [`${table}.${name}`, { name, type: String(row.columnType ?? row.COLUMN_TYPE ?? '').toLowerCase(), nullable: String(row.isNullable ?? row.IS_NULLABLE ?? '').toUpperCase() }];
}));

export async function runRegistrationSchemaAudit({ adapter, directory = new URL('../schema/', import.meta.url), discover = discoverMigrations } = {}) {
  if (adapter?.dialect !== 'tidb' || typeof adapter.verifyReadiness !== 'function' || typeof adapter.query !== 'function') throw auditFailure('TIDB_ADAPTER_REQUIRED');
  let identity;
  try { identity = await adapter.verifyReadiness(); } catch { throw auditFailure('TIDB_CONNECTION_OR_IDENTITY_FAILED'); }
  if (identity?.ready !== true || identity.database !== 'osaahdaylightschool' || identity.engine !== 'TiDB') throw auditFailure('DATABASE_IDENTITY_MISMATCH');

  const tableNames = Object.keys(REGISTRATION_SCHEMA_REQUIREMENTS);
  let tables, columns, indexes, migrations;
  try {
    [tables, columns, indexes] = await Promise.all([
      adapter.query('SELECT TABLE_NAME AS tableName,TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [tableNames]),
      adapter.query('SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME,ORDINAL_POSITION', [tableNames]),
      adapter.query('SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX', [tableNames])
    ]);
    if (!tables.some((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase() === 'schema_migrations')) throw auditFailure('MIGRATION_LEDGER_MISSING');
    migrations = await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version IN (?,?,?,?,?,?,?,?,?) ORDER BY version', MIGRATION_VERSIONS);
  } catch (error) {
    if (error?.code === 'MIGRATION_LEDGER_MISSING') throw error;
    throw auditFailure('REGISTRATION_SCHEMA_READ_FAILED');
  }

  const actualTables = new Set(tables.map((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase()));
  const actualColumns = tableColumns(columns);
  const columnChecks = [];
  for (const [table, required] of Object.entries(REGISTRATION_SCHEMA_REQUIREMENTS)) {
    for (const column of required) {
      const actual = actualColumns.get(`${table}.${column}`);
      const expected = table === 'student_profiles' && column === 'previous_school' ? { type: 'varchar(120)', nullable: 'YES' }
        : table === 'student_profiles' && column === 'previous_class' ? { type: 'varchar(20)', nullable: 'YES' } : null;
      const typeMatches = !expected || actual?.type === expected.type;
      const nullabilityMatches = !expected || actual?.nullable === expected.nullable;
      columnChecks.push({ table, column, tableExists: actualTables.has(table), columnExists: Boolean(actual), actualType: actual?.type ?? null, nullable: actual?.nullable ?? null, expectedType: expected?.type ?? null, expectedNullable: expected?.nullable ?? null, definitionMatches: typeMatches && nullabilityMatches, ok: actualTables.has(table) && Boolean(actual) && typeMatches && nullabilityMatches });
    }
  }
  const indexGroups = new Map();
  for (const row of indexes) {
    const key = `${String(row.tableName ?? row.TABLE_NAME).toLowerCase()}.${String(row.indexName ?? row.INDEX_NAME)}`;
    (indexGroups.get(key) ?? indexGroups.set(key, []).get(key)).push({ column: String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), sequence: Number(row.sequence ?? row.SEQ_IN_INDEX), unique: Number(row.nonUnique ?? row.NON_UNIQUE) === 0 });
  }
  const indexChecks = REGISTRATION_SCHEMA_INDEXES.map((expected) => {
    const matched = [...indexGroups.entries()].some(([key, members]) => key.startsWith(`${expected.table}.`) && members.sort((a, b) => a.sequence - b.sequence).map((item) => item.column).join(',') === expected.columns.join(',') && members.every((item) => item.unique === expected.unique));
    return { ...expected, present: matched };
  });
  const localMigrations = await discover(directory);
  const migrationChecks = MIGRATION_VERSIONS.map((version) => {
    const source = localMigrations.find((entry) => entry.version === version);
    const record = migrations.find((entry) => Number(entry.version) === version);
    return { version, name: source?.name ?? null, recorded: Boolean(record), checksumMatches: Boolean(record && source && record.name === source.name && String(record.checksum).toLowerCase() === source.checksum) };
  });
  const errors = [
    ...columnChecks.filter((item) => !item.tableExists || !item.columnExists).map((item) => `MISSING_COLUMN:${item.table}.${item.column}`),
    ...columnChecks.filter((item) => item.columnExists && !item.definitionMatches).map((item) => `COLUMN_DEFINITION_MISMATCH:${item.table}.${item.column}`),
    ...indexChecks.filter((item) => !item.present).map((item) => `MISSING_INDEX:${item.table}(${item.columns.join(',')})`),
    ...migrationChecks.filter((item) => item.recorded && !item.checksumMatches).map((item) => `MIGRATION_CHECKSUM_MISMATCH:${item.version}`),
    ...migrationChecks.filter((item) => [84, 85, 86].includes(item.version) && !item.recorded).map((item) => `MIGRATION_NOT_RECORDED:${item.version}`)
  ];
  return { result: errors.length ? 'FAIL' : 'PASS', connection: { engine: 'TiDB', database: 'osaahdaylightschool', mode: 'READ_ONLY' }, columns: columnChecks, indexes: indexChecks, migrations: migrationChecks, errors };
}

async function cli() {
  let adapter;
  try {
    if (String(process.env.OSAAH_DATABASE_ADAPTER ?? '').toLowerCase() !== 'tidb') throw auditFailure('OSAAH_DATABASE_ADAPTER_MUST_BE_TIDB');
    adapter = createDatabaseAdapter({ environment: process.env });
    const report = await runRegistrationSchemaAudit({ adapter });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.result !== 'PASS') process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ result: 'FAIL', error: error.code ?? 'REGISTRATION_SCHEMA_AUDIT_FAILED' })}\n`);
    process.exitCode = 1;
  } finally { await adapter?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await cli();
