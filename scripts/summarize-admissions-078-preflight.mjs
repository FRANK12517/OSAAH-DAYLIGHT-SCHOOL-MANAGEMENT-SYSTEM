import { readFile } from 'node:fs/promises';
import { EXPECTED_ADMISSIONS_078_COLUMNS } from './admissions-078-schema-contract.mjs';

const knownErrorCodes = new Set([
  'DATABASE_URL_MISSING', 'DATABASE_TARGET_MISMATCH', 'ADMISSIONS_PREFLIGHT_FAILED',
  'ER_ACCESS_DENIED_ERROR', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE',
  'ER_BAD_FIELD_ERROR', 'ER_DUP_ENTRY'
]);
const duplicateKeys = [
  'enquiry_retry_identity', 'application_student_identity',
  'application_permanent_student_identity', 'enrollment_context',
  'student_permanent_id', 'profile_student_id'
];
const orphanKeys = [
  'admission_application_students', 'student_profile_master',
  'student_enrollment_students', 'student_enrollment_classes',
  'student_enrollment_academic_years', 'student_enrollment_terms',
  'parent_student_links'
];
const schemaColumns = {
  admission_applications: ['id', 'school_id', 'student_id', 'application_number', 'stage', 'applicant_data'],
  student_enrollments: ['school_id', 'student_id', 'class_id', 'academic_year_id', 'term_id', 'is_current'],
  students: ['id', 'school_id', 'permanent_student_id'],
  student_profiles: ['id', 'school_id', 'student_master_id', 'student_id'],
  classes: ['id'], academic_years: ['id', 'school_id'], terms: ['id', 'academic_year_id'],
  student_id_sequences: ['admission_year', 'next_sequence'],
  parent_student_links: ['parent_user_id', 'student_id', 'link_status'],
  users: ['id', 'school_id'], roles: ['id', 'school_id', 'role_key'],
  permissions: ['id', 'permission_key'], role_permissions: ['role_id', 'permission_id']
};
const schemaObjectNames = new Set(Object.entries(schemaColumns).flatMap(([table, columns]) => [`${table}.*`, ...columns.map((column) => `${table}.${column}`)]));
const expectedColumnDefinitions = new Map(EXPECTED_ADMISSIONS_078_COLUMNS.map(({ table, name, preferredType, compatibleTypes, nullable }) => [
  `${table}.${name}`, { type: preferredType, types: [...compatibleTypes], nullable }
]));
const correctiveActions = {
  PREFLIGHT_REPORT_INVALID: 'Inspect diagnostic generation; do not apply Migration 078.',
  PREFLIGHT_EXECUTION_FAILED: 'Inspect the sanitized error category and correct the connection or runtime issue.',
  DATABASE_ENGINE_UNSUPPORTED: 'Confirm the authorized production database engine before proceeding.',
  MIGRATION_PREREQUISITES_MISSING: 'Compare the exact missing objects with canonical schema history and equivalents; do not add parallel tables or apply Migration 078.',
  SCHEMA_DEFINITION_MISMATCH: 'Review the expected and actual column definitions against canonical migrations before any schema change.',
  DUPLICATE_RECORDS_FOUND: 'Reconcile duplicates only through an independently reviewed, authorized procedure.',
  ORPHAN_RECORDS_FOUND: 'Reconcile orphan relationships only through an independently reviewed, authorized procedure.',
  STUDENT_ID_SEQUENCE_INCOMPATIBLE: 'Review student ID sequence compatibility before rerunning preflight.',
  PREFLIGHT_SAFETY_CHECK_FAILED: 'Keep Migration 078 blocked until all read-only safety checks pass.',
  PREFLIGHT_PASSED: 'Eligible for the separately protected apply procedure, subject to backup confirmation and authorization.'
};

const countValue = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const allowedCheckStatuses = new Set(['PASS', 'FAIL', 'NOT_CHECKED']);
const safeType = (value) => {
  if (typeof value !== 'string') return 'UNKNOWN';
  const type = value.toLowerCase();
  if (/^(?:varchar|char)\(\d+\)$/.test(type)) return type;
  if (['tinytext', 'text', 'mediumtext', 'longtext', 'tinyblob', 'blob', 'mediumblob', 'longblob'].includes(type)) return type;
  if (/^(?:tinyint|smallint|mediumint|int|integer|bigint)(?:\(\d+\))?(?: unsigned)?$/.test(type)) return type;
  if (/^(?:decimal|numeric)\(\d+,\d+\)$/.test(type)) return type;
  if (['date', 'datetime', 'timestamp', 'time', 'year', 'float', 'double', 'json', 'boolean'].includes(type)) return type;
  return 'OTHER';
};
const safeNullable = (value) => value === 'YES' || value === 'NO' ? value : 'UNKNOWN';

