import { pathToFileURL } from 'node:url';
import { EXPECTED_ADMISSIONS_078_COLUMNS, columnDefinitionMismatch } from './admissions-078-schema-contract.mjs';

const expectedDatabase = 'osaahdaylightschool';
const migrationName = '078_admissions_leadership_access.sql';
const status = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_CHECKED: 'NOT_CHECKED' });
const expectedIndexes = [
  { table: 'admission_applications', name: 'uq_admission_applications_enquiry_request', columns: ['school_id', 'enquiry_request_id'] },
  { table: 'admission_applications', name: 'uq_admission_application_student_id', columns: ['student_id'] },
  { table: 'admission_applications', name: 'uq_admission_application_permanent_student_id', columns: ['school_id', 'permanent_student_id'] },
  { table: 'student_enrollments', name: 'uq_student_enrollment_context', columns: ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current'] }
];

const safeError = (error) => ({ code: error?.code ?? 'ADMISSIONS_PREFLIGHT_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null });
const keyFor = (table, column) => `${table}.${column}`.toLowerCase();
const schemaMissing = (tables, columns, prerequisites) => prerequisites.filter(([table, column]) => !tables.has(table) || !columns.has(keyFor(table, column))).map(([table, column]) => keyFor(table, column));
const queryCount = (row, field) => row?.[field] !== null && row?.[field] !== undefined && String(row[field]).trim() !== '' && Number.isSafeInteger(Number(row[field])) && Number(row[field]) >= 0 ? Number(row[field]) : null;

const duplicateChecks = [
  { name: 'application_student_identity', mandatory: true, prerequisites: [['admission_applications', 'student_id']], sql: '/* admission-preflight:application_student_identity */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT student_id FROM admission_applications WHERE student_id IS NOT NULL GROUP BY student_id HAVING COUNT(*)>1) d' },
  { name: 'enrollment_context', mandatory: true, prerequisites: [['student_enrollments', 'school_id'], ['student_enrollments', 'student_id'], ['student_enrollments', 'academic_year_id'], ['student_enrollments', 'term_id'], ['student_enrollments', 'is_current']], sql: '/* admission-preflight:enrollment_context */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,student_id,academic_year_id,term_id,is_current FROM student_enrollments WHERE term_id IS NOT NULL GROUP BY school_id,student_id,academic_year_id,term_id,is_current HAVING COUNT(*)>1) d' },
  { name: 'student_permanent_id', mandatory: true, prerequisites: [['students', 'school_id'], ['students', 'permanent_student_id']], sql: '/* admission-preflight:student_permanent_id */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,permanent_student_id FROM students WHERE permanent_student_id IS NOT NULL GROUP BY school_id,permanent_student_id HAVING COUNT(*)>1) d' },
  { name: 'profile_student_id', mandatory: true, prerequisites: [['student_profiles', 'school_id'], ['student_profiles', 'student_master_id'], ['student_profiles', 'student_id']], sql: '/* admission-preflight:profile_student_id */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,student_id FROM student_profiles WHERE student_id IS NOT NULL GROUP BY school_id,student_id HAVING COUNT(*)>1) d' },
  { name: 'enquiry_retry_identity', mandatory: false, prerequisites: [['admission_applications', 'school_id'], ['admission_applications', 'enquiry_request_id']], sql: '/* admission-preflight:enquiry_retry_identity */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,enquiry_request_id FROM admission_applications WHERE enquiry_request_id IS NOT NULL GROUP BY school_id,enquiry_request_id HAVING COUNT(*)>1) d' },
  { name: 'application_permanent_student_identity', mandatory: false, prerequisites: [['admission_applications', 'school_id'], ['admission_applications', 'permanent_student_id']], sql: '/* admission-preflight:application_permanent_student_identity */ SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,permanent_student_id FROM admission_applications WHERE permanent_student_id IS NOT NULL GROUP BY school_id,permanent_student_id HAVING COUNT(*)>1) d' }
];

const orphanChecks = [
  { name: 'admission_application_students', mandatory: true, prerequisites: [['admission_applications', 'student_id'], ['admission_applications', 'school_id'], ['students', 'id'], ['students', 'school_id']], sql: '/* admission-preflight:admission_application_students */ SELECT COUNT(*) AS orphan_count FROM admission_applications a LEFT JOIN students s ON s.id=a.student_id WHERE a.student_id IS NOT NULL AND (s.id IS NULL OR s.school_id<>a.school_id)' },
  { name: 'student_profile_master', mandatory: true, prerequisites: [['student_profiles', 'student_master_id'], ['student_profiles', 'school_id'], ['students', 'id'], ['students', 'school_id']], sql: '/* admission-preflight:student_profile_master */ SELECT COUNT(*) AS orphan_count FROM student_profiles sp LEFT JOIN students s ON s.id=sp.student_master_id WHERE sp.student_master_id IS NOT NULL AND (s.id IS NULL OR s.school_id<>sp.school_id)' },
  { name: 'student_enrollment_students', mandatory: true, prerequisites: [['student_enrollments', 'student_id'], ['student_enrollments', 'school_id'], ['students', 'id'], ['students', 'school_id']], sql: '/* admission-preflight:student_enrollment_students */ SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN students s ON s.id=e.student_id WHERE s.id IS NULL OR s.school_id<>e.school_id' },
  { name: 'student_enrollment_classes', mandatory: true, prerequisites: [['student_enrollments', 'class_id'], ['classes', 'id']], sql: '/* admission-preflight:student_enrollment_classes */ SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN classes c ON c.id=e.class_id WHERE c.id IS NULL' },
  { name: 'student_enrollment_academic_years', mandatory: true, prerequisites: [['student_enrollments', 'academic_year_id'], ['student_enrollments', 'school_id'], ['academic_years', 'id'], ['academic_years', 'school_id']], sql: '/* admission-preflight:student_enrollment_academic_years */ SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN academic_years y ON y.id=e.academic_year_id WHERE y.id IS NULL OR y.school_id<>e.school_id' },
  { name: 'student_enrollment_terms', mandatory: true, prerequisites: [['student_enrollments', 'term_id'], ['student_enrollments', 'academic_year_id'], ['terms', 'id'], ['terms', 'academic_year_id']], sql: '/* admission-preflight:student_enrollment_terms */ SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN terms t ON t.id=e.term_id WHERE e.term_id IS NOT NULL AND (t.id IS NULL OR t.academic_year_id<>e.academic_year_id)' },
  { name: 'parent_student_links', mandatory: true, prerequisites: [['parent_student_links', 'parent_user_id'], ['parent_student_links', 'student_id'], ['users', 'id'], ['users', 'school_id'], ['student_profiles', 'id'], ['student_profiles', 'school_id']], sql: '/* admission-preflight:parent_student_links */ SELECT COUNT(*) AS orphan_count FROM parent_student_links p LEFT JOIN users u ON u.id=p.parent_user_id LEFT JOIN student_profiles sp ON sp.id=p.student_id WHERE u.id IS NULL OR sp.id IS NULL OR u.school_id<>sp.school_id' }
];

export async function evaluateCheck(pool, check, tables, columns, countField) {
  const missingPrerequisites = schemaMissing(tables, columns, check.prerequisites);
  if (missingPrerequisites.length) return { name: check.name, mandatory: check.mandatory, status: status.NOT_CHECKED, category: 'MISSING_SCHEMA_PREREQUISITES', reason: `Missing: ${missingPrerequisites.join(', ')}`, missingPrerequisites, count: null };
  try {
    const [[row]] = await pool.query(check.sql);
    const count = queryCount(row, countField);
    if (count === null) return { name: check.name, mandatory: check.mandatory, status: status.NOT_CHECKED, category: 'INVALID_QUERY_RESULT', reason: `The read-only query did not return a valid ${countField} count.`, missingPrerequisites: [], count: null };
    return { name: check.name, mandatory: check.mandatory, status: count === 0 ? status.PASS : status.FAIL, category: count === 0 ? 'NONE' : 'INTEGRITY_VIOLATION', reason: null, missingPrerequisites: [], count };
  } catch (error) { return { name: check.name, mandatory: check.mandatory, status: status.NOT_CHECKED, category: 'READ_ONLY_QUERY_FAILED', reason: `Read-only query failed (${safeError(error).code}).`, missingPrerequisites: [], count: null }; }
}

export async function runAdmissionWorkflowPreflight({ pool, databaseName = expectedDatabase }) {
  const [[database]] = await pool.query('SELECT DATABASE() AS database_name');
  if (database?.database_name !== databaseName) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
  const [[versionRow]] = await pool.query('SELECT VERSION() AS server_version');
  const serverVersion = String(versionRow?.server_version ?? 'unknown');
  const isTiDB = /tidb/i.test(serverVersion);
  const [tableRows] = await pool.query('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const [columnRows] = await pool.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
  const [indexRows] = await pool.query("SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('admission_applications','student_enrollments') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX");
  const tableTypes = new Map(tableRows.map((row) => [String(row.TABLE_NAME).toLowerCase(), String(row.TABLE_TYPE ?? '').toUpperCase()]));
  const tables = new Set(tableTypes.keys());
  const columns = new Set(columnRows.map((row) => keyFor(row.TABLE_NAME, row.COLUMN_NAME)));
  const columnMetadata = new Map(columnRows.map((row) => [keyFor(row.TABLE_NAME, row.COLUMN_NAME), { type: String(row.COLUMN_TYPE ?? '').toLowerCase(), nullable: String(row.IS_NULLABLE ?? '').toUpperCase() }]));
  const canonicalRequirements = { admission_applications: ['id', 'school_id', 'student_id', 'application_number', 'stage', 'applicant_data'], student_enrollments: ['school_id', 'student_id', 'class_id', 'academic_year_id', 'term_id', 'is_current'], students: ['id', 'school_id', 'permanent_student_id'], student_profiles: ['id', 'school_id', 'student_master_id', 'student_id'], classes: ['id'], academic_years: ['id', 'school_id'], terms: ['id', 'academic_year_id'], student_id_sequences: ['admission_year', 'next_sequence'], parent_student_links: ['parent_user_id', 'student_id', 'link_status'], users: ['id', 'school_id'], roles: ['id', 'school_id', 'role_key'], permissions: ['id', 'permission_key'], role_permissions: ['role_id', 'permission_id'] };
  const missingPrerequisites = Object.entries(canonicalRequirements).flatMap(([table, requiredColumns]) => !tables.has(table) ? [`${table}.*`] : requiredColumns.filter((column) => !columns.has(keyFor(table, column))).map((column) => keyFor(table, column)));
  const schemaObjectFindings = Object.entries(canonicalRequirements).flatMap(([table, requiredColumns]) => { const missingColumns = requiredColumns.filter((column) => !columns.has(keyFor(table, column))); return tables.has(table) && !missingColumns.length ? [] : [{ table, tableStatus: tables.has(table) ? 'PRESENT' : 'MISSING', tableType: tableTypes.get(table) ?? 'MISSING', missingColumns }]; });
  const columnDefinitionMismatches = EXPECTED_ADMISSIONS_078_COLUMNS.flatMap(({ table, name }) => { const mismatch = columnDefinitionMismatch(table, name, columnMetadata.get(keyFor(table, name))); return mismatch ? [mismatch] : []; });
  const indexGroups = new Map();
  for (const row of indexRows) { const key = `${String(row.TABLE_NAME).toLowerCase()}.${String(row.INDEX_NAME)}`; const group = indexGroups.get(key) ?? []; group.push({ column: String(row.COLUMN_NAME).toLowerCase(), sequence: Number(row.SEQ_IN_INDEX), nonUnique: Number(row.NON_UNIQUE) }); indexGroups.set(key, group); }
  const indexDefinitionMismatches = expectedIndexes.filter(({ table, name, columns: expected }) => { const actual = indexGroups.get(`${table}.${name}`); return actual && (actual.some((column) => column.nonUnique !== 0) || JSON.stringify(actual.map((column) => column.column)) !== JSON.stringify(expected)); }).map(({ table, name }) => `${table}.${name}`);
  const duplicateChecksResult = await Promise.all(duplicateChecks.map((check) => evaluateCheck(pool, check, tables, columns, 'duplicate_groups')));
  const orphanChecksResult = await Promise.all(orphanChecks.map((check) => evaluateCheck(pool, check, tables, columns, 'orphan_count')));
  const [sequences] = tables.has('student_id_sequences') && columns.has('student_id_sequences.admission_year') && columns.has('student_id_sequences.next_sequence') ? await pool.query('SELECT admission_year,next_sequence FROM student_id_sequences ORDER BY admission_year') : [[]];
  const idSources = [];
  if (columns.has('students.permanent_student_id')) idSources.push("SELECT permanent_student_id AS student_id FROM students WHERE permanent_student_id LIKE 'OSAAH/%'");
  if (columns.has('student_profiles.student_id')) idSources.push("SELECT student_id FROM student_profiles WHERE student_id LIKE 'OSAAH/%'");
  let existingIds = [];
  for (const sql of idSources) { const [rows] = await pool.query(sql); existingIds.push(...rows); }
  const maxima = new Map(); let malformedStudentIds = 0;
  for (const row of existingIds) { const id = String(row.student_id ?? ''); const match = /^OSAAH\/(\d{4})\/(\d+)$/.exec(id); if (!match || Number(match[2]) < 1 || !Number.isSafeInteger(Number(match[2]))) { malformedStudentIds += 1; continue; } maxima.set(match[1], Math.max(maxima.get(match[1]) ?? 0, Number(match[2]))); }
  const annualSequenceReconciliation = [...maxima].sort(([a], [b]) => a.localeCompare(b)).map(([year, maxAllocated]) => { const counter = sequences.find((row) => String(row.admission_year) === year); return { year, maxAllocated, nextSequence: counter ? Number(counter.next_sequence) : null, counterBehind: counter ? Number(counter.next_sequence) <= maxAllocated : true }; });
  const invalidSequenceYears = sequences.filter((row) => !/^\d{4}$/.test(String(row.admission_year)) || !Number.isSafeInteger(Number(row.next_sequence)) || Number(row.next_sequence) < 1).map((row) => String(row.admission_year));
  const counterBehindYears = annualSequenceReconciliation.filter((entry) => entry.counterBehind).map((entry) => entry.year);
  const sequenceStatus = !tables.has('student_id_sequences') || !columns.has('student_id_sequences.admission_year') || !columns.has('student_id_sequences.next_sequence') ? { status: status.NOT_CHECKED, category: 'MISSING_SCHEMA_PREREQUISITES', reason: 'Missing student_id_sequences.admission_year or student_id_sequences.next_sequence.' } : malformedStudentIds || invalidSequenceYears.length || counterBehindYears.length ? { status: status.FAIL, category: 'SEQUENCE_INTEGRITY_VIOLATION', reason: 'Malformed IDs, invalid sequence rows, or counters behind allocated IDs were found.' } : { status: status.PASS, category: 'NONE', reason: null };
  const mandatoryChecks = [...duplicateChecksResult, ...orphanChecksResult].filter((check) => check.mandatory);
  const duplicateMandatory = duplicateChecksResult.filter((check) => check.mandatory);
  const duplicateRecordTotal = duplicateMandatory.every((check) => check.status !== status.NOT_CHECKED) ? duplicateMandatory.reduce((total, check) => total + check.count, 0) : null;
  return { ok: isTiDB && missingPrerequisites.length === 0 && columnDefinitionMismatches.length === 0 && indexDefinitionMismatches.length === 0 && sequenceStatus.status === status.PASS && mandatoryChecks.every((check) => check.status === status.PASS), mode: 'READ_ONLY_PREFLIGHT', migration: migrationName, connectedDatabase: database.database_name, databaseEngine: isTiDB ? 'TiDB' : 'UNKNOWN', serverVersion, schemaCompatibility: missingPrerequisites.length ? status.FAIL : status.PASS, missingPrerequisites, schemaObjectFindings, columnDefinitionMismatches, indexDefinitionMismatches, checks: { duplicate: duplicateChecksResult, orphan: orphanChecksResult, studentIdSequence: sequenceStatus }, duplicateRecordTotal, duplicateGroups: Object.fromEntries(duplicateChecksResult.map((check) => [check.name, check.count])), orphanCounts: Object.fromEntries(orphanChecksResult.map((check) => [check.name, check.count])), existingStudentIdSequenceRows: sequences, annualSequenceReconciliation, malformedStudentIdCount: malformedStudentIds, invalidSequenceYears, counterBehindYears, indexesRelevantToMigration: indexRows.map((row) => ({ table: row.TABLE_NAME, name: row.INDEX_NAME, column: row.COLUMN_NAME, sequence: Number(row.SEQ_IN_INDEX), nonUnique: Number(row.NON_UNIQUE) })), constraintsToAdd: expectedIndexes, writesPerformed: false };
}

export async function main({ environment = process.env, createPool, stdout = process.stdout } = {}) {
  if (!environment.DATABASE_URL) { stdout.write(`${JSON.stringify({ ok: false, mode: 'READ_ONLY_PREFLIGHT', error: { code: 'DATABASE_URL_MISSING' } })}\n`); return 1; }
  if (!createPool) ({ createPool } = await import('mysql2/promise'));
  const pool = createPool({ uri: environment.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try { const report = await runAdmissionWorkflowPreflight({ pool }); stdout.write(`${JSON.stringify(report)}\n`); return report.ok ? 0 : 2; }
  catch (error) { stdout.write(`${JSON.stringify({ ok: false, mode: 'READ_ONLY_PREFLIGHT', error: safeError(error) })}\n`); return 1; }
  finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
