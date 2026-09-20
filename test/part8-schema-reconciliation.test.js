import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const auth = await readFile(new URL('../src/auth.js', import.meta.url), 'utf8');
const inventory = await readFile(new URL('../scripts/production-schema-inventory.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-schema-inventory.yml', import.meta.url), 'utf8');
const foundation = await readFile(new URL('../schema/001_foundation.sql', import.meta.url), 'utf8');

test('Part 8 identifies the exact authentication query and canonical table contract', () => {
  assert.match(auth, /FROM users u/);
  assert.match(auth, /LEFT JOIN user_roles ur ON ur\.user_id=u\.id/);
  assert.match(auth, /LEFT JOIN roles r ON r\.id=ur\.role_id/);
  assert.match(auth, /LEFT JOIN role_permissions rp ON rp\.role_id=r\.id/);
  assert.match(auth, /LEFT JOIN permissions p ON p\.id=rp\.permission_id/);
  assert.match(auth, /Table \['`\]\(\[\^'`\]\+\)\['`\] doesn't exist/);
  assert.match(auth, /table: tableName/);
  assert.match(auth, /split\('\.'\)\.pop\(\)/);
  for (const column of ['id', 'school_id', 'username', 'email', 'password_hash', 'status']) assert.match(auth, new RegExp(`u\\.${column === 'school_id' ? 'school_id' : column}`));
});

test('Part 8 confirms the canonical foundation migration creates users and role tables', () => {
  for (const table of ['users', 'staff', 'roles', 'permissions', 'user_roles', 'role_permissions']) {
    assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

test('Part 8 inventory is read-only and targets the intended database without exposing secrets', () => {
  assert.match(inventory, /SELECT DATABASE\(\)/);
  assert.match(inventory, /information_schema\.TABLES/);
  assert.match(inventory, /information_schema\.COLUMNS/);
  assert.match(inventory, /osaahdaylightschool/);
  assert.doesNotMatch(inventory, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE /i);
  assert.doesNotMatch(inventory, /console\.log\(.*DATABASE_URL/i);
});

test('Part 8 workflow is manually triggered and does not mutate production', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/production-schema-inventory\.mjs/);
  assert.doesNotMatch(workflow, /migration:apply|production-admission-migrate|DROP TABLE|TRUNCATE|DELETE FROM/i);
});