function safeMissingObjects(report) {
  if (!Array.isArray(report?.missingPrerequisites)) return { names: [], valid: false };
  const valid = report.missingPrerequisites.every((item) => typeof item === 'string' && schemaObjectNames.has(item));
  return { names: [...new Set(report.missingPrerequisites.filter((item) => typeof item === 'string' && schemaObjectNames.has(item)))].sort(), valid };
}

function safeSchemaFindings(report, missingObjects) {
  if (!Array.isArray(report?.schemaObjectFindings)) return { findings: [], valid: false };
  const findings = [];
  const represented = [];
  let valid = true;
  for (const item of report.schemaObjectFindings) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.hasOwn(schemaColumns, item.table) || !Array.isArray(item.missingColumns)) {
      valid = false;
      continue;
    }
    const allowedColumns = schemaColumns[item.table];
    if (!item.missingColumns.every((column) => allowedColumns.includes(column))) { valid = false; continue; }
    const missingColumns = [...new Set(item.missingColumns)].sort();
    if (item.tableStatus === 'MISSING' && item.tableType === 'MISSING') {
      if (missingColumns.length !== allowedColumns.length) valid = false;
      represented.push(`${item.table}.*`, ...missingColumns.map((column) => `${item.table}.${column}`));
    } else if (item.tableStatus === 'PRESENT' && ['BASE TABLE', 'VIEW'].includes(item.tableType) && missingColumns.length) {
      represented.push(...missingColumns.map((column) => `${item.table}.${column}`));
    } else {
      valid = false;
      continue;
    }
    findings.push({ table: item.table, tableStatus: item.tableStatus, tableType: item.tableType, missingColumns });
  }
  const normalizedRepresented = [...new Set(represented)].sort();
  if (JSON.stringify(normalizedRepresented) !== JSON.stringify(missingObjects)) valid = false;
  return { findings, valid };
}

function safeColumnMismatches(report) {
  if (!Array.isArray(report?.columnDefinitionMismatches)) return { details: [], valid: false };
  const details = [];
  let valid = true;
  for (const item of report.columnDefinitionMismatches) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { valid = false; continue; }
    const object = `${item.table}.${item.name}`;
    const expected = expectedColumnDefinitions.get(object);
    if (!expected || item.expectedType !== expected.type || item.expectedNullable !== expected.nullable
      || !Array.isArray(item.expectedTypes) || JSON.stringify(item.expectedTypes) !== JSON.stringify(expected.types)) { valid = false; continue; }
    details.push({
      object,
      expected: { types: [...expected.types], nullable: expected.nullable },
      actual: { type: safeType(item.actualType), nullable: safeNullable(item.actualNullable) }
    });
  }
  return { details, valid: valid && details.length === report.columnDefinitionMismatches.length };
}

function safeChecks(report, group, names) {
  if (!Array.isArray(report?.checks?.[group])) return { checks: [], valid: false };
  const byName = new Map(report.checks[group].map((check) => [check?.name, check]));
  if (byName.size !== report.checks[group].length || names.some((name) => !byName.has(name))) return { checks: [], valid: false };
  const checks = names.map((name) => {
    const check = byName.get(name);
    const valid = check && typeof check === 'object' && typeof check.mandatory === 'boolean' && allowedCheckStatuses.has(check.status)
      && typeof check.category === 'string' && (check.count === null || countValue(check.count) !== null)
      && (check.status === 'NOT_CHECKED' ? check.count === null && typeof check.reason === 'string' : countValue(check.count) !== null && check.reason === null);
    return valid ? { name, mandatory: check.mandatory, status: check.status, category: check.category, reason: check.reason, count: check.count } : null;
  });
  return { checks, valid: checks.every(Boolean) };
}

