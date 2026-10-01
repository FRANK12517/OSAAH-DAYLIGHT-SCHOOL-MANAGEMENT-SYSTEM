import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createInMemoryMigrationAdapter, createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { ASSIGNMENT_SCHEMA_TABLES, isAssignmentMigrationRecorded, readAssignmentMigrationLedger, readAssignmentSchemaSnapshot } from '../src/platform/assignment-migration-schema.js';

const migration = await readFile(new URL('../schema/062_assignments.sql', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-assignment-migration-062.yml', import.meta.url), 'utf8');
const preflight = await readFile(new URL('../scripts/production-assignment-migration.mjs', import.meta.url), 'utf8');

test('assignment migration is discovered as additive migration 062', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const current = migrations.find((item) => item.version === 62);
  assert.ok(current);
  assert.equal(current.name, '062_assignments.sql');
  assert.equal(migrations.find((item) => item.version === 62)?.name, '062_assignments.sql');
  assert.match(current.checksum, /^[a-f0-9]{64}$/);
});

test('assignment migration preserves school isolation, publication state, recipients, and private file metadata', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assignments/i);
  assert.deepEqual([...migration.matchAll(/school_id VARCHAR\((\d+)\) NOT NULL/gi)].map((match) => match[1]), ['191', '191']);
  assert.match(migration, /recipient_student_ids JSON NOT NULL/);
  assert.match(migration, /status VARCHAR\(16\) NOT NULL DEFAULT 'DRAFT'/);
  assert.match(migration, /published_by VARCHAR\(64\) NULL/);
  assert.match(migration, /published_at VARCHAR\(32\) NULL/);
  assert.match(migration, /fk_assignments_school FOREIGN KEY \(school_id\) REFERENCES schools\(id\)/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assignment_files/i);
  assert.match(migration, /storage_reference VARCHAR\(1024\) NOT NULL/);
  assert.match(migration, /fk_assignment_files_assignment FOREIGN KEY \(assignment_id\) REFERENCES assignments\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /fk_assignment_files_school FOREIGN KEY \(school_id\) REFERENCES schools\(id\)/i);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\b(TRUNCATE|DELETE FROM)\b/i);
});

test('assignment table, column, index, and foreign-key inventory executes scoped parameterized SQL', async () => {
  const calls = [];
  const adapter = { async query(sql, parameters) { calls.push({ sql, parameters }); return []; } };
  const snapshot = await readAssignmentSchemaSnapshot(adapter);
  assert.deepEqual(snapshot, { tables: [], columns: [], indexes: [], constraints: [] });
  assert.equal(calls.length, 4);
  assert.match(calls[0].sql, /information_schema\.TABLES[\s\S]*TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(calls[1].sql, /information_schema\.COLUMNS[\s\S]*TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(calls[2].sql, /information_schema\.STATISTICS[\s\S]*TABLE_SCHEMA = DATABASE\(\)/);
  for (const call of calls) assert.deepEqual(call.parameters, [...ASSIGNMENT_SCHEMA_TABLES]);

  const foreignKeys = calls[3].sql;
  assert.match(foreignKeys, /SELECT k\.TABLE_NAME AS tableName,\s*k\.CONSTRAINT_NAME AS constraintName,/);
  assert.match(foreignKeys, /JOIN information_schema\.REFERENTIAL_CONSTRAINTS AS r\s+ON r\.CONSTRAINT_SCHEMA = k\.CONSTRAINT_SCHEMA\s+AND r\.CONSTRAINT_NAME = k\.CONSTRAINT_NAME\s+AND r\.TABLE_NAME = k\.TABLE_NAME/);
  assert.match(foreignKeys, /WHERE k\.CONSTRAINT_SCHEMA = DATABASE\(\) AND k\.TABLE_NAME IN \(\?, \?\)/);
  assert.match(foreignKeys, /ORDER BY k\.TABLE_NAME, k\.CONSTRAINT_NAME, k\.ORDINAL_POSITION/);
  assert.doesNotMatch(foreignKeys, /SELECT\s+TABLE_NAME\b|ORDER BY\s+TABLE_NAME\b/);
});

test('assignment ledger lookup is read-only, scoped to versions 061/062, and distinguishes pending from applied', async () => {
  const target = (await discoverMigrations(new URL('../schema', import.meta.url))).find((item) => item.version === 62);
  const calls = [];
  let metadataOptions;
  const rows = [
    { version: 61, name: '061_previous.sql', checksum: 'prior-checksum' },
    { version: '62', name: target.name, checksum: target.checksum }
  ];
  const adapter = {
    async ensureMetadata(options) { metadataOptions = options; },
    async query(sql, parameters) { calls.push({ sql, parameters }); return rows; }
  };
  const ledger = await readAssignmentMigrationLedger(adapter);
  assert.deepEqual(metadataOptions, { create: false });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM schema_migrations WHERE version IN \(\?, \?\) ORDER BY version/);
  assert.deepEqual(calls[0].parameters, [61, 62]);
  assert.equal(isAssignmentMigrationRecorded(ledger, target), true);
  assert.equal(isAssignmentMigrationRecorded(ledger.filter((row) => Number(row.version) !== 62), target), false);
  assert.equal(isAssignmentMigrationRecorded([{ ...rows[1], checksum: 'different-checksum' }], target), false);
});

test('Migration 062 dry-run reports the pending release migration without writes or acquiring a lock', async () => {
  const directory = new URL('../schema', import.meta.url);
  const migrations = await discoverMigrations(directory);
  const predecessor = migrations.find((item) => item.version === 61);
  const target = migrations.find((item) => item.version === 62);
  assert.ok(predecessor);
  assert.ok(target);
  const storage = {
    applied: [{ version: 61, name: predecessor.name, checksum: predecessor.checksum, appliedAt: '2026-10-01T00:00:00.000Z' }],
    baselines: [{ reconciliationMigration: predecessor.name }]
  };
  const adapter = createInMemoryMigrationAdapter(storage);
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const result = await runner.applyVersions({ versions: [62], requiredAppliedVersions: [61], dryRun: true });
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.pending.map((item) => item.version), [62]);
  assert.deepEqual(storage.statements, []);
  assert.equal(storage.locked, false);
  assert.equal(storage.metadataEnsured, true);
});

test('assignment production migration is manual, exact-SHA, read-only by default, and explicitly gated', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_ASSIGNMENTS_062/);
  assert.match(workflow, /merge-base --is-ancestor/);
  assert.match(workflow, /run: \|\n\s+\[\[ "\$RELEASE_REF" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.doesNotMatch(workflow, /run:\s+\[\[/);
  assert.match(workflow, /production-assignment-migration\.mjs dry-run/);
  assert.match(workflow, /inputs\.execution_token == 'APPLY_ASSIGNMENTS_062'/);
  assert.doesNotMatch(workflow, /059|060|061/);
  assert.match(preflight, /requiredAppliedVersions: \[61\]/);
  assert.match(preflight, /versions: \[VERSION\]/);
  assert.match(preflight, /productionWrites: 'NONE'/);
  assert.match(preflight, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(preflight, /readAssignmentSchemaSnapshot\(adapter\)/);
  assert.match(preflight, /MIGRATION_062_SCHEMA_INCOMPATIBLE/);
  assert.match(preflight, /information_schema\.COLUMNS/);
  assert.match(preflight, /schoolIdCompatibility/);
  assert.match(preflight, /MIGRATION_APPROVAL_REQUIRED/);
  assert.doesNotMatch(preflight, /059|060|061/);
});
