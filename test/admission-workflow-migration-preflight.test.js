import assert from 'node:assert/strict';
import test from 'node:test';
import { runAdmissionWorkflowPreflight } from '../scripts/admission-workflow-migration-preflight.mjs';

const canonicalColumns = {
  admission_applications: ['id', 'school_id', 'student_id', 'application_number', 'stage', 'applicant_data'],
  student_enrollments: ['school_id', 'student_id', 'class_id', 'academic_year_id', 'term_id', 'is_current'],
  students: ['id', 'school_id', 'permanent_student_id'],
  student_profiles: ['id', 'school_id', 'student_master_id', 'student_id'],
  classes: ['id'], academic_years: ['id', 'school_id'], terms: ['id', 'academic_year_id'],
  student_id_sequences: ['admission_year', 'next_sequence'],
  parent_student_links: ['parent_user_id', 'student_id', 'link_status'],
  users: ['id', 'school_id'], roles: ['id', 'school_id', 'role_key'], permissions: ['id', 'permission_key'], role_permissions: ['role_id', 'permission_id']
};

function fixture({ columns = canonicalColumns, counts = {}, throwFor = {} } = {}) {
  const queries = [];
  const tableRows = Object.keys(columns).map((TABLE_NAME) => ({ TABLE_NAME, TABLE_TYPE: 'BASE TABLE' }));
  const columnRows = Object.entries(columns).flatMap(([TABLE_NAME, names]) => names.map((COLUMN_NAME) => ({ TABLE_NAME, COLUMN_NAME, COLUMN_TYPE: 'varchar(191)', IS_NULLABLE: 'YES' })));
  const pool = { async query(sql) {
    queries.push(sql);
    const marker = /admission-preflight:([a-z_]+)/.exec(sql)?.[1];
    if (marker) {
      if (throwFor[marker]) throw Object.assign(new Error('fixture failure'), { code: 'FIXTURE_QUERY_FAILED' });
      const count = Object.hasOwn(counts, marker) ? counts[marker] : 0;
      return [[sql.includes('orphan_count') ? { orphan_count: count } : { duplicate_groups: count }]];
    }
    if (sql.startsWith('SELECT DATABASE')) return [[{ database_name: 'osaahdaylightschool' }]];
    if (sql.startsWith('SELECT VERSION')) return [[{ server_version: '8.0.0-TiDB' }]];
    if (sql.includes('information_schema.TABLES')) return [tableRows];
    if (sql.includes('information_schema.COLUMNS')) return [columnRows];
    if (sql.includes('information_schema.STATISTICS')) return [[]];
    if (sql.includes('student_id_sequences')) return [[{ admission_year: '2026', next_sequence: 2 }]];
    return [[]];
  } };
  return { pool, queries };
}

function check(report, group, name) { return report.checks[group].find((item) => item.name === name); }

test('canonical identity schema passes without student_profiles.permanent_student_id', async () => {
  const { pool, queries } = fixture();
  const report = await runAdmissionWorkflowPreflight({ pool });
  assert.equal(report.ok, true);
  assert.equal(report.schemaCompatibility, 'PASS');
  assert.deepEqual(report.missingPrerequisites, []);
  assert.equal(report.duplicateRecordTotal, 0);
  assert.equal(report.checks.studentIdSequence.status, 'PASS');
  assert.ok(queries.every((sql) => /^\s*(?:\/\*.*?\*\/\s*)?SELECT\b/is.test(sql)), 'preflight must issue SELECT queries only');
});

test('duplicate checks report PASS and FAIL with completed counts', async () => {
  const pass = await runAdmissionWorkflowPreflight({ pool: fixture().pool });
  const fail = await runAdmissionWorkflowPreflight({ pool: fixture({ counts: { student_permanent_id: 2 } }).pool });
  assert.equal(check(pass, 'duplicate', 'student_permanent_id').status, 'PASS');
  assert.equal(check(fail, 'duplicate', 'student_permanent_id').status, 'FAIL');
  assert.equal(check(fail, 'duplicate', 'student_permanent_id').count, 2);
  assert.equal(fail.duplicateRecordTotal, 2);
  assert.equal(fail.ok, false);
});

test('orphan checks report PASS and fail the aggregate when orphans exist', async () => {
  const pass = await runAdmissionWorkflowPreflight({ pool: fixture().pool });
  const fail = await runAdmissionWorkflowPreflight({ pool: fixture({ counts: { parent_student_links: 1 } }).pool });
  assert.equal(check(pass, 'orphan', 'parent_student_links').status, 'PASS');
  assert.equal(check(fail, 'orphan', 'parent_student_links').status, 'FAIL');
  assert.equal(check(fail, 'orphan', 'parent_student_links').count, 1);
  assert.equal(fail.ok, false);
});

test('one missing prerequisite blocks its check while independent checks still run', async () => {
  const columns = structuredClone(canonicalColumns);
  columns.student_enrollments = columns.student_enrollments.filter((column) => column !== 'term_id');
  const report = await runAdmissionWorkflowPreflight({ pool: fixture({ columns }).pool });
  assert.equal(check(report, 'duplicate', 'enrollment_context').status, 'NOT_CHECKED');
  assert.equal(check(report, 'duplicate', 'enrollment_context').category, 'MISSING_SCHEMA_PREREQUISITES');
  assert.equal(check(report, 'duplicate', 'enrollment_context').count, null);
  assert.equal(check(report, 'duplicate', 'student_permanent_id').status, 'PASS');
  assert.equal(check(report, 'orphan', 'parent_student_links').status, 'PASS');
  assert.equal(report.duplicateRecordTotal, null);
  assert.equal(report.ok, false);
});

test('missing prerequisites for all mandatory checks are never converted to zero', async () => {
  const report = await runAdmissionWorkflowPreflight({ pool: fixture({ columns: {} }).pool });
  assert.equal(report.schemaCompatibility, 'FAIL');
  assert.equal(report.duplicateRecordTotal, null);
  for (const item of [...report.checks.duplicate.filter((item) => item.mandatory), ...report.checks.orphan]) {
    assert.equal(item.status, 'NOT_CHECKED');
    assert.equal(item.count, null);
    assert.equal(item.category, 'MISSING_SCHEMA_PREREQUISITES');
  }
  assert.equal(report.ok, false);
});

test('a read-only query failure remains NOT_CHECKED and fails closed', async () => {
  const report = await runAdmissionWorkflowPreflight({ pool: fixture({ throwFor: { application_student_identity: true } }).pool });
  const result = check(report, 'duplicate', 'application_student_identity');
  assert.equal(result.status, 'NOT_CHECKED');
  assert.equal(result.category, 'READ_ONLY_QUERY_FAILED');
  assert.equal(result.count, null);
  assert.equal(report.duplicateRecordTotal, null);
  assert.equal(report.ok, false);
});

test('a null query count remains unavailable instead of becoming zero', async () => {
  const report = await runAdmissionWorkflowPreflight({ pool: fixture({ counts: { application_student_identity: null } }).pool });
  const result = check(report, 'duplicate', 'application_student_identity');
  assert.equal(result.status, 'NOT_CHECKED');
  assert.equal(result.category, 'INVALID_QUERY_RESULT');
  assert.equal(result.count, null);
  assert.equal(report.duplicateRecordTotal, null);
  assert.equal(report.ok, false);
});
