import test from 'node:test';
import assert from 'node:assert/strict';
import { previewExistingStudentMigration } from '../src/admission-migration-preview.js';

test('dry-run proposes only verified-year IDs, preserves valid IDs and does not mutate input', () => {
  const records = [
    { id: 'a', firstName: 'Ama', surname: 'Mensah', dateOfBirth: '2017-02-03', admissionDate: '2020-09-01' },
    { id: 'b', firstName: 'Kojo', surname: 'Mensah', dateOfBirth: '2015-01-01', admissionDate: '2019-09-02', permanentStudentId: 'OSAAH/2019/0007' }
  ];
  const before = structuredClone(records);
  const result = previewExistingStudentMigration(records);
  assert.deepEqual(records, before);
  assert.equal(result.dryRun, true);
  assert.equal(result.writesPerformed, 0);
  assert.equal(result.counts.eligible, 1);
  assert.equal(result.records[0].action, 'ASSIGN_ID_FOR_VERIFIED_YEAR');
  assert.equal(result.records[0].admissionYear, 2020);
  assert.equal(result.records[1].action, 'PRESERVE_EXISTING_ID');
  assert.deepEqual(previewExistingStudentMigration(records), result);
});

test('dry-run flags duplicate identities, duplicate/malformed IDs, and missing historical years', () => {
  const records = [
    { id: 'a', firstName: 'Ama', surname: 'Mensah', dateOfBirth: '2017-02-03', admissionDate: '2020-09-01', permanentStudentId: 'OSAAH/2020/0001' },
    { id: 'b', firstName: ' ama ', surname: 'MENSAH', dateOfBirth: '2017-02-03', admissionDate: '2020-09-01', permanentStudentId: 'OSAAH/2020/0001' },
    { id: 'c', firstName: 'Kofi', surname: 'Boateng', dateOfBirth: '2016-01-01', admissionDate: '2016-02-30', permanentStudentId: 'bad-id' }
  ];
  const result = previewExistingStudentMigration(records);
  assert.equal(result.counts.manualReview, 3);
  assert.ok(result.records[0].reasons.includes('POSSIBLE_DUPLICATE_IDENTITY'));
  assert.ok(result.records[0].reasons.includes('DUPLICATE_PERMANENT_STUDENT_ID'));
  assert.ok(result.records[2].reasons.includes('MALFORMED_PERMANENT_STUDENT_ID'));
  assert.ok(result.records[2].reasons.includes('UNVERIFIED_ADMISSION_YEAR'));
  assert.ok(result.records.every((row) => !('firstName' in row) && !('surname' in row)));
});
