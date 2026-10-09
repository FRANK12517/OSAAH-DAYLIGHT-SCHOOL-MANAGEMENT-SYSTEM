import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';
test('migration 078 requires explicit protected-release authorization', () => {
  const migration = { version: 78, name: '078_admissions_leadership_access.sql' };
  assert.throws(() => assertProductionAcademicMigrationAllowed(migration), { code: 'ADMISSIONS_MIGRATION_REQUIRES_PROTECTED_RELEASE' });
  assert.doesNotThrow(() => assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: 78 }));
});
