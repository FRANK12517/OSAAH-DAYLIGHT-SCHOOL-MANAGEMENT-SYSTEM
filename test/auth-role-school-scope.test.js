import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

const schoolId = 'school-a';
const password = 'Valid-Scoped-Password-123!';
const passwordHash = `auth-test-salt:${scryptSync(password, 'auth-test-salt', 32).toString('hex')}`;

function createDatabase({ roleSchoolId, roleKey = 'ACCOUNTANT_BURSAR', assigned = true } = {}) {
  const queries = [];
  const sessions = new Map();
  return {
    queries,
    supportsDurableAuthSessions: true,
    async query(sql, params = []) {
      queries.push(sql);
      if (sql.includes('FROM users u') && !sql.includes('FROM auth_sessions')) {
        const roleIsVisible = assigned && (roleSchoolId === schoolId || roleSchoolId === null);
        return [{
          id: 'user-a', schoolId, username: 'accountant@school.test', email: 'accountant@school.test',
          passwordHash, status: 'ACTIVE', roleKey: roleIsVisible ? roleKey : null,
          permissionKey: roleIsVisible ? 'finance.read' : null
        }];
      }
      if (sql.includes('FROM auth_sessions')) {
        const session = [...sessions.values()].find((candidate) => candidate.tokenHash === params[0] && !candidate.revokedAt && candidate.expiresAt > params[1]);
        return session ? [{ sessionId: session.id, userId: 'user-a', schoolId, expiresAt: session.expiresAt, username: 'accountant@school.test', email: 'accountant@school.test', roleKey, permissionKey: 'finance.read' }] : [];
      }
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO auth_sessions')) sessions.set(params[0], { id: params[0], tokenHash: params[3], expiresAt: params[5], revokedAt: null });
      if (sql.startsWith('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?')) {
        for (const session of sessions.values()) if (session.tokenHash === params[1]) session.revokedAt = params[0];
      }
      return { affectedRows: 1 };
    }
  };
}

test('database role join limits authorization to same-school or explicitly global roles', async () => {
  const database = createDatabase({ roleSchoolId: schoolId });
  const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const result = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });

  assert.equal(result.ok, true);
  assert.equal(result.user.schoolId, schoolId);
  assert.equal(result.user.roleKey, 'ACCOUNTANT_BURSAR');
  assert.match(database.queries[0], /LEFT JOIN roles r ON r\.id=ur\.role_id AND \(r\.school_id=u\.school_id OR r\.school_id IS NULL\)/);
});

test('cross-school role assignments cannot authorize a database user', async () => {
  const database = createDatabase({ roleSchoolId: 'school-b' });
  const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const result = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(database.queries[0], /r\.school_id=u\.school_id OR r\.school_id IS NULL/);
});

test('role assignment absence remains rejected and global roles remain supported', async (t) => {
  await t.test('missing role assignment', async () => {
    const database = createDatabase({ roleSchoolId: schoolId, assigned: false });
    const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
    const result = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  await t.test('explicit global role', async () => {
    const database = createDatabase({ roleSchoolId: null });
    const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
    const result = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });
    assert.equal(result.ok, true);
    assert.equal(result.user.roleKey, 'ACCOUNTANT_BURSAR');
  });
});
