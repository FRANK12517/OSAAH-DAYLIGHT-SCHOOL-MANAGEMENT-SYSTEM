import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Migration 065 is additive, repeat-safe, scoped to existing subject tables, and preserves stored records', async () => {
  const sql = await read('../schema/065_subject_assessment_components.sql');
  assert.match(sql, /ALTER TABLE subjects[\s\S]*ADD COLUMN IF NOT EXISTS assessment_components_json JSON NULL/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_active TINYINT\(1\) NOT NULL DEFAULT 1/i);
  assert.match(sql, /ALTER TABLE subject_class_assignments[\s\S]*ADD COLUMN IF NOT EXISTS configuration_version VARCHAR\(32\) NULL/i);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO|UPDATE\s|INSERT\s+INTO)\b/i);
});

test('Migration 065 production runner is target-bound, ledger-aware, predecessor-gated, and checks historical counts', async () => {
  const script = await read('../scripts/production-subject-assessment-migrate.mjs');
  assert.match(script, /const VERSION = 65/);
  assert.match(script, /const NAME = '065_subject_assessment_components\.sql'/);
  assert.match(script, /const PREDECESSOR_VERSION = 64/);
  assert.match(script, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(script, /requiredAppliedVersions: \[PREDECESSOR_VERSION\]/);
  assert.match(script, /APPLY_SUBJECT_ASSESSMENT_065/);
  assert.match(script, /MIGRATION_065_PREEXISTING_COLUMNS/);
  assert.match(script, /ALLOWED_PREEXISTING_COLUMNS/);
  assert.match(script, /subject_class_assignments\.configuration_version/);
  assert.match(script, /MIGRATION_065_PREDECESSOR_NOT_VERIFIED/);
  assert.match(script, /MIGRATION_065_SCHEMA_VERIFICATION_FAILED/);
  assert.match(script, /MIGRATION_065_HISTORICAL_RECORD_COUNT_CHANGED/);
  assert.match(script, /assessment_components_json/);
  assert.match(script, /configuration_version/);
  assert.match(script, /schema_baselines/);
  assert.match(script, /information_schema\.COLUMNS/);
  assert.match(script, /productionWrites: 'NONE'/);
  assert.match(script, /productionWrites: 'SCHEMA_ONLY'/);
  assert.doesNotMatch(script, /runner\.apply\(|npm run migration:apply/i);
});

test('Migration 065 workflow requires the protected Production environment, exact main release SHA, backup attestation, and guarded apply token', async () => {
  const workflow = await read('../.github/workflows/production-subject-assessment-migration-065.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /secrets\.DATABASE_URL/);
  assert.match(workflow, /release_ref must be a full lowercase 40-character SHA/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /APPLY_SUBJECT_ASSESSMENT_065/);
  assert.match(workflow, /production-subject-assessment-migrate\.mjs dry-run/);
  assert.match(workflow, /production-subject-assessment-migrate\.mjs apply/);
  assert.match(workflow, /Apply only Migration 065/);
  assert.doesNotMatch(workflow, /npm run migration:apply/);
  assert.doesNotMatch(workflow, /^      DATABASE_URL:/m);
  assert.match(workflow, /Run focused migration contracts without production credentials/);
  assert.match(workflow, /DATABASE_URL: ''/);
});
