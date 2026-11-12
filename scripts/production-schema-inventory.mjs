import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expectedDatabase = 'osaahdaylightschool';
const expectedTables = [
  'schools', 'school_settings', 'system_settings', 'users', 'staff', 'staff_profiles', 'staff_assignments',
  'staff_leave', 'staff_attendance', 'roles', 'permissions', 'user_roles', 'role_permissions', 'auth_sessions',
  'classes', 'levels', 'students', 'student_profiles', 'student_family_contacts', 'student_class_history',
  'student_enrollments', 'admission_applications', 'academic_years', 'terms', 'subjects', 'subject_class_assignments',
  'academic_score_records', 'academic_result_records', 'student_assessments', 'assessment_scores',
  'academic_calendar_events', 'academic_calendar_term_configs', 'calendar_events', 'student_attendance',
  'attendance_audit_history', 'fee_structures', 'fee_obligations', 'fee_collection_records', 'fee_payments',
  'fee_structures_v2', 'fee_types', 'fee_invoices', 'payments', 'budgets', 'budget_items', 'expenses', 'general_income', 'school_expenses',
  'student_id_reservations',
  'transport_routes', 'student_transport_assignments', 'hostel_allocations', 'schema_migrations'
];
const migrationDefinitions = [
  { version: 40, name: '040_fee_structures_v2.sql', file: new URL('../schema/040_fee_structures_v2.sql', import.meta.url) },
  { version: 84, name: '084_internal_student_registration.sql', file: new URL('../schema/084_internal_student_registration.sql', import.meta.url) }
];
const requiredColumns = {
  fee_structures_v2: ['id', 'school_id', 'academic_year_id', 'term_id', 'class_id', 'fee_type', 'description', 'amount', 'mandatory', 'status', 'published_by', 'published_at', 'created_by', 'created_at', 'updated_by', 'updated_at'],
  fee_obligations: ['id', 'school_id', 'fee_structure_id', 'academic_year_id', 'term_id', 'applicability_type', 'class_id', 'student_id', 'amount_minor', 'due_date', 'status', 'published_by', 'published_at', 'idempotency_key', 'created_at', 'updated_at', 'custom_fee_type_name'],
  fee_types: ['id', 'school_id', 'code', 'name', 'category', 'description', 'is_active', 'is_system', 'created_at', 'updated_at'],
  student_id_reservations: ['id', 'reservation_token', 'permanent_student_id', 'admission_year', 'sequence_number', 'reservation_status', 'student_id', 'reserved_by', 'created_at', 'consumed_at'],
  student_profiles: ['home_address'],
  students: ['admission_type', 'is_test_record'],
  student_family_contacts: ['email', 'occupation', 'national_id']
};
const requiredIndexes = [
  ['fee_structures_v2', 'PRIMARY', ['id'], 0],
  ['fee_structures_v2', 'idx_fee_structures_v2_scope', ['school_id', 'academic_year_id', 'term_id', 'class_id'], 1],
  ['fee_structures_v2', 'idx_fee_structures_v2_status', ['school_id', 'status'], 1],
  ['fee_structures_v2', 'idx_fee_structures_v2_type', ['school_id', 'fee_type'], 1],
  ['fee_obligations', 'PRIMARY', ['id'], 0],
  ['fee_obligations', 'uq_fee_obligation_scope', ['school_id', 'idempotency_key'], 0],
  ['fee_obligations', 'idx_fee_obligations_student', ['school_id', 'student_id'], 1],
  ['fee_types', 'PRIMARY', ['id'], 0],
  ['fee_types', null, ['school_id', 'code'], 0],
  ['fee_types', 'idx_fee_types_scope', ['school_id', 'is_active', 'code'], 1],
  ['student_id_reservations', 'PRIMARY', ['id'], 0],
  ['student_id_reservations', 'uq_student_id_reservation_token', ['reservation_token'], 0],
  ['student_id_reservations', 'uq_student_id_reservation_permanent', ['permanent_student_id'], 0],
  ['student_id_reservations', 'uq_student_id_reservation_sequence', ['admission_year', 'sequence_number'], 0],
  ['student_id_reservations', 'idx_student_id_reservation_status', ['reservation_status', 'admission_year'], 1]
];
const requiredForeignKeys = [
  ['fee_structures_v2', 'school_id', 'schools', 'id'],
  ['fee_structures_v2', 'published_by', 'users', 'id'],
  ['fee_structures_v2', 'created_by', 'users', 'id'],
  ['fee_structures_v2', 'updated_by', 'users', 'id'],
  ['fee_types', 'school_id', 'schools', 'id']
];

