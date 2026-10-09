import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const preflightPath = resolve('scripts/admission-workflow-migration-preflight.mjs');

test('Migration 078 production preflight is read-only and covers identity, sequence, relationships, and indexes', async () => {
  const source = await readFile(preflightPath, 'utf8');
  assert.doesNotMatch(source, /^\s*(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|REPLACE\s+INTO)\b/im);
  assert.match(source, /writesPerformed:\s*false/);
  assert.match(source, /SELECT VERSION\(\) AS server_version/);
  assert.match(source, /student_permanent_id/);
  assert.match(source, /annualSequenceReconciliation/);
  assert.match(source, /student_enrollment_students/);
  assert.match(source, /student_enrollment_classes/);
  assert.match(source, /student_enrollment_academic_years/);
  assert.match(source, /student_enrollment_terms/);
  assert.match(source, /indexDefinitionMismatches/);
  assert.match(source, /duplicateGroups/);
});
