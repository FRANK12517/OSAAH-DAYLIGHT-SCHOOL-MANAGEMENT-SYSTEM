import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';

const schoolId = 'school-a';
const password = 'Valid-Scoped-Password-123!';
const passwordHash = `auth-test-salt:${scryptSync(password, 'auth-test-salt', 32).toString('hex')}`;

function createDatabase({ roleSchoolId, sessionSchoolId = schoolId, roleKey = 'ACCOUNTANT_BURSAR', assigned = true } = {}) {
  const queries = [];
  const sessions = new Map();
  let currentRoleSchoolId = roleSchoolId;
  let currentSessionSchoolId = sessionSchoolId;
  return {
    queries,
    supportsDurableAuthSessions: true,
    setRoleSchoolId(value) { currentRoleSchoolId = value; },
    setSessionSchoolId(value) { currentSessionSchoolId = value; },
    async query(sql, params = []) {
      queries.push(sql);
      if (sql.includes('FROM users u') && !sql.includes('FROM auth_sessions')) {
        const roleIsVisible = assigned && (currentRoleSchoolId === schoolId || currentRoleSchoolId === null);
        return [{
          id: 'user-a', schoolId, username: 'accountant@school.test', email: 'accountant@school.test',
          passwordHash, status: 'ACTIVE', roleKey: roleIsVisible ? roleKey : null,
          permissionKey: roleIsVisible ? 'finance.read' : null
        }];
      }
      if (sql.includes('FROM auth_sessions')) {
        const session = [...sessions.values()].find((candidate) => candidate.tokenHash === params[0] && !candidate.revokedAt && candidate.expiresAt > params[1]);
        if (!session || currentSessionSchoolId !== schoolId) return [];
        const roleIsVisible = assigned && (currentRoleSchoolId === schoolId || currentRoleSchoolId === null);
        return [{ sessionId: session.id, userId: 'user-a', schoolId: currentSessionSchoolId, expiresAt: session.expiresAt, username: 'accountant@school.test', email: 'accountant@school.test', roleKey: roleIsVisible ? roleKey : null, permissionKey: roleIsVisible ? 'finance.read' : null }];
      }
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO auth_sessions')) sessions.set(params[0], { id: params[0], schoolId: params[2], tokenHash: params[3], expiresAt: params[5], revokedAt: null });
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

test('durable session restoration retains same-school and explicitly global roles', async (t) => {
  for (const roleSchoolId of [schoolId, null]) {
    await t.test(roleSchoolId ?? 'global role', async () => {
      const database = createDatabase({ roleSchoolId });
      const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
      const login = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });
      assert.equal(login.ok, true);

      const restored = await auth.authenticateAsync(login.token);
      assert.equal(restored.schoolId, schoolId);
      assert.equal(restored.roleKey, 'ACCOUNTANT_BURSAR');
      const restorationQuery = database.queries.find((query) => query.includes('FROM auth_sessions s JOIN users u'));
      assert.match(restorationQuery, /r\.school_id=u\.school_id OR r\.school_id IS NULL/);
      assert.match(restorationQuery, /s\.school_id=u\.school_id/);
    });
  }
});

test('durable sessions reject a role that becomes cross-school after login', async () => {
  const database = createDatabase({ roleSchoolId: schoolId });
  const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const login = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });
  assert.equal(login.ok, true);

  database.setRoleSchoolId('school-b');
  assert.equal(await auth.authenticateAsync(login.token), null);
});

test('durable sessions reject stored school context that differs from the user school', async () => {
  const database = createDatabase({ roleSchoolId: schoolId });
  const auth = createAuthService({ users: [], database, sessionSecret: 'test-session-secret-012345678901234567890' });
  const login = await auth.loginFromDatabase({ username: 'accountant@school.test', password, portal: 'school', role: 'ACCOUNTANT' });
  assert.equal(login.ok, true);

  database.setSessionSchoolId('school-b');
  const restored = await auth.authenticateAsync(login.token);
  assert.equal(restored, null);
  const restorationQuery = database.queries.find((query) => query.includes('FROM auth_sessions s JOIN users u'));
  assert.match(restorationQuery, /s\.school_id=u\.school_id/);
});