async function migrationChecksum(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function safeFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? 'DATABASE_INVENTORY_FAILED',
      errno: error?.errno ?? null,
      sqlState: error?.sqlState ?? null
    }
  };
}

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    const database = databaseRow?.database_name ?? null;
    const [tableRows] = await pool.query(
      'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
    );
    const tables = tableRows.map((row) => ({ name: row.TABLE_NAME, type: row.TABLE_TYPE }));
    const present = new Set(tables.map((table) => table.name));
    const [migrationCandidates] = await pool.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) LIKE '%migration%' ORDER BY TABLE_NAME"
    );
    const [columnRows] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [expectedTables]
    );
    const [indexRows] = await pool.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [Object.keys(requiredColumns)]
    );
    const [foreignKeyRows] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
      [Object.keys(requiredColumns)]
    );
    const [migrationRows] = present.has('schema_migrations')
      ? await pool.query('SELECT version, name, checksum, applied_at FROM schema_migrations WHERE version IN (?,?) ORDER BY version', [40, 84])
      : [[]];
    const [admissionsPermissionRows] = await pool.query(
      `SELECT r.role_key AS role_key, COUNT(DISTINCT p.permission_key) AS permission_count
       FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.permission_key = 'admissions.write'
         AND r.role_key IN ('PROPRIETOR','HEADTEACHER','ASSISTANT_HEADTEACHER','SCHOOL_ADMIN')
       GROUP BY r.role_key ORDER BY r.role_key`
    );
    const [authSessionIndexes] = await pool.query(
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_sessions'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`
    );
    const columns = {};
    for (const row of columnRows) {
      (columns[row.TABLE_NAME] ??= []).push({
        name: row.COLUMN_NAME,
        type: row.COLUMN_TYPE,
        nullable: row.IS_NULLABLE,
        key: row.COLUMN_KEY
      });
    }
    const columnNames = new Map(Object.entries(columns).map(([table, values]) => [table, new Set(values.map((column) => column.name))]));
    const missingColumns = Object.fromEntries(Object.entries(requiredColumns).map(([table, required]) => [table, required.filter((column) => !columnNames.get(table)?.has(column))]));
    const indexGroups = new Map();
    for (const row of indexRows) {
      const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
      (indexGroups.get(key) ?? indexGroups.set(key, []).get(key)).push({ column: row.COLUMN_NAME, sequence: Number(row.SEQ_IN_INDEX), nonUnique: Number(row.NON_UNIQUE) });
    }
    const indexChecks = requiredIndexes.map(([table, name, expectedColumns, expectedNonUnique]) => {
      const candidates = name ? [[name, indexGroups.get(`${table}.${name}`) ?? []]] : [...indexGroups.entries()].filter(([key]) => key.startsWith(`${table}.`)).map(([key, actual]) => [key.slice(table.length + 1), actual]);
      const matching = candidates.find(([, values]) => {
        const actual = [...values].sort((left, right) => left.sequence - right.sequence);
        return JSON.stringify(actual.map((item) => item.column)) === JSON.stringify(expectedColumns) && actual.length > 0 && actual.every((item) => item.nonUnique === expectedNonUnique);
      });
      const actual = [...(matching?.[1] ?? candidates[0]?.[1] ?? [])].sort((left, right) => left.sequence - right.sequence);
      return { table, name: name ?? matching?.[0] ?? null, expectedColumns, actualColumns: actual.map((item) => item.column), expectedNonUnique, actualNonUnique: actual[0]?.nonUnique ?? null, ok: Boolean(matching) };
    });
    const foreignKeySet = new Set(foreignKeyRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}>${row.REFERENCED_TABLE_NAME}.${row.REFERENCED_COLUMN_NAME}`));
    const foreignKeyChecks = requiredForeignKeys.map(([table, column, referencedTable, referencedColumn]) => {
      const key = `${table}.${column}>${referencedTable}.${referencedColumn}`;
      return { key, ok: foreignKeySet.has(key) };
    });
    const localMigrationChecksums = new Map(await Promise.all(migrationDefinitions.map(async (definition) => [definition.version, await migrationChecksum(definition.file)])));
    const migrationChecks = migrationDefinitions.map((definition) => {
      const record = migrationRows.find((row) => Number(row.version) === definition.version);
      return { version: definition.version, expectedName: definition.name, recorded: Boolean(record), recordedName: record?.name ?? null, nameMatches: record?.name === definition.name, checksumMatches: record?.checksum === localMigrationChecksums.get(definition.version), appliedAt: record?.applied_at ?? null };
    });
    const admissionsRoles = new Set(admissionsPermissionRows.map((row) => row.role_key));
    const admissionsRequiredRoles = ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN'];
    const admissionsRolePermissions = { requiredRoles: admissionsRequiredRoles, presentRoles: [...admissionsRoles].sort(), missingRoles: admissionsRequiredRoles.filter((role) => !admissionsRoles.has(role)) };
    const releaseSchemaGate = {
      connectedDatabaseMatchesCanonical: database === expectedDatabase,
      migrations040And084RecordedAndChecksummed: migrationChecks.every((check) => check.recorded && check.nameMatches && check.checksumMatches),
      requiredColumnsPresent: Object.values(missingColumns).every((missing) => missing.length === 0),
      requiredIndexesMatch: indexChecks.every((check) => check.ok),
      requiredForeignKeysPresent: foreignKeyChecks.every((check) => check.ok),
      migration084LeadershipPermissionsPresent: admissionsRolePermissions.missingRoles.length === 0
    };
    releaseSchemaGate.ready = Object.values(releaseSchemaGate).every(Boolean);
    const result = {
      ok: true,
      connectedDatabase: database,
      expectedDatabase,
      databaseMatch: database === expectedDatabase,
      select1: true,
      tableInventory: tables,
      missingExpectedTables: expectedTables.filter((table) => !present.has(table)),
      migrationTableCandidates: migrationCandidates.map((row) => row.TABLE_NAME),
      expectedTableColumns: columns,
      authSessionIndexes,
      releaseSchemaGate,
      releaseSchemaChecks: { migrations: migrationChecks, missingColumns, indexes: indexChecks, foreignKeys: foreignKeyChecks, admissionsRolePermissions },
      authenticationExpectation: {
        missingTableFromRuntime: 'users',
        querySource: 'src/auth.js:createAuthService().loginFromDatabase',
        queryTables: ['users', 'user_roles', 'roles', 'role_permissions', 'permissions']
      }
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!releaseSchemaGate.ready) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
