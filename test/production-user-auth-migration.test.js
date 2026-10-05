import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAuthService } from '../src/auth.js';

const migrationUrl = new URL('../schema/069_production_user_login_identifiers.sql', import.meta.url);
const workflowUrl = new URL('../.github/workflows/production-user-auth-migration-069.yml', import.meta.url);
const scriptUrl = new URL('../scripts/production-user-auth-migrate.mjs', import.meta.url);


test('production auth reports safe structured details for an unknown login column', async () => {
  const logged = [];
  const previousError = console.error;
  console.error = (...args) => logged.push(args);
  const database = {
    async query() {
      throw Object.assign(new Error("Unknown column 'u.username' in 'field list'"), {
        code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22'
      });
    }
  };
  try {
    const auth = createAuthService({ database, sessionSecret: 'test-only-session-secret-with-at-least-32-characters' });
    const result = await auth.loginFromDatabase({ username: 'safe@example.test', password: 'not-a-real-password', portal: 'school' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, 'Authentication service unavailable.');
    assert.equal(result.token, undefined);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'School database authentication query failed');
    assert.deepEqual(logged[0][1], {
      component: 'school_authentication', operation: 'login_lookup', category: 'SCHEMA_COLUMN_MISMATCH',
      code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', table: null, column: 'u.username'
    });
    assert.doesNotMatch(JSON.stringify(logged), /safe@example\.test|not-a-real-password|Unknown column/);
  } finally { console.error = previousError; }
});


test('migration 069 is additive and backfills only deterministic legacy login/timestamp values', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(fileURLToPath(migrationUrl), /069_production_user_login_identifiers\.sql$/);
  assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR\(191\) NULL DEFAULT NULL/i);
  assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at VARCHAR\(50\) NULL DEFAULT NULL/i);
  assert.match(sql, /UPDATE users SET username = email WHERE username IS NULL AND email IS NOT NULL/i);
  assert.match(sql, /UPDATE users SET updated_at = created_at WHERE updated_at IS NULL AND created_at IS NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_users_school_username ON users \(school_id, username\)/i);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|REPLACE)\b/i);
  assert.doesNotMatch(sql, /password_hash|password|secret|token/i);
});


test('production migration script is target-bound, version-allowlisted, and reports unrelated pending migrations without applying them', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  assert.match(script, /EXPECTED_DATABASE = 'osaahdaylightschool'/);
  assert.match(script, /APPLY_PRODUCTION_USER_AUTH_069/);
  assert.match(script, /BACKUP_CONFIRMED/);
  assert.match(script, /versions: \[VERSION\]/);
  assert.match(script, /requiredAppliedVersions: \[68\]/);
  assert.match(script, /pendingMigrationsOutsideScope/);
  assert.match(script, /runner\.applyVersions\(/);
  assert.doesNotMatch(script, /runner\.apply\(\)/);
  assert.match(script, /productionWrites: 'MIGRATION_069_ONLY'/);
});


test('production migration workflow requires the protected environment and a recent backup for apply', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /DRY_RUN_ONLY/);
  assert.match(workflow, /APPLY_PRODUCTION_USER_AUTH_069/);
  assert.match(workflow, /BACKUP_CONFIRMED/);
  assert.match(workflow, /Run read-only preflight/);
  assert.match(workflow, /Apply only the separately authorized Migration 069/);
});
