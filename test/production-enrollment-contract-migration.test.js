import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production enrollment migration is explicitly scoped to version 059', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-enrollment-contract-migration.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/production-enrollment-contract-migrate.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /APPLY_ENROLLMENT_CONTRACT_059/);
  assert.match(workflow, /production-enrollment-contract-migrate\.mjs dry-run/);
  assert.match(workflow, /production-enrollment-contract-migrate\.mjs apply/);
  assert.match(workflow, /secrets\.DATABASE_URL/);
  assert.match(script, /const VERSION = 59/);
  assert.match(script, /const NAME = '059_backward_compatible_enrollment_contract\.sql'/);
  assert.match(script, /applyVersions\(\{ versions: \[VERSION\]/);
  assert.match(script, /DATABASE_TARGET_MISMATCH/);
  assert.match(script, /MIGRATION_059_SCHEMA_VERIFICATION_FAILED/);
  assert.match(script, /historicalTermsFabricated: 0/);
  assert.doesNotMatch(workflow, /npm run migration:apply/);
  assert.doesNotMatch(script, /DROP\s+(TABLE|COLUMN|DATABASE)|TRUNCATE|DELETE\s+FROM/i);
});
