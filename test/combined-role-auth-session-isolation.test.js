import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createCredentialedTestParent } from './helpers/parent-login-fixture.js';

const staffCases = [
  ['proprietor', 'PROPRIETOR', '/'],
  ['administrator', 'SCHOOL_ADMIN', '/settings'],
  ['headteacher', 'HEADTEACHER', '/academics'],
  ['assistant-headteacher', 'ASSISTANT_HEADTEACHER', '/academics'],
  ['accountant', 'ACCOUNTANT_BURSAR', '/fees'],
  ['teacher', 'TEACHER', '/academics']
];

function encodedTestPassword() {
  const password = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  return { password, passwordHash: `${salt}:${scryptSync(password, salt, 32).toString('hex')}` };
}

test('synthetic Parent plus six staff logins keep identities, roles, routes, and logout isolated', async () => {
  const parent = await createCredentialedTestParent('sch_default_01');
  const staff = staffCases.map(([username, roleKey]) => {
    const credential = encodedTestPassword();
    return {
      user: {
        id: `synthetic-${username}`,
        username: `${username}@example.invalid`,
        email: `${username}@example.invalid`,
        portal: 'school',
        roleKey,
        schoolId: 'sch_default_01',
        accountStatus: 'ACTIVE',
        is_active: true,
        permissions: new Set(['children.read', 'students.read']),
        passwordHash: credential.passwordHash
      },
      password: credential.password
    };
  });
  const auth = createAuthService({ users: [...staff.map(({ user }) => user)], database: parent.database, sessionSecret: 'test-only-parent-session-secret-0123456789' });
  const logins = [];
<<<<<<< Updated upstream
  const parentLogin = await auth.loginParentByPhone({ phone: parent.user.phone, portal: 'parent', verifiedOtp: true });
=======
  const parentLogin = await auth.loginParentByPhone({ phone: parent.user.phone, portal: 'parent' });
>>>>>>> Stashed changes
  assert.equal(parentLogin.ok, true);
  logins.push({ id: parent.user.id, roleKey: 'PARENT', route: '/', token: parentLogin.token });

  for (let index = 0; index < staffCases.length; index += 1) {
    const [username, roleKey, route] = staffCases[index];
    const { user, password } = staff[index];
    const result = auth.login({ username: user.username, password, portal: 'school', role: roleKey });
    assert.equal(result.ok, true, roleKey);
    assert.equal(result.user.id, user.id);
    assert.equal(result.user.roleKey, roleKey);
    assert.equal(result.redirectTo, route);
    logins.push({ id: user.id, roleKey, route, token: result.token, username });
  }

  assert.equal(new Set(logins.map((entry) => entry.token)).size, logins.length);
  for (const expected of logins) {
    const session = auth.authenticate(expected.token);
    assert.equal(session.id, expected.id);
    assert.equal(session.roleKey, expected.roleKey);
    assert.equal(session.schoolId, 'sch_default_01');
  }
  assert.equal(auth.login({ username: staff[0].user.username, password: staff[0].password, portal: 'school', role: 'TEACHER' }).ok, false);

  await auth.logoutSession(logins[0].token);
  assert.equal(await auth.authenticateAsync(logins[0].token), null);
  for (const remaining of logins.slice(1)) assert.equal(auth.authenticate(remaining.token).id, remaining.id);
});
