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
const healthyReport = () => ({
  ok: true, mode: 'READ_ONLY_PREFLIGHT', writesPerformed: false, databaseEngine: 'TiDB',
  missingPrerequisites: [], columnDefinitionMismatches: [], indexDefinitionMismatches: [],
  duplicateGroups: { ...duplicates }, orphanCounts: { ...orphans }, malformedStudentIdCount: 0,
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
  const report = healthyReport(); report.ok = false; report.duplicateGroups.student_permanent_id = 2;
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

test('unexpected fields are ignored and sensitive values never appear in summary output', () => {
  const report = { ...healthyReport(), studentName: 'PRIVATE_STUDENT', DATABASE_URL: 'mysql://secret', rawSql: 'SECRET_SQL', unexpected: 'TOKEN_SECRET' };
  const output = JSON.stringify(buildSummary(report, 0));
  for (const secret of ['PRIVATE_STUDENT', 'mysql://secret', 'SECRET_SQL', 'TOKEN_SECRET']) assert.equal(output.includes(secret), false);
  assert.equal(buildSummary(report, 0).ok, true);
});

test('unknown or unsafe error codes are reduced to a fixed safe code', () => {
  const report = { ok: false, error: { code: 'secret-password-PRIVATE' } };
  assert.equal(buildSummary(report, 1).errorCode, 'ADMISSIONS_PREFLIGHT_FAILED');
});

test('wrong engine, writesPerformed, and missing prerequisites fail closed', () => {
  const wrongEngine = healthyReport(); wrongEngine.databaseEngine = 'MySQL';
  assert.equal(buildSummary(wrongEngine, 0).ok, false);
  const writes = healthyReport(); writes.writesPerformed = true;
  assert.equal(buildSummary(writes, 0).ok, false);
  const prerequisites = healthyReport(); prerequisites.missingPrerequisites = ['students.permanent_student_id'];
  assert.equal(buildSummary(prerequisites, 0).failureCategory, 'MIGRATION_PREREQUISITES_MISSING');
});

test('duplicate, orphan, index, and sequence findings each block success', () => {
  const duplicate = healthyReport(); duplicate.duplicateGroups.enrollment_context = 1;
  assert.equal(buildSummary(duplicate, 0).failureCategory, 'DUPLICATE_RECORDS_FOUND');
  const orphan = healthyReport(); orphan.orphanCounts.parent_student_links = 1;
  assert.equal(buildSummary(orphan, 0).failureCategory, 'ORPHAN_RECORDS_FOUND');
  const index = healthyReport(); index.indexDefinitionMismatches = ['do-not-print'];
  assert.equal(buildSummary(index, 0).failureCategory, 'SCHEMA_DEFINITION_MISMATCH');
  const sequence = healthyReport(); sequence.counterBehindYears = ['private-year-data'];
  assert.equal(buildSummary(sequence, 0).failureCategory, 'STUDENT_ID_SEQUENCE_INCOMPATIBLE');
});

test('malformed success shape and unsafe booleans cannot pass', () => {
  const incomplete = healthyReport(); delete incomplete.duplicateGroups.enrollment_context;
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
