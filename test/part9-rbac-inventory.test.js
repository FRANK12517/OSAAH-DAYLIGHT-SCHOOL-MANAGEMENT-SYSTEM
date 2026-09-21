import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/production-rbac-inventory.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-rbac-inventory.yml', import.meta.url), 'utf8');
const foundation = await readFile(new URL('../schema/001_foundation.sql', import.meta.url), 'utf8');
const reconcile = await readFile(new URL('../scripts/production-rbac-reconcile.mjs', import.meta.url), 'utf8');
const reconcileWorkflow = await readFile(new URL('../.github/workflows/production-rbac-reconcile.yml', import.meta.url), 'utf8');
const focusedMigration = await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8');
const classReconcile = await readFile(new URL('../scripts/production-class-catalog-reconcile.mjs', import.meta.url), 'utf8');
const classWorkflow = await readFile(new URL('../.github/workflows/production-class-catalog-reconcile.yml', import.meta.url), 'utf8');
const classMigration = await readFile(new URL('../schema/033_canonical_class_catalog_reconciliation.sql', import.meta.url), 'utf8');

test('Part 9 inventory inspects the exact production RBAC contract', () => {
  for (const table of ['users', 'user_roles', 'roles', 'role_permissions', 'permissions']) assert.match(script, new RegExp(`['"]${table}['"]`));
  assert.match(script, /SHOW CREATE TABLE/);
  assert.match(script, /information_schema\.COLUMNS/);
  assert.match(script, /information_schema\.STATISTICS/);
  assert.match(script, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(script, /GROUP BY role/);
  assert.match(script, /knownAccounts/);
  assert.match(script, /passwordHashPresent/);
  assert.match(script, /legacyUserRoleLinks/);
  assert.match(script, /SELECT user_id AS userId, role_id AS roleId/);
  assert.doesNotMatch(script, /password_hash[^\n]*SELECT|console\.log\([^)]*password/i);
});

test('Part 9 inventory is read-only and protects production data', () => {
  assert.match(script, /SELECT DATABASE\(\)/);
  assert.match(script, /osaahdaylightschool/);
  assert.doesNotMatch(script, /ALTER TABLE|DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE /i);
  assert.doesNotMatch(workflow, /migration:apply|production-admission-migrate|DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('Part 9 confirms the full foundation contains potentially conflicting existing-table creation', () => {
  for (const table of ['users', 'user_roles', 'roles', 'permissions', 'role_permissions']) assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS user_roles/);
});

test('Part 9 focused reconciliation never recreates or mutates users/user_roles', () => {
  assert.match(reconcile, /TARGET_TABLE_ALREADY_EXISTS/);
  assert.match(reconcile, /EXPLICIT_CONFIRMATION_REQUIRED/);
  assert.match(reconcile, /CONFIRM_PRODUCTION_RBAC_RECONCILIATION/);
  assert.match(focusedMigration, /CREATE TABLE IF NOT EXISTS roles/);
  assert.match(focusedMigration, /CREATE TABLE IF NOT EXISTS permissions/);
  assert.match(focusedMigration, /CREATE TABLE IF NOT EXISTS role_permissions/);
  assert.doesNotMatch(focusedMigration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE users|UPDATE user_roles|CREATE TABLE IF NOT EXISTS users|CREATE TABLE IF NOT EXISTS user_roles/i);
  assert.match(focusedMigration, /INSERT IGNORE INTO user_roles/);
  assert.match(reconcileWorkflow, /APPLY_PART9_RBAC_RECONCILIATION/);
  assert.match(reconcileWorkflow, /production-rbac-reconcile\.mjs --apply/);
});

test('Part 9 class catalog reconciliation is exact, idempotent, and scoped', () => {
  for (const name of ['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3']) assert.match(classMigration, new RegExp(name));
  assert.match(classMigration, /INSERT IGNORE INTO classes/);
  assert.match(classMigration, /sch_default_01/);
  assert.doesNotMatch(classMigration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE users|UPDATE students|INSERT INTO fee_structures/i);
  assert.match(classReconcile, /APPLY_PART9_CLASS_CATALOG_RECONCILIATION/);
  assert.match(classReconcile, /CANONICAL_CLASSES_MISSING/);
  assert.match(classWorkflow, /production-class-catalog-reconcile\.mjs --apply/);
});
