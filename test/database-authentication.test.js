import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createDatabaseAuthenticationController } from '../src/database-authentication-controller.js';
import { createApp } from '../src/server.mjs';

const secret = 'test-jwt-secret-that-is-long-enough-for-hmac';
const hash = await bcrypt.hash('TestPassword123!', 4);
const scrypt = promisify(scryptCallback);
async function legacyScryptHash(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 32);
  return `${salt}:${digest.toString('hex')}`;
}
const record = { id: 'portal-owner-1', portal_name: 'proprietor', email: 'owner@osaah.edu.gh', password_hash: hash, role: 'PROPRIETOR', is_active: 1 };
const school = { schoolId: 'school-osaah-daylight', schoolName: 'OSAAH DAYLIGHT SCH. COM.' };

test('database login uses portal_users email or username and issues the protected JWT session', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    for (const identifier of [record.email, record.portal_name]) {
      const calls = [];
      const auth = createAuthService();
      const controller = createDatabaseAuthenticationController({
        auth,
        ...school,
        database: { query: async (...args) => { calls.push(args); return [record]; } }
      });
      const result = await controller({ username: identifier, password: 'TestPassword123!', portal: 'school', role: 'PROPRIETOR' });
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      assert.equal(result.body.user.id, record.id);
      assert.equal(result.body.user.email, record.email);
      assert.equal(result.body.user.username, record.portal_name);
      assert.equal(result.body.user.role, 'PROPRIETOR');
      assert.equal(result.body.user.redirectTo, '/dashboard');
      assert.equal(result.body.user.schoolId, school.schoolId);
      assert.equal(result.body.user.schoolName, school.schoolName);
      assert.match(result.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const session = auth.authenticate(result.body.token);
      assert.equal(session.id, record.id);
      assert.equal(session.permissions.has('*'), true);
      assert.equal(calls[0][0], 'SELECT id, portal_name, email, password_hash, role, is_active FROM portal_users WHERE (LOWER(email) = ? OR LOWER(portal_name) = ?) AND is_active = 1 LIMIT 2');
      assert.deepEqual(calls[0][1], [identifier.toLowerCase(), identifier.toLowerCase()]);
    }
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('database login applies role permissions and role-specific redirects', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    for (const [role, expectedRole, redirectTo] of [
      ['ADMINISTRATOR', 'SCHOOL_ADMIN', '/dashboard'],
      ['HEADTEACHER', 'HEADTEACHER', '/dashboard'],
      ['ASSISTANT_HEADTEACHER', 'ASSISTANT_HEADTEACHER', '/dashboard'],
      ['ACCOUNTANT', 'ACCOUNTANT_BURSAR', '/dashboard'],
      ['TEACHER', 'TEACHER', '/academics']
    ]) {
      const auth = createAuthService();
      const roleRecord = { ...record, password_hash: await legacyScryptHash('TestPassword123!'), role, portal_name: 'frank.abban', email: 'abbanfrank348@gmail.com' };
      const controller = createDatabaseAuthenticationController({
        auth,
        ...school,
        database: { query: async () => [roleRecord] }
      });
      const requestedRole = role === 'ADMINISTRATOR' ? 'SCHOOL_ADMIN' : role === 'ACCOUNTANT' ? 'ACCOUNTANT_BURSAR' : role;
      const result = await controller({ email: 'abbanfrank348@gmail.com', password: 'TestPassword123!', portal: 'school', role: requestedRole });
      assert.equal(result.status, 200, role);
      assert.equal(result.body.user.role, expectedRole);
      assert.equal(result.body.user.redirectTo, redirectTo);
      const session = auth.authenticate(result.body.token);
      assert.ok(session.permissions.size > 0);
      assert.equal(session.permissions.has('*'), role === 'PROPRIETOR');
    }
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('database authentication verifies explicit legacy scrypt hashes without changing bcrypt login', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const legacy = { ...record, password_hash: await legacyScryptHash('TestPassword123!'), role: 'TEACHER' };
    const controller = createDatabaseAuthenticationController({
      auth: createAuthService(),
      ...school,
      database: { query: async () => [legacy] }
    });
    const valid = await controller({ username: legacy.email, password: 'TestPassword123!', role: 'TEACHER' });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.user.role, 'TEACHER');
    assert.equal(valid.body.user.redirectTo, '/academics');

    const invalid = await controller({ username: legacy.email, password: 'WrongPassword123!', role: 'TEACHER' });
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, { success: false, error: 'Incorrect username or password.' });

    for (const malformed of ['salt:short', `${'a'.repeat(31)}:${'b'.repeat(64)}`, `${'a'.repeat(32)}:${'g'.repeat(64)}`]) {
      const malformedController = createDatabaseAuthenticationController({
        auth: createAuthService(),
        ...school,
        database: { query: async () => [{ ...legacy, password_hash: malformed }] }
      });
      assert.equal((await malformedController({ username: legacy.email, password: 'TestPassword123!' })).status, 401);
    }

    const bcryptController = createDatabaseAuthenticationController({
      auth: createAuthService(),
      ...school,
      database: { query: async () => [record] }
    });
    assert.equal((await bcryptController({ username: record.email, password: 'TestPassword123!' })).status, 200);
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('Teacher username and email identifiers authenticate to the same user and role', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const teacher = {
      ...record,
      id: 'teacher-fixture-1',
      portal_name: 'frank.abban',
      email: 'abbanfrank348@gmail.com',
      password_hash: await legacyScryptHash('TestPassword123!'),
      role: 'TEACHER'
    };
    const auth = createAuthService();
    const controller = createDatabaseAuthenticationController({
      auth,
      ...school,
      database: { query: async () => [teacher] }
    });
    const byUsername = await controller({ username: teacher.portal_name, password: 'TestPassword123!' });
    const byEmail = await controller({ username: teacher.email, password: 'TestPassword123!' });
    assert.equal(byUsername.status, 200);
    assert.equal(byEmail.status, 200);
    assert.equal(byUsername.body.user.id, byEmail.body.user.id);
    assert.equal(byUsername.body.user.role, 'TEACHER');
    assert.equal(byEmail.body.user.role, 'TEACHER');
    assert.equal(auth.authenticate(byUsername.body.token).id, teacher.id);
    assert.equal(auth.authenticate(byEmail.body.token).id, teacher.id);
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('database login validates the requested role and blocks school accounts from the parent portal', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    let calls = 0;
    const controller = createDatabaseAuthenticationController({
      auth: createAuthService(),
      ...school,
      database: { query: async () => { calls += 1; return [{ ...record, role: 'ADMINISTRATOR' }]; } }
    });
    const matchingAlias = await controller({ username: record.email, password: 'TestPassword123!', portal: 'school', role: 'Administrator' });
    assert.equal(matchingAlias.status, 200);
    assert.equal(matchingAlias.body.user.role, 'SCHOOL_ADMIN');

    const mismatch = await controller({ username: record.email, password: 'TestPassword123!', portal: 'school', role: 'PROPRIETOR' });
    assert.equal(mismatch.status, 401);
    assert.deepEqual(mismatch.body, { success: false, error: 'The selected role does not match this account.' });

    const unsupported = await controller({ username: record.email, password: 'TestPassword123!', portal: 'school', role: 'DEVELOPER' });
    assert.equal(unsupported.status, 401);
    assert.equal(unsupported.body.error, 'The selected role does not match this account.');

    const invalidPassword = await controller({ username: record.email, password: 'wrong', portal: 'school', role: 'PROPRIETOR' });
    assert.equal(invalidPassword.status, 401);
    assert.deepEqual(invalidPassword.body, { success: false, error: 'Incorrect username or password.' });

    const parentPortal = await controller({ username: record.email, password: 'TestPassword123!', portal: 'parent', role: 'PARENT' });
    assert.equal(parentPortal.status, 401);
    assert.deepEqual(parentPortal.body, { success: false, error: 'Incorrect username or password.' });
    assert.equal(calls, 4);
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('database login rejects missing, unknown, inactive, and unassigned-role accounts', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    let queries = 0;
    const controller = createDatabaseAuthenticationController({
      auth: createAuthService(),
      ...school,
      database: { query: async () => { queries += 1; return []; } }
    });
    assert.equal((await controller({ password: 'TestPassword123!' })).status, 401);
    assert.equal(queries, 0);
    assert.equal((await controller({ username: 'missing@example.test', password: 'TestPassword123!' })).status, 401);

    for (const invalidRecord of [
      { ...record, is_active: 0 },
      { ...record, role: null }
    ]) {
      const invalidController = createDatabaseAuthenticationController({
        auth: createAuthService(),
        ...school,
        database: { query: async () => [invalidRecord] }
      });
      assert.equal((await invalidController({ username: record.email, password: 'TestPassword123!' })).status, 401);
    }
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('database login fails closed without canonical school scope and sanitizes database errors', async () => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    const auth = createAuthService();
    let calls = 0;
    const unscoped = createDatabaseAuthenticationController({ auth, schoolId: '', database: { query: async () => { calls += 1; return [record]; } } });
    const scopeFailure = await unscoped({ email: record.email, password: 'TestPassword123!' });
    assert.equal(scopeFailure.status, 503);
    assert.equal(scopeFailure.code, 'AUTH_SCHOOL_SCOPE_REQUIRED');
    assert.equal(calls, 0);

    const broken = createDatabaseAuthenticationController({ auth, ...school, database: { query: async () => { throw new Error('private driver details'); } } });
    const unavailable = await broken({ email: record.email, password: 'TestPassword123!' });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.body, { success: false, error: 'Authentication service is temporarily unavailable.' });
    assert.doesNotMatch(JSON.stringify(unavailable), /private driver details/);
    const duplicate = createDatabaseAuthenticationController({ auth, ...school, database: { query: async () => [record, { ...record, id: 'duplicate' }] } });
    assert.equal((await duplicate({ email: record.email, password: 'TestPassword123!' })).status, 401);
    const wrongPassword = createDatabaseAuthenticationController({ auth, ...school, database: { query: async () => [record] } });
    assert.equal((await wrongPassword({ email: record.email, password: 'wrong' })).status, 401);
  } finally {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  }
});

test('both TiDB login routes issue HTTP-only cookies and restore role routing', async () => {
  const priorAdapter = process.env.OSAAH_DATABASE_ADAPTER, priorSecret = process.env.JWT_SECRET, priorEnv = process.env.NODE_ENV, priorSchool = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_DATABASE_ADAPTER = 'tidb';
  process.env.JWT_SECRET = secret;
  process.env.NODE_ENV = 'test';
  process.env.OSAAH_SCHOOL_ID = school.schoolId;
  const auth = createAuthService();
  const database = { query: async () => [record] };
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const post = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body), cookie: res.headers['set-cookie']?.[0] }));
    });
    req.on('error', reject); req.end(JSON.stringify({ username: record.email, password: 'TestPassword123!', portal: 'school' }));
  });
  try {
    for (const path of ['/api/auth/login', '/api/auth/proprietor/login']) {
      const login = await post(path);
      assert.equal(login.status, 200);
      assert.equal(login.body.success, true);
      assert.equal(login.body.user.redirectTo, '/dashboard');
      assert.match(login.cookie, /^osaah_session=/);
      assert.match(login.cookie, /HttpOnly/);
      const session = await new Promise((resolve, reject) => {
        const req = httpRequest({ port: server.address().port, path: '/api/auth/session', headers: { Cookie: login.cookie.split(';')[0] } }, (res) => {
          let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject); req.end();
      });
      assert.equal(session.status, 200);
      assert.equal(session.body.user.roleKey, 'PROPRIETOR');
      assert.equal(session.body.user.redirectTo, '/dashboard');
      assert.equal(session.body.redirectTo, '/dashboard');
      assert.equal(session.body.user.schoolId, school.schoolId);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of [['OSAAH_DATABASE_ADAPTER', priorAdapter], ['JWT_SECRET', priorSecret], ['NODE_ENV', priorEnv], ['OSAAH_SCHOOL_ID', priorSchool]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
