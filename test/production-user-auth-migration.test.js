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
    assert.match(logged[0][1].requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(logged[0][1], {
      component: 'school_authentication', operation: 'login_lookup', category: 'SCHEMA_COLUMN_MISMATCH',
      requestId: logged[0][1].requestId,
      requestPath: null, name: 'Error', code: 'ER_BAD_FIELD_ERROR', sqlState: '42S22', severity: null,
      errno: 1054, message: '[redacted-diagnostic-text]', detail: null, hint: null, context: null,
      schema: null, table: null, column: null, constraint: null, routine: null
    });
    assert.doesNotMatch(JSON.stringify(logged), /safe@example\.test|not-a-real-password/);
  } finally { console.error = previousError; }
});

test('PostgreSQL login diagnostics capture safe fields and redact sensitive values from logs and response', async () => {
  const logged = [];
  const previousError = console.error;
  console.error = (...args) => logged.push(args);
  const database = {
    async query() {
      throw Object.assign(new Error('failure for user staff@example.test with password=secret-login'), {
        name: 'error', code: 'XX000', severity: 'ERROR', schema: 'public', table: 'users', column: 'email',
        constraint: 'users_email_key', routine: 'lookup_user',
        detail: 'Failing row contains (Ama Mensah, +233241234567, top-secret-access-code)',
        hint: 'check https://db.example.test/path?password=url-secret',
        where: "SQL statement \"SELECT * FROM users WHERE email='student@example.test'\"",
        query: 'SELECT with bind values', parameters: ['secret-login', 'student@example.test']
      });
    }
  };
  try {
    const auth = createAuthService({ database, sessionSecret: 'test-only-session-secret-with-at-least-32-characters' });
    const result = await auth.loginFromDatabase({ username: 'student@example.test', password: 'secret-login', portal: 'school', diagnosticContext: { requestId: 'req-1234', requestPath: '/api/auth/login' } });
    assert.equal(result.status, 503);
    assert.deepEqual(result, { ok: false, status: 503, error: 'Authentication service unavailable.' });
    assert.equal(logged.length, 1);
    const payload = logged[0][1];
    assert.deepEqual({ requestId: payload.requestId, requestPath: payload.requestPath, code: payload.code, sqlState: payload.sqlState, severity: payload.severity, schema: payload.schema, table: payload.table, column: payload.column, constraint: payload.constraint, routine: payload.routine }, {
      requestId: 'req-1234', requestPath: '/api/auth/login', code: 'XX000', sqlState: 'XX000', severity: 'ERROR', schema: 'public', table: 'users', column: 'email', constraint: 'users_email_key', routine: 'lookup_user'
    });
    assert.ok(payload.message);
    assert.ok(payload.detail);
    assert.ok(payload.hint);
    assert.ok(payload.context);
    const output = JSON.stringify({ logged, result });
    for (const secret of ['secret-login', 'student@example.test', 'staff@example.test', 'Ama Mensah', '+233241234567', 'top-secret-access-code', 'url-secret', 'db.example.test', 'SELECT with bind values']) assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(JSON.stringify(payload), /\[redacted-diagnostic-text\]/);
  } finally { console.error = previousError; }
});

test('PostgreSQL login diagnostics tolerate missing fields and reject unsafe identifiers', async () => {
  const logged = [];
  const previousError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const auth = createAuthService({ database: { async query() { throw Object.assign(new Error('relation "auth_roles" does not exist'), { code: '42P01', schema: 'bad schema\nsecret' }); } }, sessionSecret: 'test-only-session-secret-with-at-least-32-characters' });
    const result = await auth.loginFromDatabase({ username: 'test', password: 'test', portal: 'school' });
    assert.equal(result.status, 503);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].sqlState, '42P01');
    assert.equal(logged[0][1].schema, null);
    assert.equal(logged[0][1].table, 'auth_roles');
    assert.equal(logged[0][1].detail, null);
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
