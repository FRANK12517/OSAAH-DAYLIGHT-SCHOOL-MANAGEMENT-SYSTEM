import { lookup } from 'node:dns/promises';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

export const PRODUCTION_DATABASE = 'osaahdaylightschool';
export const REQUIRED_SCHEMA = Object.freeze({
  students: ['id', 'school_id', 'permanent_student_id', 'admission_number', 'current_class_id', 'first_name', 'middle_name', 'last_name', 'full_name', 'gender', 'date_of_birth', 'parent_guardian_name', 'parent_phone', 'admission_type', 'student_status', 'is_test_record'],
  student_profiles: ['id', 'school_id', 'student_master_id', 'student_id', 'permanent_student_id', 'admission_number', 'first_name', 'middle_name', 'surname', 'gender', 'date_of_birth', 'class_id', 'enrollment_status', 'updated_at'],
  student_id_sequences: ['admission_year', 'next_sequence', 'updated_at'],
  student_id_reservations: ['id', 'reservation_token', 'permanent_student_id', 'admission_year', 'sequence_number', 'reservation_status', 'student_id', 'reserved_by', 'created_at', 'consumed_at'],
  student_enrollments: ['id', 'student_id', 'school_id', 'class_id', 'academic_year_id', 'term_id', 'enrollment_status', 'is_current', 'enrolled_at'],
  academic_years: ['id', 'school_id', 'name', 'starts_on'],
  terms: ['id', 'academic_year_id', 'name'],
  classes: ['id', 'school_id', 'name', 'status'],
  admission_applications: ['id', 'school_id', 'student_id', 'permanent_student_id'],
  student_family_contacts: ['id', 'student_id', 'contact_type', 'full_name', 'relationship', 'telephone', 'address', 'email', 'occupation', 'national_id', 'created_at', 'updated_at'],
  student_health_records: ['student_id', 'allergies', 'conditions', 'medications', 'emergency_notes', 'created_at', 'updated_at'],
  parent_student_links: ['parent_user_id', 'student_id', 'permanent_student_id', 'telephone', 'relationship', 'relationship_type', 'link_status'],
  staff: ['id', 'school_id', 'user_id'],
  staff_profiles: ['id', 'school_id', 'staff_id', 'role_key'],
  staff_assignments: ['staff_id', 'class_id', 'subject_id'],
  users: ['id', 'school_id', 'status'],
  user_roles: ['user_id', 'role_id'],
  roles: ['id', 'role_key'],
  permissions: ['id', 'permission_key'],
  role_permissions: ['role_id', 'permission_id']
});
export const REQUIRED_RELATIONSHIPS = Object.freeze([
  ['student_enrollments', 'student_id', 'students', 'id'],
  ['student_enrollments', 'class_id', 'classes', 'id'],
  ['admission_applications', 'student_id', 'student_profiles', 'id'],
  ['parent_student_links', 'parent_user_id', 'users', 'id'],
  ['parent_student_links', 'student_id', 'student_profiles', 'id'],
  ['staff', 'user_id', 'users', 'id'],
  ['staff_assignments', 'staff_id', 'staff_profiles', 'id'],
  ['staff_assignments', 'class_id', 'classes', 'id'],
  ['user_roles', 'user_id', 'users', 'id'],
  ['user_roles', 'role_id', 'roles', 'id'],
  ['role_permissions', 'role_id', 'roles', 'id'],
  ['role_permissions', 'permission_id', 'permissions', 'id']
]);

function parseDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { return { error: 'DATABASE_URL_INVALID' }; }
  if (!['mysql:', 'mysql2:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) return { error: 'DATABASE_URL_INVALID' };
  let database;
  try { database = decodeURIComponent(url.pathname.replace(/^\//, '')); } catch { return { error: 'DATABASE_URL_INVALID' }; }
  if (database !== PRODUCTION_DATABASE) return { error: 'DATABASE_NAME_MISMATCH' };
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'DATABASE_URL_INVALID' };
  return { host: url.hostname, port };
}

function failureCategory(error) {
  const code = String(error?.code ?? '');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(code)) return { code: 'DNS_LOOKUP_FAILED' };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(code)) return { code: 'TCP_CONNECTION_FAILED' };
  if (code === 'ER_ACCESS_DENIED_ERROR' || Number(error?.errno) === 1045) return { code: 'DATABASE_AUTHENTICATION_FAILED', errno: 1045, sqlState: '28000' };
  if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return { code: 'TLS_VERIFICATION_FAILED' };
  return { code: 'DATABASE_PREFLIGHT_FAILED' };
}

function tcpProbe(host, port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
  });
}

