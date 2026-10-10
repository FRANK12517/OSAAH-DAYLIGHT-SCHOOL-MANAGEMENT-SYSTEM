import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildSummary } from '../scripts/summarize-admissions-078-preflight.mjs';

const workflowPath = resolve('.github/workflows/production-admissions-migration-078.yml');
const scriptPath = resolve('scripts/summarize-admissions-078-preflight.mjs');
const duplicates = Object.fromEntries([
  'enquiry_retry_identity', 'application_student_identity', 'application_permanent_student_identity',
  'enrollment_context', 'student_permanent_id', 'profile_student_id'
].map((key) => [key, 0]));
const orphans = Object.fromEntries([
  'admission_application_students', 'student_profile_master', 'student_enrollment_students',
  'student_enrollment_classes', 'student_enrollment_academic_years', 'student_enrollment_terms', 'parent_student_links'
].map((key) => [key, 0]));
const duplicateChecks = Object.entries(duplicates).map(([name, count]) => ({
  name, mandatory: !['enquiry_retry_identity', 'application_permanent_student_identity'].includes(name),
  status: 'PASS', category: 'NONE', reason: null, missingPrerequisites: [], count
}));
const orphanChecks = Object.entries(orphans).map(([name, count]) => ({
  name, mandatory: true, status: 'PASS', category: 'NONE', reason: null, missingPrerequisites: [], count
}));
const healthyReport = () => ({
  ok: true, mode: 'READ_ONLY_PREFLIGHT', writesPerformed: false, databaseEngine: 'TiDB',
  missingPrerequisites: [], schemaObjectFindings: [], columnDefinitionMismatches: [], indexDefinitionMismatches: [],
  checks: { duplicate: structuredClone(duplicateChecks), orphan: structuredClone(orphanChecks), studentIdSequence: { status: 'PASS' } },
  duplicateRecordTotal: 0, duplicateGroups: { ...duplicates }, orphanCounts: { ...orphans }, malformedStudentIdCount: 0,
  invalidSequenceYears: [], counterBehindYears: [], annualSequenceReconciliation: []
});

test('successful complete preflight is summarized as eligible without raw diagnostic fields', () => {
  const summary = buildSummary(healthyReport(), 0);
  assert.equal(summary.ok, true);
  assert.equal(summary.failureCategory, null);
  assert.match(summary.requiredCorrectiveAction, /separately protected apply/);
  assert.equal('connectedDatabase' in summary, false);
});

test('valid failed preflight reports safe category and counts only', () => {
  const report = healthyReport(); report.ok = false;
  const check = report.checks.duplicate.find((item) => item.name === 'student_permanent_id');
  Object.assign(check, { status: 'FAIL', category: 'INTEGRITY_VIOLATION', count: 2 });
  const summary = buildSummary(report, 2);
  assert.equal(summary.ok, false);
  assert.equal(summary.failureCategory, 'DUPLICATE_RECORDS_FOUND');
  assert.equal(summary.duplicateRecordTotal, 2);
});

test('Node exit code 2 can never be converted into success', () => {
  assert.equal(buildSummary(healthyReport(), 2).ok, false);
});

