import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { randomBytes, scryptSync } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { createDurableAdministratorCredentialReset } from '../src/durable-administrator-credential-reset.js';
import { DEFAULT_PRODUCTION_SCHOOL_ID } from '../src/school-context.js';

const SCHOOL_ID = 'school-test-osaah';
const ADMIN_EMAIL = 'admin@example.test';
const PASSWORD_LENGTH = 24;

function testPassword() {
  return randomBytes(PASSWORD_LENGTH).toString('base64url');
}

function scryptHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function createDatabase({ duplicateAdministrator = false, failSessionRevocation = false, initialPasswordHash = 'old-hash' } = {}) {
  const initialUsers = [
    { id: 'admin-1', school_id: SCHOOL_ID, email: ADMIN_EMAIL, status: 'ACTIVE', password_hash: initialPasswordHash },
    { id: 'teacher-1', school_id: SCHOOL_ID, email: 'teacher@example.test', status: 'ACTIVE', password_hash: 'teacher-hash' },
    { id: 'disabled-admin', school_id: SCHOOL_ID, email: 'disabled@example.test', status: 'DISABLED', password_hash: 'disabled-hash' },
    { id: 'cross-school-admin', school_id: 'school-other', email: 'cross-school@example.test', status: 'ACTIVE', password_hash: 'other-hash' }
  ];
  const initialRoles = [
    { id: 'school-admin-role', school_id: SCHOOL_ID, role_key: 'SCHOOL_ADMIN', oversight_rank: 90 },
    { id: 'teacher-role', school_id: SCHOOL_ID, role_key: 'TEACHER', oversight_rank: 40 },
    { id: 'other-admin-role', school_id: 'school-other', role_key: 'SCHOOL_ADMIN', oversight_rank: 90 }
  ];
  const initialUserRoles = [
    { user_id: 'admin-1', role_id: 'school-admin-role' },
    { user_id: 'teacher-1', role_id: 'teacher-role' },
    { user_id: 'disabled-admin', role_id: 'school-admin-role' },
    { user_id: 'cross-school-admin', role_id: 'other-admin-role' }
  ];
  if (duplicateAdministrator) {
    initialUsers.push({ id: 'admin-2', school_id: SCHOOL_ID, email: ADMIN_EMAIL, status: 'ACTIVE', password_hash: 'duplicate-hash' });
    initialUserRoles.push({ user_id: 'admin-2', role_id: 'school-admin-role' });
  }
  let state = {
    users: initialUsers,
    roles: initialRoles,
    userRoles: initialUserRoles,
    sessions: [
      { id: 'admin-session-active', user_id: 'admin-1', school_id: SCHOOL_ID, token_hash: 'active-admin-token', revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' },
      { id: 'admin-session-revoked', user_id: 'admin-1', school_id: SCHOOL_ID, token_hash: 'old-admin-token', revoked_at: '2026-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' },
      { id: 'teacher-session-active', user_id: 'teacher-1', school_id: SCHOOL_ID, token_hash: 'active-teacher-token', revoked_at: null, expires_at: '2099-01-01T00:00:00.000Z' }
    ]
  };

  function queryFor(store, sql, params = []) {
    if (sql.includes('FROM users u') && sql.includes('LIMIT 2 FOR UPDATE')) {
      const [schoolId, selector] = params;
      const emailTarget = sql.includes('LOWER(COALESCE(u.email');
      return store.users.filter((user) => {
        const identityMatches = emailTarget
          ? String(user.email ?? '').toLowerCase() === String(selector).toLowerCase()
          : user.id === selector;
        const active = String(user.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE';
        return user.school_id === schoolId && identityMatches && active;
      }).slice(0, 2).map((user) => ({ userId: user.id, email: user.email }));
    }
    if (sql.includes('FROM user_roles ur') && sql.includes('JOIN roles r') && sql.includes('FOR UPDATE')) {
      const [userId, schoolId] = params;
      return store.userRoles.filter((link) => link.user_id === userId).flatMap((link) => {
        const role = store.roles.find((candidate) => candidate.id === link.role_id);
        return role?.role_key === 'SCHOOL_ADMIN' && (role.school_id === schoolId || role.school_id == null) ? [{ roleId: role.id }] : [];
      });
    }
    if (sql.includes('FROM users u') && sql.includes('LEFT JOIN user_roles ur')) {
      const [email] = params;
      return store.users.filter((user) => String(user.email ?? '').toLowerCase() === String(email).toLowerCase()).flatMap((user) => {
        return store.userRoles.filter((link) => link.user_id === user.id).flatMap((link) => {
          const role = store.roles.find((candidate) => candidate.id === link.role_id);
          return role ? [{ id: user.id, schoolId: user.school_id, username: user.email, email: user.email, passwordHash: user.password_hash, status: user.status, roleKey: role.role_key, oversightRank: role.oversight_rank, permissionKey: null }] : [];
        });
      });
    }
    if (sql.includes('SELECT DISTINCT sa.class_id AS classId')) return [];
    if (sql.includes('FROM auth_sessions s JOIN users u')) return [];
    return [];
  }

  function executeFor(store, sql, params = []) {
    if (sql.startsWith('UPDATE users SET password_hash=')) {
      const [passwordHash, userId, schoolId] = params;
      const user = store.users.find((row) => row.id === userId && row.school_id === schoolId && row.status === 'ACTIVE');
      if (!user) return { affectedRows: 0 };
      user.password_hash = passwordHash;
      return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE auth_sessions SET revoked_at=')) {
      if (failSessionRevocation) throw new Error('injected session persistence failure');
      const [revokedAt, userId, schoolId] = params;
      let affectedRows = 0;
      for (const session of store.sessions) {
        if (session.user_id === userId && session.school_id === schoolId && !session.revoked_at) {
          session.revoked_at = revokedAt;
          affectedRows += 1;
        }
      }
      return { affectedRows };
    }
    if (sql.startsWith('INSERT INTO auth_sessions')) {
      const [id, userId, schoolId, tokenHash, createdAt, expiresAt] = params;
      store.sessions.push({ id, user_id: userId, school_id: schoolId, token_hash: tokenHash, created_at: createdAt, expires_at: expiresAt, revoked_at: null });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE auth_sessions SET last_used_at=')) return { affectedRows: 0 };
    throw new Error(`Unimplemented fake execute: ${sql}`);
  }

  return {
    supportsDurableAuthSessions: true,
    async query(sql, params = []) { return queryFor(state, sql, params); },
    async execute(sql, params = []) { return executeFor(state, sql, params); },
    async transaction(callback) {
      const working = structuredClone(state);
      const tx = {
        query: (sql, params = []) => queryFor(working, sql, params),
        execute: (sql, params = []) => executeFor(working, sql, params)
      };
      const result = await callback(tx);
      state = working;
      return result;
    },
    snapshot() { return structuredClone(state); }
  };
}

test('durable Administrator reset persists a login-compatible hash and revokes only the target account sessions', async () => {
  const oldPassword = testPassword();
  const database = createDatabase({ initialPasswordHash: scryptHash(oldPassword) });
  const auth = createAuthService({ database });
  const initialLogin = await auth.loginFromDatabase({ username: ADMIN_EMAIL, password: oldPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(initialLogin.ok, true);

  const newPassword = testPassword();
  const reset = await auth.resetAdministratorCredentialsByEmail(`  ${ADMIN_EMAIL.toUpperCase()}  `, newPassword, SCHOOL_ID);
  assert.equal(reset.email, ADMIN_EMAIL);
  assert.equal(reset.sessionsRevoked, 2);
  assert.equal(Object.hasOwn(reset, 'newPassword'), false);
  assert.equal(Object.hasOwn(reset, 'temporaryPassword'), false);

  const stored = database.snapshot();
  const target = stored.users.find((user) => user.id === 'admin-1');
  assert.notEqual(target.password_hash, newPassword);
  assert.equal(target.password_hash.includes(':'), true);
  const activeTargetSession = stored.sessions.find((session) => session.id === 'admin-session-active');
  assert.ok(activeTargetSession.revoked_at);
  assert.equal(stored.sessions.find((session) => session.id === 'admin-session-revoked').revoked_at, '2026-01-01T00:00:00.000Z');
  assert.equal(stored.sessions.find((session) => session.id === 'teacher-session-active').revoked_at, null);

  const newLogin = await auth.loginFromDatabase({ username: ADMIN_EMAIL, password: newPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(newLogin.ok, true);
  const oldLogin = await auth.loginFromDatabase({ username: ADMIN_EMAIL, password: oldPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(oldLogin.ok, false);
});

test('durable reset rejects non-administrators, inactive/cross-school accounts, ambiguous matches, and weak passwords', async () => {
  const database = createDatabase({ duplicateAdministrator: true });
  const reset = createDurableAdministratorCredentialReset({ database, passwordHash: (password) => `hashed:${password}` });
  const before = database.snapshot();

  await assert.rejects(reset.resetByEmail('teacher@example.test', testPassword(), SCHOOL_ID), { code: 'ADMINISTRATOR_NOT_FOUND' });
  await assert.rejects(reset.resetByEmail('disabled@example.test', testPassword(), SCHOOL_ID), { code: 'ADMINISTRATOR_NOT_FOUND' });
  await assert.rejects(reset.resetByEmail('cross-school@example.test', testPassword(), SCHOOL_ID), { code: 'ADMINISTRATOR_NOT_FOUND' });
  await assert.rejects(reset.resetByEmail(ADMIN_EMAIL, testPassword(), SCHOOL_ID), { code: 'AMBIGUOUS_ADMINISTRATOR' });
  await assert.rejects(reset.resetByEmail(ADMIN_EMAIL, 'short', SCHOOL_ID), { code: 'INVALID_PASSWORD' });
  assert.deepEqual(database.snapshot(), before);
});

test('durable reset rolls back both password and session changes if revocation persistence fails', async () => {
  const database = createDatabase({ failSessionRevocation: true });
  const reset = createDurableAdministratorCredentialReset({ database, passwordHash: (password) => `hashed:${password}` });
  const before = database.snapshot();
  await assert.rejects(reset.resetByEmail(ADMIN_EMAIL, testPassword(), SCHOOL_ID), /injected session persistence failure/);
  assert.deepEqual(database.snapshot(), before);
});

test('durable reset fails closed unless durable sessions and transactional persistence are available', () => {
  assert.throws(() => createDurableAdministratorCredentialReset({ database: { query() {}, execute() {}, transaction() {}, supportsDurableAuthSessions: false }, passwordHash: (password) => password }), { code: 'PERSISTENCE_UNAVAILABLE' });
  assert.throws(() => createDurableAdministratorCredentialReset({ database: { query() {}, execute() {}, supportsDurableAuthSessions: true }, passwordHash: (password) => password }), { code: 'PERSISTENCE_UNAVAILABLE' });
});

function postJson(server, path, token, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: server.address().port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

test('reset API is Proprietor-only, returns no password, audits no secret, and disables the legacy memory-only path', async () => {
  const newPassword = testPassword();
  const actor = { id: 'proprietor-test', roleKey: 'PROPRIETOR', schoolId: DEFAULT_PRODUCTION_SCHOOL_ID, portal: 'school', permissions: new Set(['*']) };
  const teacher = { id: 'teacher-test', roleKey: 'TEACHER', schoolId: DEFAULT_PRODUCTION_SCHOOL_ID, portal: 'school', permissions: new Set() };
  const calls = [];
  const auditEntries = [];
  const auth = {
    async authenticateAsync(token) {
      if (token === 'proprietor-token') return actor;
      if (token === 'teacher-token') return teacher;
      return null;
    },
    async resetAdministratorCredentialsByEmail(email, password, schoolId) {
      calls.push({ email, password, schoolId });
      return { userId: 'target-admin-id', sessionsRevoked: 2 };
    }
  };
  const database = { supportsDurableAuthSessions: true, async query() { return []; }, async execute() { return { affectedRows: 0 }; }, async transaction(callback) { return callback(this); } };
  const server = createServer(createApp({ auth, database, audit: (entry) => auditEntries.push(entry), aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const body = { email: ADMIN_EMAIL, newPassword };
    const unauthenticated = await postJson(server, '/api/administrator-credentials/reset', null, body);
    assert.equal(unauthenticated.status, 401);
    const forbidden = await postJson(server, '/api/administrator-credentials/reset', 'teacher-token', body);
    assert.equal(forbidden.status, 403);
    assert.equal(calls.length, 0);

    const success = await postJson(server, '/api/administrator-credentials/reset', 'proprietor-token', body);
    assert.equal(success.status, 200);
    const responseBody = JSON.parse(success.body);
    assert.deepEqual(responseBody, { ok: true, sessionsRevoked: 2 });
    assert.equal(success.body.includes(newPassword), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].password, newPassword);
    assert.equal(calls[0].schoolId, DEFAULT_PRODUCTION_SCHOOL_ID);
    assert.equal(JSON.stringify(auditEntries).includes(newPassword), false);
    assert.equal(auditEntries.some((entry) => entry.action === 'ADMINISTRATOR_CREDENTIAL_RESET'), true);

    const legacy = await postJson(server, '/api/administrators/target-admin-id/reset-credentials', 'proprietor-token', {});
    assert.equal(legacy.status, 410);
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
