export const TIDB_READINESS_DATABASE = 'osaahdaylightschool';
export const TIDB_ISOLATION_APPROVAL_VARIABLE = 'OSAAH_TIDB_TARGET_ISOLATION_APPROVAL';
export const TIDB_ISOLATION_APPROVAL_VALUE = 'ISOLATED_TEST_TARGET_CONFIRMED';

export const TIDB_READINESS_REQUIRED_TABLE_COLUMNS = Object.freeze({
  schools: ['id'],
  users: ['id', 'school_id', 'phone', 'status'],
  roles: ['id', 'school_id', 'role_key'],
  user_roles: ['user_id', 'role_id'],
  parent_student_links: ['parent_user_id', 'student_id', 'link_status'],
  student_profiles: ['id', 'school_id', 'student_master_id', 'student_id', 'admission_number', 'first_name', 'surname', 'enrollment_status'],
  students: ['id', 'school_id', 'permanent_student_id', 'admission_number', 'first_name', 'last_name', 'student_status', 'is_test_record'],
  auth_sessions: ['id', 'user_id', 'school_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at', 'last_used_at'],
  parent_auth_rate_limits: ['bucket_hash', 'window_started_at', 'request_count', 'updated_at'],
  classes: ['id', 'school_id', 'name'],
  academic_years: ['id', 'school_id', 'name', 'is_current'],
  terms: ['id', 'academic_year_id', 'name', 'is_current'],
  student_enrollments: ['student_id', 'school_id', 'class_id', 'academic_year_id', 'term_id', 'enrollment_status', 'is_current', 'enrolled_at'],
  student_attendance: ['school_id', 'student_id', 'attendance_date', 'status', 'academic_year', 'term', 'class_id'],
  academic_score_records: ['school_id', 'student_id', 'academic_year_id', 'term_id', 'class_id', 'record_type', 'total_score'],
  invoices: ['school_id', 'student_id', 'invoice_number', 'balance', 'status'],
  payments: ['school_id', 'student_id', 'invoice_id', 'receipt_number', 'amount', 'status'],
  announcements: ['school_id', 'title', 'body', 'audience', 'created_at'],
  messages: ['school_id', 'sender_id', 'recipient_id', 'student_id', 'body', 'status'],
  academic_calendar_events: ['school_id', 'academic_year', 'term', 'title', 'category', 'start_date', 'end_date', 'audience_json', 'class_scope_json', 'status'],
  assignments: ['id', 'school_id', 'academic_year_id', 'term_id', 'class_id', 'title', 'recipient_student_ids', 'status', 'published_at'],
  assignment_files: ['assignment_id', 'school_id', 'file_name', 'mime_type', 'file_size', 'storage_reference'],
  student_class_history: ['student_id', 'class_id', 'academic_year_id', 'reason', 'effective_at']
});