export function buildSummary(report, nodeExitCode) {
  const validObject = report !== null && typeof report === 'object' && !Array.isArray(report);
  const validStatus = Number.isInteger(nodeExitCode) && nodeExitCode >= 0;
  const hasJson = validObject && typeof report.ok === 'boolean';
  const safeErrorCode = hasJson && typeof report.error?.code === 'string' && knownErrorCodes.has(report.error.code)
    ? report.error.code : (hasJson && report.error ? 'ADMISSIONS_PREFLIGHT_FAILED' : null);
  const missingResult = hasJson ? safeMissingObjects(report) : { names: [], valid: false };
  const missingObjects = missingResult.names;
  const missingCategories = [...new Set(missingObjects.map((item) => item.split('.')[0]))].sort();
  const schemaFindings = hasJson ? safeSchemaFindings(report, missingObjects) : { findings: [], valid: false };
  const columnResult = hasJson ? safeColumnMismatches(report) : { details: [], valid: false };
  const duplicateResult = hasJson ? safeChecks(report, 'duplicate', duplicateKeys) : { checks: [], valid: false };
  const orphanResult = hasJson ? safeChecks(report, 'orphan', orphanKeys) : { checks: [], valid: false };
  const duplicates = Object.fromEntries(duplicateResult.checks.filter(Boolean).map((check) => [check.name, check.count]));
  const orphans = Object.fromEntries(orphanResult.checks.filter(Boolean).map((check) => [check.name, check.count]));
  const mandatoryDuplicates = duplicateResult.checks.filter((check) => check?.mandatory);
  const mandatoryOrphans = orphanResult.checks.filter((check) => check?.mandatory);
  const duplicatesAvailable = duplicateResult.valid && mandatoryDuplicates.every((check) => check.status !== 'NOT_CHECKED');
  const orphansAvailable = orphanResult.valid && mandatoryOrphans.every((check) => check.status !== 'NOT_CHECKED');
  const duplicateTotal = duplicatesAvailable ? mandatoryDuplicates.reduce((sum, check) => sum + check.count, 0) : null;
  const orphanTotal = orphansAvailable ? mandatoryOrphans.reduce((sum, check) => sum + check.count, 0) : null;
  const columnMismatchCount = hasJson && Array.isArray(report.columnDefinitionMismatches) ? report.columnDefinitionMismatches.length : 0;
  const indexMismatchCount = hasJson && Array.isArray(report.indexDefinitionMismatches) ? report.indexDefinitionMismatches.length : 0;
  const invalidSequenceCount = hasJson && Array.isArray(report.invalidSequenceYears) ? report.invalidSequenceYears.length : 0;
  const counterBehindCount = hasJson && Array.isArray(report.counterBehindYears) ? report.counterBehindYears.length : 0;
  const malformedIdCount = hasJson ? countValue(report.malformedStudentIdCount) ?? 0 : 0;
  const engine = hasJson && report.databaseEngine === 'TiDB' ? 'TiDB' : (hasJson && report.databaseEngine === 'UNKNOWN' ? 'UNKNOWN' : 'UNRECOGNIZED');
  const migrationPrerequisites = hasJson && Array.isArray(report.missingPrerequisites)
    ? (missingObjects.length ? 'MISSING' : 'PRESENT') : 'UNKNOWN';
  const duplicateCheckStatus = duplicatesAvailable ? 'COMPLETE' : 'NOT_CHECKED';
  const duplicateCheckReason = duplicatesAvailable ? null : mandatoryDuplicates.some((check) => check?.category === 'MISSING_SCHEMA_PREREQUISITES') ? 'MISSING_SCHEMA_PREREQUISITES' : 'DIAGNOSTICS_UNAVAILABLE';
  const orphanCheckStatus = orphansAvailable ? 'COMPLETE' : 'NOT_CHECKED';
  const orphanCheckReason = orphansAvailable ? null : mandatoryOrphans.some((check) => check?.category === 'MISSING_SCHEMA_PREREQUISITES') ? 'MISSING_SCHEMA_PREREQUISITES' : 'DIAGNOSTICS_UNAVAILABLE';
  const validDataCheckShape = duplicateResult.valid && orphanResult.valid;
  const completeDiagnostics = hasJson && validStatus && missingResult.valid && schemaFindings.valid && columnResult.valid
    && Array.isArray(report.indexDefinitionMismatches) && Array.isArray(report.invalidSequenceYears)
    && Array.isArray(report.counterBehindYears) && Array.isArray(report.annualSequenceReconciliation)
    && Number.isSafeInteger(report.malformedStudentIdCount) && validDataCheckShape;
  const safetyValid = completeDiagnostics && report.mode === 'READ_ONLY_PREFLIGHT' && report.writesPerformed === false && engine === 'TiDB';
  const passed = safetyValid && report.ok === true && nodeExitCode === 0 && migrationPrerequisites === 'PRESENT'
    && duplicateCheckStatus === 'COMPLETE' && orphanCheckStatus === 'COMPLETE'
    && duplicateTotal === 0 && orphanTotal === 0 && columnMismatchCount === 0 && indexMismatchCount === 0
    && invalidSequenceCount === 0 && counterBehindCount === 0 && malformedIdCount === 0;
  let failureCategory = 'PREFLIGHT_REPORT_INVALID';
  if (!hasJson || !validStatus || !completeDiagnostics) failureCategory = 'PREFLIGHT_REPORT_INVALID';
  else if (safeErrorCode) failureCategory = 'PREFLIGHT_EXECUTION_FAILED';
  else if (engine !== 'TiDB') failureCategory = 'DATABASE_ENGINE_UNSUPPORTED';
  else if (migrationPrerequisites === 'MISSING') failureCategory = 'MIGRATION_PREREQUISITES_MISSING';
  else if (columnMismatchCount || indexMismatchCount) failureCategory = 'SCHEMA_DEFINITION_MISMATCH';
  else if (duplicateTotal !== null && duplicateTotal > 0) failureCategory = 'DUPLICATE_RECORDS_FOUND';
  else if (orphanTotal !== null && orphanTotal > 0) failureCategory = 'ORPHAN_RECORDS_FOUND';
  else if (invalidSequenceCount || counterBehindCount || malformedIdCount) failureCategory = 'STUDENT_ID_SEQUENCE_INCOMPATIBLE';
  else if (nodeExitCode !== 0 || !report.ok || !safetyValid) failureCategory = 'PREFLIGHT_SAFETY_CHECK_FAILED';
  else failureCategory = 'PREFLIGHT_PASSED';
  return {
    ok: passed,
    mode: 'READ_ONLY_PREFLIGHT',
    failureCategory: passed ? null : failureCategory,
    errorCode: safeErrorCode,
    nodeExitCode: validStatus ? nodeExitCode : null,
    databaseEngine: engine,
    migrationPrerequisites: { status: migrationPrerequisites, missingCategories, missingSchemaObjects: missingObjects, schemaObjectFindings: schemaFindings.findings },
    missingSchemaObjectCategoryCount: missingCategories.length,
    duplicateCheckStatus,
    duplicateCheckReason,
    duplicateChecks: duplicateResult.checks,
    duplicateRecordCounts: duplicates,
    duplicateRecordTotal: duplicateTotal,
    orphanCheckStatus,
    orphanCheckReason,
    orphanChecks: orphanResult.checks,
    orphanRecordCounts: orphans,
    orphanRecordTotal: orphanTotal,
    studentIdSequenceCompatibility: hasJson
      ? (invalidSequenceCount || counterBehindCount || malformedIdCount ? 'INCOMPATIBLE' : 'COMPATIBLE') : 'UNKNOWN',
    schemaCompatibility: hasJson && (missingObjects.length || columnMismatchCount || indexMismatchCount) ? 'MISMATCH' : hasJson ? 'COMPATIBLE' : 'UNKNOWN',
    columnDefinitionMismatchCount: columnMismatchCount,
    columnDefinitionMismatches: columnResult.details,
    indexConstraintMismatchCount: indexMismatchCount,
    requiredCorrectiveAction: correctiveActions[passed ? 'PREFLIGHT_PASSED' : failureCategory]
  };
}

async function main() {
  const file = process.argv[2];
  const parsedExitCode = Number(process.env.PREFLIGHT_EXIT_CODE);
  let report;
  try {
    if (!file) throw new Error('missing');
    report = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    report = null;
  }
  const summary = buildSummary(report, Number.isInteger(parsedExitCode) ? parsedExitCode : NaN);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = Number.isInteger(parsedExitCode) && parsedExitCode > 0 ? parsedExitCode : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
