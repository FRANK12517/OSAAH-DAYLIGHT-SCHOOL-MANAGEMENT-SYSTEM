import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSummary } from '../scripts/summarize-admissions-078-preflight.mjs';

const duplicateNames = ['enquiry_retry_identity', 'application_student_identity', 'application_permanent_student_identity', 'enrollment_context', 'student_permanent_id', 'profile_student_id'];
const orphanNames = ['admission_application_students', 'student_profile_master', 'student_enrollment_students', 'student_enrollment_classes', 'student_enrollment_academic_years', 'student_enrollment_terms', 'parent_student_links'];
const check = (name, mandatory = true, status = 'PASS', count = 0, category = 'NONE', reason = null, missingPrerequisites = []) => ({ name, mandatory, status, count, category, reason, missingPrerequisites });

function report() {
  return {
    ok: false, mode: 'READ_ONLY_PREFLIGHT', writesPerformed: false, databaseEngine: 'TiDB',
    missingPrerequisites: ['student_enrollments.is_current'],
    schemaObjectFindings: [{ table: 'student_enrollments', tableStatus: 'PRESENT', tableType: 'BASE TABLE', missingColumns: ['is_current'] }],
    columnDefinitionMismatches: [], indexDefinitionMismatches: [], invalidSequenceYears: [], counterBehindYears: [], annualSequenceReconciliation: [], malformedStudentIdCount: 0,
    checks: {
      duplicate: duplicateNames.map((name) => name === 'enrollment_context' ? check(name, true, 'NOT_CHECKED', null, 'MISSING_SCHEMA_PREREQUISITES', 'Missing: student_enrollments.is_current', ['student_enrollments.is_current']) : check(name, !name.includes('identity') || name === 'application_student_identity')),
      orphan: orphanNames.map((name) => check(name))
    }
  };
}

test('summarizer retains runnable checks when one prerequisite is missing', () => {
  const summary = buildSummary(report(), 2);
  assert.equal(summary.failureCategory, 'MIGRATION_PREREQUISITES_MISSING');
  assert.equal(summary.duplicateRecordCounts.student_permanent_id, 0);
  assert.equal(summary.duplicateRecordCounts.enrollment_context, null);
  assert.equal(summary.orphanRecordCounts.parent_student_links, 0);
  assert.equal(summary.orphanRecordCounts.student_enrollment_students, 0);
  assert.equal(summary.duplicateCheckStatus, 'NOT_CHECKED');
  assert.equal(summary.orphanCheckStatus, 'COMPLETE');
  assert.equal(summary.ok, false);
});
