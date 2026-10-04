import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const migration = await readFile(new URL('../schema/066_subject_class_assignments_reconciliation.sql', import.meta.url), 'utf8');
const runner = await readFile(new URL('../scripts/production-subject-class-assignments-reconciliation.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-subject-class-assignments-reconciliation.yml', import.meta.url), 'utf8');
const scoreSource = await readFile(new URL('../src/academic-results.js', import.meta.url), 'utf8');
const academicSource = await readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8');
const mockUi = await readFile(new URL('../public/mock-broadsheet.js', import.meta.url), 'utf8');

 test('Migration 066 is the next uniquely discovered migration and has a stable checksum', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const current = migrations.find((item) => item.version === 66);
  assert.ok(current);
  assert.equal(current.name, '066_subject_class_assignments_reconciliation.sql');
  assert.equal(current.checksum, createHash('sha256').update(migration).digest('hex'));
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
});

test('Migration 066 is additive and never drops, overwrites, or deletes data', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS subject_class_assignments/i);
  assert.match(migration, /INSERT IGNORE INTO subject_class_assignments/i);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)\b/i);
  assert.match(migration, /NOT EXISTS \(/i);
});

test('subject assignment schema preserves school isolation and required relationships', () => {
  for (const column of ['id VARCHAR(64)', 'school_id VARCHAR(191)', 'subject_id VARCHAR(191)', 'class_id VARCHAR(191)', 'academic_year_id VARCHAR(191) NULL', 'active TINYINT(1)', 'configuration_version VARCHAR(32)', 'created_at VARCHAR(32)', 'updated_at VARCHAR(32)']) assert.match(migration, new RegExp(column.replace(/[()]/g, '\\$&'), 'i'));
  assert.match(migration, /UNIQUE KEY uq_subject_class_assignment_scope \(school_id, subject_id, class_id, academic_year_id\)/i);
  assert.match(migration, /idx_subject_class_assignments_lookup \(school_id, class_id, academic_year_id, active\)/i);
  for (const table of ['schools', 'subjects', 'classes', 'academic_years']) assert.match(migration, new RegExp(`REFERENCES ${table}\\(id\\)`, 'i'));
});

test('legacy class_subjects reconciliation preserves existing subject IDs and derives school scope', () => {
  assert.match(migration, /FROM class_subjects cs\s+JOIN classes c ON c\.id = cs\.class_id\s+JOIN subjects s ON s\.id = cs\.subject_id AND s\.school_id = c\.school_id/i);
  assert.match(migration, /SHA2\(CONCAT\('subject-class-assignment:/i);
  assert.match(migration, /academic_year_id IS NULL/i);
});

test('Nursery through JHS 3 assignment cascading is supported by class-scoped lookup', () => {
  assert.match(migration, /school_id, class_id, academic_year_id, active/i);
  assert.match(academicSource, /subject_class_assignments/i);
  for (const className of ['Nursery', 'JHS 1', 'JHS 2', 'JHS 3']) assert.match(academicSource, new RegExp(className.replace(' ', '\\s+'), 'i'));
});

test('duplicate assignment prevention is school/year scoped and retry-safe', () => {
  assert.match(migration, /UNIQUE KEY uq_subject_class_assignment_scope/i);
  assert.match(migration, /WHERE NOT EXISTS \([\s\S]*academic_year_id IS NULL/i);
  assert.match(migration, /INSERT IGNORE/i);
});

test('preflight refuses missing prerequisites, invalid legacy relationships, and ambiguous partial tables', () => {
  assert.match(runner, /MIGRATION_066_PREREQUISITE_TABLE_MISSING/);
  assert.match(runner, /MIGRATION_066_LEGACY_MAPPING_INVALID/);
  assert.match(runner, /MIGRATION_066_ALREADY_PRESENT/);
  assert.match(runner, /MIGRATION_065_ALREADY_APPLIED/);
  assert.match(runner, /MIGRATION_063_064_065_FILES_MISSING/);
  assert.match(runner, /MIGRATION_\$\{target\.version\}_CHECKSUM_MISMATCH/);
});

test('foundation repair is explicitly runnable after 064 while 065 remains pending', async () => {
  assert.match(runner, /const PREDECESSOR_VERSION = 64/);
  assert.match(runner, /const DEPENDENT_VERSION = 65/);
  assert.match(runner, /requiredAppliedVersions: \[PREDECESSOR_VERSION\]/);
  assert.match(runner, /Migration 065 must remain pending/);
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const repair = migrations.find((item) => item.version === 66);
  const assessment = migrations.find((item) => item.version === 65);
  assert.equal(repair.name, '066_subject_class_assignments_reconciliation.sql');
  assert.equal(assessment.name, '065_subject_assessment_components.sql');
  assert.ok(repair.version > assessment.version);
});

test('066 is reserved for the prerequisite repair and the competing lifecycle 066 is not present on this release branch', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  assert.equal(migrations.filter((item) => item.version === 66).length, 1);
  assert.equal(migrations.find((item) => item.version === 66).name, '066_subject_class_assignments_reconciliation.sql');
  assert.doesNotMatch(migration, /academic_result_records/);
});

test('preflight is read-only by default and the workflow is protected', () => {
  assert.match(runner, /productionWrites: 'NONE'/);
  assert.match(runner, /executionToken !== APPLY_TOKEN/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_SUBJECT_CLASS_ASSIGNMENTS_066/);
});

test('academic_score_records remains the authoritative durable score contract', () => {
  assert.match(academicSource, /academic_score_records/);
  assert.match(academicSource, /INSERT INTO academic_score_records/);
  assert.match(academicSource, /UPDATE academic_score_records/);
  assert.doesNotMatch(migration, /canonical_academic_scores/i);
  assert.doesNotMatch(runner, /canonical_academic_scores/i);
});

test('Result Slip and mock restrictions remain outside the reconciliation schema', () => {
  assert.match(scoreSource, /assertMockEligible/);
  assert.match(scoreSource, /JHS 1.*JHS 2.*JHS 3/);
  assert.match(mockUi, /JHS \[123\]/);
  assert.doesNotMatch(migration, /result_signatures\s+SET|academic_score_records\s+SET|result_signatures\s+DROP/i);
});