function indexContract(indexRows, table, wantedColumns) {
  const groups = new Map();
  for (const item of indexRows.filter((row) => String(row.tableName).toLowerCase() === table && Number(row.nonUnique) === 0)) {
    const key = String(item.indexName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ column: String(item.columnName).toLowerCase(), position: Number(item.position) });
  }
  return [...groups.values()].some((items) => {
    const columns = items.sort((a, b) => a.position - b.position).map((item) => item.column);
    return columns.length === wantedColumns.length && columns.every((column, index) => column === wantedColumns[index]);
  });
}

export async function runProductionTiDBPreflight({
  environment = process.env,
  adapterFactory = createDatabaseAdapter,
  dnsLookup = lookup,
  checkTcp = tcpProbe,
  write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
} = {}) {
  const url = String(environment.DATABASE_URL ?? '').trim();
  if (!url) { const result = { ok: false, mode: 'READ_ONLY_TIDB_PREFLIGHT', stage: 'configuration', error: { code: 'DATABASE_URL_MISSING' } }; write(result); return result; }
  const target = parseDatabaseUrl(url);
  if (target.error) { const result = { ok: false, mode: 'READ_ONLY_TIDB_PREFLIGHT', stage: 'configuration', error: { code: target.error } }; write(result); return result; }
  try { const addresses = await dnsLookup(target.host, { all: true, verbatim: true }); if (!addresses.length) throw Object.assign(new Error(), { code: 'ENOTFOUND' }); }
  catch (error) { const result = { ok: false, mode: 'READ_ONLY_TIDB_PREFLIGHT', stage: 'dns', error: failureCategory(error) }; write(result); return result; }
  try { await checkTcp(target.host, target.port); }
  catch (error) { const result = { ok: false, mode: 'READ_ONLY_TIDB_PREFLIGHT', stage: 'tcp', error: failureCategory(error) }; write(result); return result; }

  let database;
  try {
    database = adapterFactory({ environment: { ...environment, OSAAH_DATABASE_ADAPTER: 'tidb', TIDB_SSL_REJECT_UNAUTHORIZED: 'true' } });
    const identity = (await database.query('SELECT DATABASE() AS databaseName,VERSION() AS serverVersion'))[0] ?? {};
    const databaseMatches = String(identity.databaseName ?? identity.DATABASE_NAME ?? '') === PRODUCTION_DATABASE;
    const tidbIdentified = /tidb/i.test(String(identity.serverVersion ?? identity.SERVER_VERSION ?? ''));
    const tables = await database.query('SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    const columns = await database.query('SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,DATA_TYPE AS dataType,CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    const indexes = await database.query('SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()');
    const duplicateIds = await database.query(`SELECT permanent_student_id AS permanentStudentId,COUNT(*) AS duplicateCount FROM students
      WHERE permanent_student_id IS NOT NULL AND permanent_student_id<>'' GROUP BY permanent_student_id HAVING COUNT(*)>1 LIMIT 20`);
    const foreignKeys = await database.query(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN (${Object.keys(REQUIRED_SCHEMA).map(() => '?').join(',')})`, Object.keys(REQUIRED_SCHEMA));
    const tableSet = new Set(tables.map((row) => String(row.tableName ?? row.TABLE_NAME).toLowerCase()));
    const columnKey = (row) => `${String(row.tableName ?? row.TABLE_NAME).toLowerCase()}.${String(row.columnName ?? row.COLUMN_NAME).toLowerCase()}`;
    const columnSet = new Set(columns.map(columnKey));
    const columnDefinitions = new Map(columns.map((row) => [columnKey(row), { dataType: String(row.dataType ?? row.DATA_TYPE ?? '').toLowerCase(), characterMaximumLength: Number(row.characterMaximumLength ?? row.CHARACTER_MAXIMUM_LENGTH) }]));
    const missingTables = Object.keys(REQUIRED_SCHEMA).filter((table) => !tableSet.has(table));
    const missingColumns = Object.entries(REQUIRED_SCHEMA).flatMap(([table, required]) => required.filter((column) => !columnSet.has(`${table}.${column}`)).map((column) => `${table}.${column}`));
    const permanentIdUniqueIndex = indexContract(indexes.map((row) => ({ tableName: row.tableName ?? row.TABLE_NAME, indexName: row.indexName ?? row.INDEX_NAME, columnName: row.columnName ?? row.COLUMN_NAME, nonUnique: row.nonUnique ?? row.NON_UNIQUE, position: row.position ?? row.SEQ_IN_INDEX })), 'students', ['school_id', 'permanent_student_id']);
    const globalPermanentIdUniqueIndex = indexContract(indexes.map((row) => ({ tableName: row.tableName ?? row.TABLE_NAME, indexName: row.indexName ?? row.INDEX_NAME, columnName: row.columnName ?? row.COLUMN_NAME, nonUnique: row.nonUnique ?? row.NON_UNIQUE, position: row.position ?? row.SEQ_IN_INDEX })), 'students', ['permanent_student_id']);
    const reservationUniqueId = indexContract(indexes.map((row) => ({ tableName: row.tableName ?? row.TABLE_NAME, indexName: row.indexName ?? row.INDEX_NAME, columnName: row.columnName ?? row.COLUMN_NAME, nonUnique: row.nonUnique ?? row.NON_UNIQUE, position: row.position ?? row.SEQ_IN_INDEX })), 'student_id_reservations', ['permanent_student_id']);
    const enrollmentContextUniqueIndex = indexContract(indexes.map((row) => ({ tableName: row.tableName ?? row.TABLE_NAME, indexName: row.indexName ?? row.INDEX_NAME, columnName: row.columnName ?? row.COLUMN_NAME, nonUnique: row.nonUnique ?? row.NON_UNIQUE, position: row.position ?? row.SEQ_IN_INDEX })), 'student_enrollments', ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current']);
    const identityColumns = ['students.permanent_student_id', 'student_profiles.student_id', 'student_profiles.permanent_student_id', 'student_id_reservations.permanent_student_id', 'admission_applications.permanent_student_id'];
    const invalidIdentityColumns = identityColumns.filter((key) => {
      const definition = columnDefinitions.get(key);
      return !definition || !['char', 'varchar'].includes(definition.dataType) || !Number.isFinite(definition.characterMaximumLength) || definition.characterMaximumLength < 16;
    });
    const observedRelationships = foreignKeys.map((row) => ({ table: String(row.tableName ?? row.TABLE_NAME), column: String(row.columnName ?? row.COLUMN_NAME), referencedTable: String(row.referencedTable ?? row.REFERENCED_TABLE_NAME), referencedColumn: String(row.referencedColumn ?? row.REFERENCED_COLUMN_NAME) }));
    const relationshipSet = new Set(observedRelationships.map((item) => `${item.table.toLowerCase()}.${item.column.toLowerCase()}->${item.referencedTable.toLowerCase()}.${item.referencedColumn.toLowerCase()}`));
    const missingRelationships = REQUIRED_RELATIONSHIPS.map(([table, column, referencedTable, referencedColumn]) => `${table}.${column}->${referencedTable}.${referencedColumn}`).filter((relationship) => !relationshipSet.has(relationship.toLowerCase()));
    const duplicatePermanentIds = duplicateIds.map((row) => ({ duplicateCount: Number(row.duplicateCount ?? row.DUPLICATECOUNT ?? row.duplicate_count ?? 0) }));
    const schemaReady = missingTables.length === 0 && missingColumns.length === 0 && invalidIdentityColumns.length === 0 && missingRelationships.length === 0 && permanentIdUniqueIndex && globalPermanentIdUniqueIndex && reservationUniqueId && enrollmentContextUniqueIndex && duplicatePermanentIds.length === 0;
    const ok = databaseMatches && tidbIdentified && schemaReady;
    const result = {
      ok,
      mode: 'READ_ONLY_TIDB_PREFLIGHT',
      stage: 'complete',
      releaseCommit: String(environment.GITHUB_SHA ?? environment.OSAAH_RELEASE_COMMIT ?? '').trim() || null,
      targetDatabase: PRODUCTION_DATABASE,
      connectivity: { dnsResolved: true, tcpConnected: true, authenticated: true, databaseMatches, tidbIdentified },
      schema: { ready: schemaReady, missingTables, missingColumns, invalidIdentityColumns, missingRelationships, duplicatePermanentIds, duplicatePermanentIdCount: duplicatePermanentIds.length, requiredIndexes: { permanentIdUniqueIndex, globalPermanentIdUniqueIndex, reservationUniqueId, enrollmentContextUniqueIndex }, requiredTableCount: Object.keys(REQUIRED_SCHEMA).length, observedRelationships },
      writesPerformed: false
    };
    write(result);
    return result;
  } catch (error) {
    const result = { ok: false, mode: 'READ_ONLY_TIDB_PREFLIGHT', stage: 'database', error: failureCategory(error), writesPerformed: false };
    write(result);
    return result;
  } finally { try { await database?.close?.(); } catch { /* Do not emit driver details. */ } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runProductionTiDBPreflight();
  if (!result.ok) process.exitCode = 1;
}
