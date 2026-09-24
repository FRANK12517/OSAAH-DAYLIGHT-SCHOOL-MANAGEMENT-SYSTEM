import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

const passwordHash = (password, salt = 'auth-test-salt') => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;

function createDurableDatabase() {
  const sessions = new Map();
  const users = [{ id: 'db-accountant', schoolId: 'school-a', email: 'accountant@db.test', passwordHash: passwordHash('Accountant123!'), status: 'ACTIVE' }];
  return {
    supportsDurableAuthSessions: true,
    async query(sql, params = []) {
      if (sql.includes('FROM users u') && !sql.includes('FROM auth_sessions')) {
        const user = users.find((candidate) => candidate.email === params[0]);
        return user ? [{ ...user, username: user.email, roleKey: 'ACCOUNTANT_BURSAR', permissionKey: 'finance.read' }] : [];
      }
      if (sql.includes('FROM auth_sessions')) {
        const session = [...sessions.values()].find((candidate) => candidate.tokenHash === params[0] && !candidate.revokedAt && candidate.expiresAt > params[1]);
        return session ? [{ sessionId: session.id, userId: users[0].id, schoolId: users[0].schoolId, expiresAt: session.expiresAt, username: users[0].email, email: users[0].email, roleKey: 'ACCOUNTANT_BURSAR', permissionKey: 'finance.read' }] : [];
      }
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO auth_sessions')) {
        sessions.set(params[0], { id: params[0], userId: params[1], schoolId: params[2], tokenHash: params[3], expiresAt: params[5], revokedAt: null });
      } else if (sql.startsWith('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?')) {
        for (const session of sessions.values()) if (session.tokenHash === params[1]) session.revokedAt = params[0];
      }
      return { affectedRows: 1 };
    },
    sessions
  };
}

test('a second auth instance resolves a database session without instance A memory', async () => {
  const database = createDurableDatabase();
  const instanceA = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const login = await instanceA.loginFromDatabase({ username: 'accountant@db.test', password: 'Accountant123!', portal: 'school', role: 'ACCOUNTANT' });
  assert.equal(login.ok, true);
  const instanceB = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const actor = await instanceB.authenticateAsync(login.token);
  assert.equal(actor.id, 'db-accountant');
  assert.equal(actor.schoolId, 'school-a');
  assert.equal(actor.roleKey, 'ACCOUNTANT_BURSAR');
  assert.equal(actor.permissions.has('finance.read'), true);
  assert.equal(database.sessions.values().next().value.tokenHash, createHash('sha256').update(login.token).digest('hex'));
});

test('durable logout revokes the old token across instances', async () => {
  const database = createDurableDatabase();
  const instanceA = createAuthService({ users: [], database });
  const instanceB = createAuthService({ users: [], database });
  const login = await instanceA.loginFromDatabase({ username: 'accountant@db.test', password: 'Accountant123!', portal: 'school' });
  assert.ok(await instanceB.authenticateAsync(login.token));
  await instanceA.logoutSession(login.token);
  assert.equal(await instanceB.authenticateAsync(login.token), null);
});

test('durable session lookup rejects expired records', async () => {
  const database = createDurableDatabase();
  const now = Date.parse('2026-09-24T09:00:00.000Z');
  const instanceA = createAuthService({ users: [], database, now: () => now });
  const login = await instanceA.loginFromDatabase({ username: 'accountant@db.test', password: 'Accountant123!', portal: 'school' });
  const instanceB = createAuthService({ users: [], database, now: () => now + 31 * 60 * 1000 });
  assert.equal(await instanceB.authenticateAsync(login.token), null);
});