// These contracts come from schema migrations 001, 003, 026, 031, 032, 052,
// 054, 078, and the currently untracked 082 parent-login rate-limit contract.
// Match index columns and uniqueness rather than relying on server-generated
// names, except for indexes whose names are explicit migration contracts.
export const TIDB_READINESS_REQUIRED_INDEXES = Object.freeze({
  auth_sessions: [
    { label: 'UNIQUE(token_hash)', columns: ['token_hash'], unique: true },
    { label: 'idx_auth_sessions_user_active', name: 'idx_auth_sessions_user_active', columns: ['user_id', 'revoked_at', 'expires_at'] },
    { label: 'idx_auth_sessions_school', name: 'idx_auth_sessions_school', columns: ['school_id'] },
    { label: 'idx_auth_sessions_expiry', name: 'idx_auth_sessions_expiry', columns: ['expires_at', 'revoked_at'] }
  ],
  roles: [{ label: 'UNIQUE(school_id, role_key)', columns: ['school_id', 'role_key'], unique: true }],
  user_roles: [
    { label: 'PRIMARY(user_id, role_id)', name: 'PRIMARY', columns: ['user_id', 'role_id'], unique: true },
    { label: 'idx_user_roles_role_user', name: 'idx_user_roles_role_user', columns: ['role_id', 'user_id'] }
  ],
  parent_student_links: [
    { label: 'PRIMARY(parent_user_id, student_id)', name: 'PRIMARY', columns: ['parent_user_id', 'student_id'], unique: true },
    { label: 'idx_parent_student_links_parent', name: 'idx_parent_student_links_parent', columns: ['parent_user_id', 'student_id'] }
  ],
  student_profiles: [
    { label: 'idx_student_profiles_master_school', name: 'idx_student_profiles_master_school', columns: ['school_id', 'student_master_id'] },
    { label: 'idx_student_profiles_student_id_school', name: 'idx_student_profiles_student_id_school', columns: ['school_id', 'student_id'] }
  ],
  student_enrollments: [
    { label: 'idx_student_enrollments_durable_scope', name: 'idx_student_enrollments_durable_scope', columns: ['school_id', 'academic_year_id', 'class_id', 'is_current', 'enrollment_status'] },
    { label: 'uq_student_enrollment_context', name: 'uq_student_enrollment_context', columns: ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current'], unique: true }
  ],
  parent_auth_rate_limits: [{ label: 'PRIMARY(bucket_hash)', name: 'PRIMARY', columns: ['bucket_hash'], unique: true }]
});

// Deliberately excludes user_roles.role_id and student_profiles.student_master_id:
// the reviewed deployed contract does not declare those foreign keys.
export const TIDB_READINESS_REQUIRED_FOREIGN_KEYS = Object.freeze({
  users: [{ column: 'school_id', referencedTable: 'schools', referencedColumn: 'id' }],
  students: [{ column: 'school_id', referencedTable: 'schools', referencedColumn: 'id' }],
  student_profiles: [{ column: 'school_id', referencedTable: 'schools', referencedColumn: 'id' }],
  user_roles: [{ column: 'user_id', referencedTable: 'users', referencedColumn: 'id' }],
  parent_student_links: [
    { column: 'parent_user_id', referencedTable: 'users', referencedColumn: 'id' },
    { column: 'student_id', referencedTable: 'student_profiles', referencedColumn: 'id' }
  ],
  student_enrollments: [
    { column: 'student_id', referencedTable: 'students', referencedColumn: 'id' },
    { column: 'class_id', referencedTable: 'classes', referencedColumn: 'id' },
    { column: 'academic_year_id', referencedTable: 'academic_years', referencedColumn: 'id' },
    { column: 'term_id', referencedTable: 'terms', referencedColumn: 'id' }
  ],
  auth_sessions: [
    { column: 'user_id', referencedTable: 'users', referencedColumn: 'id' },
    { column: 'school_id', referencedTable: 'schools', referencedColumn: 'id' }
  ]
});

const rows = (value) => Array.isArray(value) ? value : [];
const tlsNotChecked = () => ({ status: 'NOT_CHECKED', enabled: null, version: null, cipher: null, minimumVersion: 'TLSv1.2', certificateVerification: 'STRICT_CLIENT_POLICY' });
const failure = (status, code, checks = []) => ({
  status,
  code,
  database: TIDB_READINESS_DATABASE,
  engine: null,
  serverVersion: null,
  connectionStatus: 'NOT_ATTEMPTED',
  tls: tlsNotChecked(),
  isolationApproved: true,
  schema: {
    status: 'NOT_CHECKED', checks,
    indexes: { status: 'NOT_CHECKED', checks: [] },
    foreignKeys: { status: 'NOT_CHECKED', supportLevel: 'UNVERIFIED', checks: [] }
  }
});

function tidbVersionTuple(version) {
  const match = String(version ?? '').match(/tidb[- ]v?(\d+)\.(\d+)\.(\d+)/i);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

function indexGroups(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const name = String(row.indexName ?? row.INDEX_NAME ?? '').toLowerCase();
    const column = String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase();
    if (!name || !column) continue;
    if (!grouped.has(name)) grouped.set(name, { name, unique: Number(row.nonUnique ?? row.NON_UNIQUE) === 0, columns: [] });
    grouped.get(name).columns[Number(row.sequence ?? row.SEQ_IN_INDEX ?? 0) - 1] = column;
  }
  return [...grouped.values()].map((index) => ({ ...index, columns: index.columns.filter(Boolean) }));
}

function indexSatisfies(actual, expected) {
  return (!expected.name || actual.name === expected.name.toLowerCase())
    && (!Object.hasOwn(expected, 'unique') || actual.unique === expected.unique)
    && actual.columns.length === expected.columns.length
    && actual.columns.every((column, index) => column === expected.columns[index].toLowerCase());
}

export function validateTiDBReadinessPreconditions({ environment = process.env, expectedDatabase = TIDB_READINESS_DATABASE } = {}) {
  if (environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production') return failure('REFUSED', 'PRODUCTION_ENVIRONMENT_REFUSED', []);
  if (environment[TIDB_ISOLATION_APPROVAL_VARIABLE] !== TIDB_ISOLATION_APPROVAL_VALUE) return { ...failure('REFUSED', 'ISOLATED_TARGET_APPROVAL_REQUIRED', []), isolationApproved: false };
  if (environment.OSAAH_DATABASE_ADAPTER !== 'tidb') return failure('REFUSED', 'EXPLICIT_TIDB_SELECTION_REQUIRED', []);
  if (expectedDatabase !== TIDB_READINESS_DATABASE) return failure('REFUSED', 'EXPECTED_DATABASE_MUST_MATCH', []);
  return null;
}

export async function verifyTiDBTarget({ database, environment = process.env, expectedDatabase = TIDB_READINESS_DATABASE } = {}) {
  const preconditionFailure = validateTiDBReadinessPreconditions({ environment, expectedDatabase });
  if (preconditionFailure) return preconditionFailure;
  if (!database || database.dialect !== 'tidb' || typeof database.query !== 'function' || typeof database.close !== 'function') {
    return failure('REFUSED', 'TIDB_ADAPTER_REQUIRED', []);
  }

  let identity;
  try {
    identity = rows(await database.query('SELECT VERSION() AS serverVersion, DATABASE() AS databaseName', []))[0];
  } catch {
    return failure('CONNECTION_FAILED', 'READ_ONLY_IDENTITY_QUERY_FAILED', []);
  }
  const serverVersion = String(identity?.serverVersion ?? '');
  const databaseName = String(identity?.databaseName ?? '');
  if (!/tidb/i.test(serverVersion)) return { ...failure('IDENTITY_FAILED', 'SERVER_NOT_IDENTIFIED_AS_TIDB', []), serverVersion: null };
  if (databaseName !== expectedDatabase) return { ...failure('IDENTITY_FAILED', 'DATABASE_NAME_MISMATCH', []), engine: 'TiDB', serverVersion };

  let tlsStatusRows;
  try {
    tlsStatusRows = rows(await database.query("SHOW SESSION STATUS LIKE 'Ssl%'", []));
  } catch {
    return {
      ...failure('TLS_CHECK_UNVERIFIED', 'TLS_SESSION_STATUS_UNAVAILABLE', []),
      database: expectedDatabase, engine: 'TiDB', serverVersion, connectionStatus: 'VERIFIED'
    };
  }
  const tlsValues = new Map(tlsStatusRows.map((row) => [
    String(row.Variable_name ?? row.variable_name ?? row.Name ?? row.name ?? '').toLowerCase(),
    String(row.Value ?? row.value ?? '')
  ]));
  if (!tlsValues.has('ssl_version') || !tlsValues.has('ssl_cipher')) {
    return {
      ...failure('TLS_CHECK_UNVERIFIED', 'TLS_STATUS_VARIABLES_UNAVAILABLE', []),
      database: expectedDatabase, engine: 'TiDB', serverVersion, connectionStatus: 'VERIFIED'
    };
  }
  const tlsVersion = tlsValues.get('ssl_version') ?? '';
  const tlsCipher = tlsValues.get('ssl_cipher') ?? '';
  const tlsVersionSupported = /^(?:TLSv1\.2|TLSv1\.3)$/i.test(tlsVersion);
  const tls = {
    status: tlsVersionSupported && tlsCipher ? 'VERIFIED' : 'FAILED',
    enabled: Boolean(tlsVersion && tlsCipher),
    version: tlsVersion || null,
    cipher: /^[A-Za-z0-9_:+-]{1,128}$/.test(tlsCipher) ? tlsCipher : null,
    minimumVersion: 'TLSv1.2',
    certificateVerification: 'STRICT_CLIENT_POLICY',
    customCaProvided: Boolean(environment.TIDB_CA_CERT?.trim())
  };
  if (tls.status !== 'VERIFIED') {
    return {
      ...failure('TLS_VERIFICATION_FAILED', 'TLS_NOT_NEGOTIATED_OR_BELOW_MINIMUM', []),
      database: expectedDatabase, engine: 'TiDB', serverVersion, connectionStatus: 'VERIFIED', tls
    };
  }

  const checks = [];
  for (const [tableName, requiredColumns] of Object.entries(TIDB_READINESS_REQUIRED_TABLE_COLUMNS)) {
    let actualColumns;
    try {
      actualColumns = rows(await database.query(
        'SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
        [tableName]
      )).map((row) => String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase()).filter(Boolean);
    } catch {
      checks.push({ table: tableName, status: 'NOT_CHECKED', missingColumns: [] });
      return { status: 'SCHEMA_CHECK_UNVERIFIED', code: 'COLUMN_METADATA_QUERY_UNVERIFIED', database: expectedDatabase, engine: 'TiDB', serverVersion, connectionStatus: 'VERIFIED', tls, isolationApproved: true, schema: { status: 'UNVERIFIED', checks, indexes: { status: 'NOT_CHECKED', checks: [] }, foreignKeys: { status: 'NOT_CHECKED', supportLevel: 'UNVERIFIED', checks: [] } } };
    }
    const columns = new Set(actualColumns);
    const missingColumns = requiredColumns.filter((column) => !columns.has(column.toLowerCase()));
    checks.push({ table: tableName, status: missingColumns.length ? 'MISSING' : 'OK', missingColumns });
  }

  const indexChecks = [];
  let indexMetadataUnavailable = false;
  for (const [tableName, requirements] of Object.entries(TIDB_READINESS_REQUIRED_INDEXES)) {
    let actualIndexes;
    try {
      actualIndexes = indexGroups(rows(await database.query(
        'SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
        [tableName]
      )));
    } catch {
      indexMetadataUnavailable = true;
      indexChecks.push({ table: tableName, status: 'UNVERIFIED', missingIndexes: [] });
      continue;
    }
    const missingIndexes = requirements.filter((required) => !actualIndexes.some((actual) => indexSatisfies(actual, required))).map(({ label }) => label);
    indexChecks.push({ table: tableName, status: missingIndexes.length ? 'MISSING' : 'OK', missingIndexes });
  }

  const versionTuple = tidbVersionTuple(serverVersion);
  let foreignKeyChecks = [];
  let foreignKeyStatus = 'UNVERIFIED';
  let foreignKeySupportLevel = 'UNVERIFIED';
  let foreignKeyMetadataUnavailable = false;
  if (versionTuple && versionAtLeast(versionTuple, [6, 6, 0])) {
    foreignKeySupportLevel = versionAtLeast(versionTuple, [8, 5, 0]) ? 'GENERALLY_AVAILABLE' : 'EXPERIMENTAL';
    foreignKeyStatus = 'OK';
    for (const [tableName, requirements] of Object.entries(TIDB_READINESS_REQUIRED_FOREIGN_KEYS)) {
      let actualKeys;
      try {
        actualKeys = rows(await database.query(
          'SELECT COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL',
          [tableName]
        ));
      } catch {
        foreignKeyMetadataUnavailable = true;
        foreignKeyChecks.push({ table: tableName, status: 'UNVERIFIED', missingForeignKeys: [] });
        continue;
      }
      let definitionText = '';
      try {
        const definitionRows = rows(await database.query(`SHOW CREATE TABLE \`${tableName}\``, []));
        const definitionRow = definitionRows[0] ?? {};
        definitionText = String(Object.entries(definitionRow).find(([key]) => key.toLowerCase() === 'create table')?.[1] ?? '');
      } catch {
        foreignKeyMetadataUnavailable = true;
        foreignKeyChecks.push({ table: tableName, status: 'UNVERIFIED', missingForeignKeys: [] });
        continue;
      }
      if (!definitionText) {
        foreignKeyMetadataUnavailable = true;
        foreignKeyChecks.push({ table: tableName, status: 'UNVERIFIED', missingForeignKeys: [] });
        continue;
      }
      const invalidForeignKeys = /FOREIGN KEY INVALID/i.test(definitionText);
      const missingForeignKeys = requirements.filter((required) => !actualKeys.some((actual) =>
        String(actual.columnName ?? actual.COLUMN_NAME ?? '').toLowerCase() === required.column
        && String(actual.referencedTable ?? actual.REFERENCED_TABLE_NAME ?? '').toLowerCase() === required.referencedTable
        && String(actual.referencedColumn ?? actual.REFERENCED_COLUMN_NAME ?? '').toLowerCase() === required.referencedColumn
      )).map(({ column, referencedTable, referencedColumn }) => `${column}->${referencedTable}.${referencedColumn}`);
      if (invalidForeignKeys && !missingForeignKeys.includes('INVALID_FOREIGN_KEY_DEFINITION')) missingForeignKeys.push('INVALID_FOREIGN_KEY_DEFINITION');
      foreignKeyChecks.push({ table: tableName, status: missingForeignKeys.length ? 'MISSING' : 'OK', missingForeignKeys });
    }
    if (foreignKeyMetadataUnavailable) foreignKeyStatus = 'UNVERIFIED';
    else if (foreignKeyChecks.some((check) => check.status === 'MISSING')) foreignKeyStatus = 'MISSING';
  }

  const columnMissing = checks.some((check) => check.status !== 'OK');
  const indexMissing = indexChecks.some((check) => check.status === 'MISSING');
  const foreignKeyMissing = foreignKeyChecks.some((check) => check.status === 'MISSING');
  const metadataUnverified = indexMetadataUnavailable || foreignKeyMetadataUnavailable || foreignKeyStatus === 'UNVERIFIED';
  const missing = columnMissing || indexMissing || foreignKeyMissing;
  const schemaStatus = missing ? 'FAILED' : metadataUnverified ? 'UNVERIFIED' : 'OK';
  return {
    status: missing ? 'SCHEMA_CHECK_FAILED' : metadataUnverified ? 'SCHEMA_CHECK_UNVERIFIED' : 'READY_FOR_AUTHENTICATION_TESTS',
    code: missing ? 'REQUIRED_SCHEMA_OBJECT_MISSING' : metadataUnverified ? 'SCHEMA_METADATA_UNVERIFIED' : null,
    database: expectedDatabase,
    engine: 'TiDB',
    serverVersion,
    connectionStatus: 'VERIFIED',
    tls,
    isolationApproved: true,
    schema: {
      status: schemaStatus,
      checks,
      indexes: { status: indexMetadataUnavailable ? 'UNVERIFIED' : indexMissing ? 'FAILED' : 'OK', checks: indexChecks },
      foreignKeys: {
        status: foreignKeyStatus === 'MISSING' ? 'FAILED' : foreignKeyStatus,
        supportLevel: foreignKeySupportLevel,
        checks: foreignKeyChecks
      }
    }
  };
}