test('CLI preserves Node exit code 2 and emits only the sanitized result', async () => {
  const directory = await mkdtemp(resolve(os.tmpdir(), 'admissions-078-'));
  try {
    const reportFile = resolve(directory, 'report.json');
    await writeFile(reportFile, JSON.stringify(healthyReport()));
    const result = spawnSync(process.execPath, [scriptPath, reportFile], {
      encoding: 'utf8', env: { ...process.env, PREFLIGHT_EXIT_CODE: '2' }
    });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.equal(result.stdout.includes('connectedDatabase'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing, empty, and malformed reports fail closed', async () => {
  assert.equal(buildSummary(null, 0).ok, false);
  const directory = await mkdtemp(resolve(os.tmpdir(), 'admissions-078-'));
  try {
    for (const contents of ['', '{broken']) {
      const file = resolve(directory, 'report.json'); await writeFile(file, contents);
      const result = spawnSync(process.execPath, [scriptPath, file], { encoding: 'utf8', env: { ...process.env, PREFLIGHT_EXIT_CODE: '0' } });
      assert.notEqual(result.status, 0);
      assert.equal(JSON.parse(result.stdout).ok, false);
    }
    const absent = spawnSync(process.execPath, [scriptPath, resolve(directory, 'missing.json')], { encoding: 'utf8', env: { ...process.env, PREFLIGHT_EXIT_CODE: '0' } });
    assert.notEqual(absent.status, 0);
    assert.equal(absent.error, undefined, absent.error?.message);
    assert.ok(absent.stdout.includes('PREFLIGHT_REPORT_INVALID'), absent.stderr);
    assert.equal(JSON.parse(absent.stdout).failureCategory, 'PREFLIGHT_REPORT_INVALID');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unexpected and sensitive fields are ignored by the explicit allow-list', () => {
  const report = { ...healthyReport(), studentName: 'PRIVATE_STUDENT', DATABASE_URL: 'mysql://secret', rawSql: 'SECRET_SQL', unexpected: 'TOKEN_SECRET' };
  const output = JSON.stringify(buildSummary(report, 0));
  for (const secret of ['PRIVATE_STUDENT', 'mysql://secret', 'SECRET_SQL', 'TOKEN_SECRET']) assert.equal(output.includes(secret), false);
  assert.equal(buildSummary(report, 0).ok, true);
});

test('unknown or unsafe error codes are reduced to a fixed safe code', () => {
  const report = { ok: false, error: { code: 'secret-password-PRIVATE' } };
  assert.equal(buildSummary(report, 1).errorCode, 'ADMISSIONS_PREFLIGHT_FAILED');
});

test('wrong engine, writesPerformed, and exact missing schema objects fail closed', () => {
  const wrongEngine = healthyReport(); wrongEngine.databaseEngine = 'MySQL';
  assert.equal(buildSummary(wrongEngine, 0).ok, false);
  const writes = healthyReport(); writes.writesPerformed = true;
  assert.equal(buildSummary(writes, 0).ok, false);
  const prerequisites = healthyReport();
  prerequisites.missingPrerequisites = ['student_enrollments.is_current'];
  prerequisites.schemaObjectFindings = [
    { table: 'student_enrollments', tableStatus: 'PRESENT', tableType: 'BASE TABLE', missingColumns: ['is_current'] }
  ];
  const blockedDuplicate = prerequisites.checks.duplicate.find((item) => item.name === 'enrollment_context');
  Object.assign(blockedDuplicate, { status: 'NOT_CHECKED', category: 'MISSING_SCHEMA_PREREQUISITES', reason: 'Missing: student_enrollments.is_current', missingPrerequisites: ['student_enrollments.is_current'], count: null });
  prerequisites.ok = false;
  const summary = buildSummary(prerequisites, 2);
  assert.equal(summary.failureCategory, 'MIGRATION_PREREQUISITES_MISSING');
  assert.deepEqual(summary.migrationPrerequisites.missingSchemaObjects, ['student_enrollments.is_current']);
  assert.equal(summary.duplicateCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.duplicateCheckReason, 'MISSING_SCHEMA_PREREQUISITES');
  assert.equal(summary.duplicateRecordTotal, null);
  assert.equal(summary.orphanCheckStatus, 'COMPLETE');
  assert.equal(summary.orphanCheckReason, null);
  assert.equal(summary.orphanRecordTotal, 0);
});

test('duplicate, orphan, index, and sequence findings each block success', () => {
  const duplicate = healthyReport();
  Object.assign(duplicate.checks.duplicate.find((item) => item.name === 'enrollment_context'), { status: 'FAIL', category: 'INTEGRITY_VIOLATION', count: 1 });
  assert.equal(buildSummary(duplicate, 0).failureCategory, 'DUPLICATE_RECORDS_FOUND');
  const orphan = healthyReport();
  Object.assign(orphan.checks.orphan.find((item) => item.name === 'parent_student_links'), { status: 'FAIL', category: 'INTEGRITY_VIOLATION', count: 1 });
  assert.equal(buildSummary(orphan, 0).failureCategory, 'ORPHAN_RECORDS_FOUND');
  const index = healthyReport(); index.indexDefinitionMismatches = ['do-not-print'];
  assert.equal(buildSummary(index, 0).failureCategory, 'SCHEMA_DEFINITION_MISMATCH');
  const sequence = healthyReport(); sequence.counterBehindYears = ['private-year-data'];
  assert.equal(buildSummary(sequence, 0).failureCategory, 'STUDENT_ID_SEQUENCE_INCOMPATIBLE');
});

test('expected and actual column definitions are exposed only for approved schema identifiers', () => {
  const report = healthyReport(); report.ok = false;
  report.columnDefinitionMismatches = [{
    table: 'admission_applications', name: 'permanent_student_id',
    expectedType: 'varchar(128)', expectedTypes: ['varchar(100)', 'varchar(128)'], expectedNullable: 'YES',
    actualType: 'varchar(32)', actualNullable: 'NO', extra: 'PRIVATE_VALUE'
  }];
  const summary = buildSummary(report, 2);
  assert.equal(summary.failureCategory, 'SCHEMA_DEFINITION_MISMATCH');
  assert.deepEqual(summary.columnDefinitionMismatches, [{
    object: 'admission_applications.permanent_student_id',
    expected: { types: ['varchar(100)', 'varchar(128)'], nullable: 'YES' },
    actual: { type: 'varchar(32)', nullable: 'NO' }
  }]);
  assert.equal(JSON.stringify(summary).includes('PRIVATE_VALUE'), false);
});

test('unknown mismatch identifiers or prerequisite strings make the report invalid', () => {
  const mismatch = healthyReport(); mismatch.ok = false;
  mismatch.columnDefinitionMismatches = [{ table: 'private_table', name: 'private_column', expectedType: 'secret', expectedNullable: 'NO', actualType: 'secret', actualNullable: 'NO' }];
  assert.equal(buildSummary(mismatch, 2).failureCategory, 'PREFLIGHT_REPORT_INVALID');
  const prerequisite = healthyReport(); prerequisite.ok = false; prerequisite.missingPrerequisites = ['private_table.private_column'];
  assert.equal(buildSummary(prerequisite, 2).failureCategory, 'PREFLIGHT_REPORT_INVALID');
});

test('data checks blocked by missing prerequisites are NOT_CHECKED, not zero findings', () => {
  const report = healthyReport(); report.ok = false;
  report.missingPrerequisites = ['student_profiles.*', 'student_profiles.id', 'student_profiles.school_id', 'student_profiles.student_master_id', 'student_profiles.student_id'];
  report.schemaObjectFindings = [{ table: 'student_profiles', tableStatus: 'MISSING', tableType: 'MISSING', missingColumns: ['id', 'school_id', 'student_master_id', 'student_id'] }];
  const blockedDuplicate = report.checks.duplicate.find((item) => item.name === 'profile_student_id');
  Object.assign(blockedDuplicate, { status: 'NOT_CHECKED', category: 'MISSING_SCHEMA_PREREQUISITES', reason: 'Missing: student_profiles.student_master_id, student_profiles.student_id, student_profiles.school_id', missingPrerequisites: ['student_profiles.student_master_id', 'student_profiles.student_id', 'student_profiles.school_id'], count: null });
  const blockedOrphan = report.checks.orphan.find((item) => item.name === 'student_profile_master');
  Object.assign(blockedOrphan, { status: 'NOT_CHECKED', category: 'MISSING_SCHEMA_PREREQUISITES', reason: 'Missing: student_profiles.student_master_id, student_profiles.school_id', missingPrerequisites: ['student_profiles.student_master_id', 'student_profiles.school_id'], count: null });
  const blockedParentLink = report.checks.orphan.find((item) => item.name === 'parent_student_links');
  Object.assign(blockedParentLink, { status: 'NOT_CHECKED', category: 'MISSING_SCHEMA_PREREQUISITES', reason: 'Missing: student_profiles.id, student_profiles.school_id', missingPrerequisites: ['student_profiles.id', 'student_profiles.school_id'], count: null });
  const summary = buildSummary(report, 2);
  assert.equal(summary.duplicateCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.duplicateCheckReason, 'MISSING_SCHEMA_PREREQUISITES');
  assert.equal(summary.orphanCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.orphanCheckReason, 'MISSING_SCHEMA_PREREQUISITES');
  assert.equal(summary.duplicateRecordTotal, null);
  assert.equal(summary.orphanRecordTotal, null);
  assert.equal(summary.ok, false);
  const contradictory = { ...report, checks: { duplicate: structuredClone(duplicateChecks), orphan: structuredClone(orphanChecks) } };
  const unsafeSummary = buildSummary(contradictory, 2);
  assert.equal(unsafeSummary.failureCategory, 'PREFLIGHT_REPORT_INVALID');
  assert.equal(unsafeSummary.duplicateRecordTotal, null);
});

test('unavailable duplicate and orphan aggregates are NOT_CHECKED and cannot become zero', () => {
  const report = healthyReport();
  delete report.checks.duplicate;
  delete report.checks.orphan;
  const summary = buildSummary(report, 0);
  assert.equal(summary.ok, false);
  assert.equal(summary.duplicateCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.duplicateCheckReason, 'DIAGNOSTICS_UNAVAILABLE');
  assert.equal(summary.orphanCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.orphanCheckReason, 'DIAGNOSTICS_UNAVAILABLE');
  assert.equal(summary.duplicateRecordTotal, null);
  assert.equal(summary.orphanRecordTotal, null);
});

test('schema-object findings distinguish missing tables from missing columns and views', () => {
  const report = healthyReport(); report.ok = false;
  report.missingPrerequisites = ['student_profiles.student_id'];
  report.schemaObjectFindings = [{ table: 'student_profiles', tableStatus: 'PRESENT', tableType: 'VIEW', missingColumns: ['student_id'] }];
  const summary = buildSummary(report, 2);
  assert.deepEqual(summary.migrationPrerequisites.schemaObjectFindings, [
    { table: 'student_profiles', tableStatus: 'PRESENT', tableType: 'VIEW', missingColumns: ['student_id'] }
  ]);
});

test('malformed success shape and unsafe booleans cannot pass', () => {
  const incomplete = healthyReport(); incomplete.checks.duplicate.pop();
  assert.equal(buildSummary(incomplete, 0).ok, false);
  const fakePass = { ok: true, mode: 'READ_ONLY_PREFLIGHT', writesPerformed: false, databaseEngine: 'TiDB' };
  assert.equal(buildSummary(fakePass, 0).ok, false);
});

test('workflow retains exact-main-SHA and protected Production gates, and reports no raw JSON', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$RELEASE_REF"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$RELEASE_REF"/);
  assert.match(workflow, /production-admissions-migration-078\.mjs apply/);
  assert.doesNotMatch(workflow, /cat\s+"\$RUNNER_TEMP\/admissions-078-preflight\.json"/);
  assert.equal((workflow.match(/summarize-admissions-078-preflight\.mjs/g) ?? []).length, 2);
  assert.equal((workflow.match(/node scripts\/admission-workflow-migration-preflight\.mjs/g) ?? []).length, 2);
  assert.equal((workflow.match(/admissions-078-preflight\.stderr/g) ?? []).length, 2);
});
