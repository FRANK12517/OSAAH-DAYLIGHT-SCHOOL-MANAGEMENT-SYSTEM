import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAuthService, SCHOOL_PORTAL_DASHBOARDS } from '../src/auth.js';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../src/roles.js';

const password = 'Unsupported-Test-Only-2026!';
const salt = 'unsupported-role-test-salt';
const passwordHash = `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;

test('Admissions is assigned to existing leadership roles, not a separate role identity', async () => {
  assert.deepEqual(
    ROLE_DEFINITIONS.filter(({ roleKey }) => ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(roleKey)).map(({ roleKey }) => roleKey),
    ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']
  );
  assert.equal(ROLE_KEYS.has('ADMISSIONS_OFFICER'), false);
  assert.equal(Object.hasOwn(SCHOOL_PORTAL_DASHBOARDS, 'ADMISSIONS_OFFICER'), false);
  assert.equal(Object.hasOwn(SCHOOL_PORTAL_DASHBOARDS, 'PROPRIETOR'), true);
  assert.equal(SCHOOL_PORTAL_DASHBOARDS.HEADTEACHER, '/academics');
  assert.equal(SCHOOL_PORTAL_DASHBOARDS.ASSISTANT_HEADTEACHER, '/academics');

  const [loginPage, rolesSource, authSource] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/roles.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/auth.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(loginPage, /ADMISSIONS_OFFICER|Admissions Officer|Admission Officer/);
  assert.doesNotMatch(rolesSource, /ADMISSIONS_OFFICER|Admissions Officer|Admission Officer/);
  assert.doesNotMatch(authSource, /ADMISSIONS_OFFICER|Admissions Officer|Admission Officer/);
});

test('an obsolete role assignment is rejected without conversion by local and database login', async () => {
  const legacyUser = {
    id: 'legacy-assignment', username: 'legacy@example.test', passwordHash,
    portal: 'school', roleKey: 'ADMISSIONS_OFFICER', schoolId: 'school-a',
    permissions: new Set(['admissions.read', 'admissions.write'])
  };
  const localAuth = createAuthService({ users: [legacyUser] });
  const localLogin = localAuth.login({ username: legacyUser.username, password, portal: 'school', role: legacyUser.roleKey });
  assert.equal(localLogin.ok, false);
  assert.equal(localLogin.status, 401);
  assert.equal(localLogin.user, undefined);

  const database = {
    async query(sql) {
      if (sql.includes('FROM users u')) return [{
        id: legacyUser.id, schoolId: legacyUser.schoolId, username: legacyUser.username,
        passwordHash, status: 'ACTIVE', roleKey: legacyUser.roleKey,
        oversightRank: 50, permissionKey: 'admissions.read'
      }];
      return [];
    }
  };
  const databaseAuth = createAuthService({ users: [], database });
  const databaseLogin = await databaseAuth.loginFromDatabase({
    username: legacyUser.username, password, portal: 'school', role: legacyUser.roleKey
  });
  assert.equal(databaseLogin.ok, false);
  assert.equal(databaseLogin.status, 401);
  assert.equal(databaseLogin.user, undefined);
});
