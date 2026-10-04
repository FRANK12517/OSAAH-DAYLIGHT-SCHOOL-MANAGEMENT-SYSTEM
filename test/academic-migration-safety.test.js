import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInMemoryMigrationAdapter, createMigrationRunner } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

 test('generic synthetic Migration 055 exercises transaction and lock behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-migration-055-'));
  try {
    await writeFile(join(directory, '055_synthetic_test.sql'), 'SELECT 55;');
    const adapter = createInMemoryMigrationAdapter();
    const runner = createMigrationRunner({ adapter, directory });
    const result = await runner.applyVersions({ versions: [55] });
    assert.deepEqual(result.applied.map((row) => row.version), [55]);
    assert.deepEqual(adapter.storage.statements, ['SELECT 55;']);
    assert.equal(adapter.storage.locked, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('production policy always rejects the historical competing score migration', () => {
  for (const migration of [
    { version: 55, name: '055_canonical_academic_scores.sql' },
    { version: 99, name: '055_canonical_academic_scores.sql' }
  ]) assert.throws(() => assertProductionAcademicMigrationAllowed(migration), { code: 'LEGACY_COMPETING_SCORE_STORE_BLOCKED' });
});

test('production policy blocks 067 and 068 unless their own protected workflow authorizes that exact version', () => {
  for (const version of [67, 68]) {
    const migration = { version, name: `${String(version).padStart(3, '0')}_test.sql` };
    assert.throws(() => assertProductionAcademicMigrationAllowed(migration));
    assert.doesNotThrow(() => assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: version }));
    assert.throws(() => assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: version === 67 ? 68 : 67 }));
  }
});

test('production CLI and legacy release workflow apply the guard before execution', async () => {
  const cli = await readFile(new URL('../scripts/migrate.mjs', import.meta.url), 'utf8');
  const legacyWorkflow = await readFile(new URL('../scripts/apply-final-result-slip-reconciliation.mjs', import.meta.url), 'utf8');
  assert.match(cli, /if \(command === 'apply'\)/);
  assert.match(cli, /assertProductionAcademicMigrationAllowed\(migration\)/);
  assert.match(legacyWorkflow, /assertProductionAcademicMigrationAllowed\(\{ version: 55/);
  assert.ok(legacyWorkflow.indexOf("assertProductionAcademicMigrationAllowed({ version: 55") < legacyWorkflow.indexOf('adapter = await adapterFactory'));
});
