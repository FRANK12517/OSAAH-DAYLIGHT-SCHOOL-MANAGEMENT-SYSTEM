import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/production-rbac-inventory.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-rbac-inventory.yml', import.meta.url), 'utf8');
const foundation = await readFile(new URL('../schema/001_foundation.sql', import.meta.url), 'utf8');

test('Part 9 inventory inspects the exact production RBAC contract', () => {
  for (const table of ['users', 'user_roles', 'roles', 'role_permissions', 'permissions']) assert.match(script, new RegExp(`['"]${table}['"]`));
  assert.match(script, /SHOW CREATE TABLE/);
  assert.match(script, /information_schema\.COLUMNS/);
  assert.match(script, /information_schema\.STATISTICS/);
  assert.match(script, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(script, /GROUP BY role/);
  assert.match(script, /knownAccounts/);
  assert.match(script, /passwordHashPresent/);
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
