import { readFile } from 'node:fs/promises';

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
const missingCategories = new Set([
  'admission_applications', 'student_enrollments', 'students', 'student_profiles',
  'classes', 'academic_years', 'terms', 'student_id_sequences',
  'parent_student_links', 'users', 'roles', 'permissions', 'role_permissions'
]);
const correctiveActions = {
  PREFLIGHT_REPORT_INVALID: 'Inspect workflow artifact generation; do not apply Migration 078.',
  PREFLIGHT_EXECUTION_FAILED: 'Inspect the sanitized error category and correct the connection or runtime issue.',
  DATABASE_ENGINE_UNSUPPORTED: 'Confirm the authorized production database engine before proceeding.',
  MIGRATION_PREREQUISITES_MISSING: 'Review and reconcile the required schema prerequisites before rerunning preflight.',
  SCHEMA_DEFINITION_MISMATCH: 'Review the required column, index, or constraint definitions before rerunning preflight.',
  DUPLICATE_RECORDS_FOUND: 'Reconcile duplicate records through an independently reviewed, authorized procedure.',
  ORPHAN_RECORDS_FOUND: 'Reconcile orphan relationships through an independently reviewed, authorized procedure.',
  STUDENT_ID_SEQUENCE_INCOMPATIBLE: 'Review student ID sequence compatibility before rerunning preflight.',
  PREFLIGHT_SAFETY_CHECK_FAILED: 'Keep Migration 078 blocked until all read-only safety checks pass.',
  PREFLIGHT_PASSED: 'Eligible for the separately protected apply procedure, subject to backup confirmation and authorization.'
};

const countValue = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const countMap = (source, keys) => Object.fromEntries(keys.map((key) => [key, countValue(source?.[key]) ?? 0]));

export function buildSummary(report, nodeExitCode) {
  const validObject = report !== null && typeof report === 'object' && !Array.isArray(report);
  const validStatus = Number.isInteger(nodeExitCode) && nodeExitCode >= 0;
  const hasJson = validObject && typeof report.ok === 'boolean';
  const safeErrorCode = hasJson && typeof report.error?.code === 'string' && knownErrorCodes.has(report.error.code)
    ? report.error.code : (hasJson && report.error ? 'ADMISSIONS_PREFLIGHT_FAILED' : null);
  const missing = hasJson && Array.isArray(report.missingPrerequisites)
    ? [...new Set(report.missingPrerequisites.map((item) => String(item).split('.')[0]).filter((item) => missingCategories.has(item)))].sort()
    : [];
  const duplicates = hasJson ? countMap(report.duplicateGroups, duplicateKeys) : {};
  const orphans = hasJson ? countMap(report.orphanCounts, orphanKeys) : {};
  const columnMismatchCount = hasJson && Array.isArray(report.columnDefinitionMismatches) ? report.columnDefinitionMismatches.length : 0;
  const indexMismatchCount = hasJson && Array.isArray(report.indexDefinitionMismatches) ? report.indexDefinitionMismatches.length : 0;
  const invalidSequenceCount = hasJson && Array.isArray(report.invalidSequenceYears) ? report.invalidSequenceYears.length : 0;
  const counterBehindCount = hasJson && Array.isArray(report.counterBehindYears) ? report.counterBehindYears.length : 0;
  const malformedIdCount = hasJson ? countValue(report.malformedStudentIdCount) ?? 0 : 0;
  const engine = hasJson && report.databaseEngine === 'TiDB' ? 'TiDB' : (hasJson && report.databaseEngine === 'UNKNOWN' ? 'UNKNOWN' : 'UNRECOGNIZED');
  const prerequisites = hasJson ? (missing.length ? 'MISSING' : 'PRESENT') : 'UNKNOWN';
  const migrationPrerequisites = hasJson && Array.isArray(report.missingPrerequisites) ? prerequisites : 'UNKNOWN';
  const duplicateTotal = Object.values(duplicates).reduce((sum, n) => sum + n, 0);
  const orphanTotal = Object.values(orphans).reduce((sum, n) => sum + n, 0);
  const completeDiagnostics = hasJson && Array.isArray(report.missingPrerequisites)
    && report.missingPrerequisites.every((item) => typeof item === 'string' && missingCategories.has(item.split('.')[0]))
    && Array.isArray(report.columnDefinitionMismatches) && Array.isArray(report.indexDefinitionMismatches)
    && Array.isArray(report.invalidSequenceYears) && Array.isArray(report.counterBehindYears)
    && Array.isArray(report.annualSequenceReconciliation) && Number.isSafeInteger(report.malformedStudentIdCount)
    && duplicateKeys.every((key) => countValue(report.duplicateGroups?.[key]) !== null)
    && orphanKeys.every((key) => countValue(report.orphanCounts?.[key]) !== null);
  const safetyValid = hasJson && validStatus && completeDiagnostics && report.mode === 'READ_ONLY_PREFLIGHT' && report.writesPerformed === false && engine === 'TiDB';
  const passed = safetyValid && report.ok === true && nodeExitCode === 0 && migrationPrerequisites === 'PRESENT'
    && duplicateTotal === 0 && orphanTotal === 0 && columnMismatchCount === 0 && indexMismatchCount === 0
    && invalidSequenceCount === 0 && counterBehindCount === 0 && malformedIdCount === 0;
  let failureCategory = 'PREFLIGHT_REPORT_INVALID';
  if (!hasJson || !validStatus) failureCategory = 'PREFLIGHT_REPORT_INVALID';
  else if (safeErrorCode) failureCategory = 'PREFLIGHT_EXECUTION_FAILED';
  else if (engine !== 'TiDB') failureCategory = 'DATABASE_ENGINE_UNSUPPORTED';
  else if (migrationPrerequisites === 'MISSING') failureCategory = 'MIGRATION_PREREQUISITES_MISSING';
  else if (columnMismatchCount || indexMismatchCount) failureCategory = 'SCHEMA_DEFINITION_MISMATCH';
  else if (duplicateTotal) failureCategory = 'DUPLICATE_RECORDS_FOUND';
  else if (orphanTotal) failureCategory = 'ORPHAN_RECORDS_FOUND';
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
    migrationPrerequisites: { status: migrationPrerequisites, missingCategories: missing },
    missingSchemaObjectCategoryCount: missing.length,
    duplicateRecordCounts: duplicates,
    duplicateRecordTotal: duplicateTotal,
    orphanRecordCounts: orphans,
    orphanRecordTotal: orphanTotal,
    studentIdSequenceCompatibility: hasJson
      ? (invalidSequenceCount || counterBehindCount || malformedIdCount ? 'INCOMPATIBLE' : 'COMPATIBLE') : 'UNKNOWN',
    schemaCompatibility: hasJson && (columnMismatchCount || indexMismatchCount) ? 'MISMATCH' : hasJson ? 'COMPATIBLE' : 'UNKNOWN',
    columnDefinitionMismatchCount: columnMismatchCount,
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
