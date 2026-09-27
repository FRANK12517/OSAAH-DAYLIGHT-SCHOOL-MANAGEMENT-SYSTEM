import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createUserDirectoryService, USER_DIRECTORY_SQL } from '../src/user-directory.js';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

const SCHOOL_ID = 'sch_default_01';
const passwordHash = (password, salt) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const actor = (id, roleKey, schoolId = SCHOOL_ID, permissions = ['users.read']) => ({ id, username: `${id}@test.invalid`, passwordHash: passwordHash('Test-password-123!', `${id}-salt`), portal: 'school', roleKey, schoolId, permissions: new Set(permissions) });

function startServer(app) {
  const server = createServer(app);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

function request(server, path, { method = 'GET', token, document = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(document ? { 'sec-fetch-mode': 'navigate' } : {})
    };
    const req = httpRequest({ port: server.address().port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, contentType: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('directory reads existing school users once, aggregates roles, and returns display-safe fields', async () => {
  let queryText;
  let queryParams;
  const rows = [
    { id: 'account-1', username: 'headteacher', email: 'head@osaah.example', status: 'ACTIVE', firstName: 'Ama', lastName: 'Mensah', roleKey: 'HEADTEACHER', roleName: 'Headteacher' },
    { id: 'account-1', username: 'headteacher', email: 'head@osaah.example', status: 'ACTIVE', firstName: 'Ama', lastName: 'Mensah', roleKey: 'TEACHER', roleName: 'Teacher' },
    { id: 'account-2', username: 'teacher-2', email: null, status: 'DISABLED', firstName: null, lastName: null, roleKey: null, roleName: null }
  ];
  const service = createUserDirectoryService({ canonicalSchoolId: SCHOOL_ID, database: { query: async (sql, params) => { queryText = sql; queryParams = params; return rows; } } });
  const users = await service.listFor(actor('administrator', 'SCHOOL_ADMIN'));

  assert.deepEqual(queryParams, [SCHOOL_ID]);
  assert.match(queryText, /FROM users u[\s\S]*LEFT JOIN user_roles ur[\s\S]*LEFT JOIN roles r/);
  assert.match(queryText, /WHERE u\.school_id = \?/);
  assert.match(queryText, /u\.email AS username/);
  assert.doesNotMatch(queryText, /oversight_rank/);
  assert.doesNotMatch(queryText, /password_hash|reset.?token|session.?token|api.?secret|authentication.?secret/i);
  assert.equal(users.length, 2);
  assert.deepEqual(users[0], {
    id: 'account-1', displayName: 'Ama Mensah', username: 'headteacher', email: 'head@osaah.example', status: 'ACTIVE',
    roles: [{ key: 'HEADTEACHER', name: 'Headteacher' }, { key: 'TEACHER', name: 'Teacher' }]
  });
  assert.deepEqual(users[1].roles, []);
  assert.equal(Object.hasOwn(users[0], 'schoolId'), false);
  assert.equal(Object.hasOwn(users[0], 'passwordHash'), false);
  assert.equal(Object.hasOwn(users[0], 'resetToken'), false);
  assert.equal(Object.hasOwn(users[0], 'sessionToken'), false);
});

test('directory service rejects accounts outside the canonical school and fails closed without a database', async () => {
  let queries = 0;
  const service = createUserDirectoryService({ canonicalSchoolId: SCHOOL_ID, database: { query: async () => { queries += 1; return []; } } });
  await assert.rejects(() => service.listFor(actor('other-school-admin', 'SCHOOL_ADMIN', 'other-school')), (error) => error.status === 403 && error.code === 'SCHOOL_CONTEXT_MISMATCH');
  assert.equal(queries, 0);
  const unavailable = createUserDirectoryService({ canonicalSchoolId: SCHOOL_ID });
  await assert.rejects(() => unavailable.listFor(actor('administrator', 'SCHOOL_ADMIN')), (error) => error.status === 503 && error.code === 'USER_DIRECTORY_UNAVAILABLE');
});

test('directory query failures remain generic to clients and log only sanitized schema diagnostics', async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const databaseError = Object.assign(new Error("Unknown column 'u.email' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22' });
    const service = createUserDirectoryService({ canonicalSchoolId: SCHOOL_ID, database: { query: async () => { throw databaseError; } } });
    await assert.rejects(() => service.listFor(actor('administrator', 'SCHOOL_ADMIN')), (error) => error.status === 503 && error.message === 'User directory service is unavailable.' && !error.message.includes('u.email'));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(logs, [['Users & Roles database query failed', { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', table: null, column: 'u.email' }]]);
});

test('Users & Roles API authorizes server-side, ignores requested school IDs, and never returns credentials', async () => {
  const databaseRows = [
    { id: 'osaah-admin', username: 'administrator', email: 'admin@osaah.example', status: 'ACTIVE', firstName: 'School', lastName: 'Administrator', roleKey: 'SCHOOL_ADMIN', roleName: 'Administrator' },
    { id: 'osaah-teacher', username: 'teacher-001', email: 'teacher@osaah.example', status: 'ACTIVE', firstName: 'Akua', lastName: 'Teacher', roleKey: 'TEACHER', roleName: 'Teacher' }
  ];
  const queryCalls = [];
  const database = { query: async (sql, params) => { queryCalls.push({ sql, params }); return databaseRows; } };
  const admin = actor('administrator', 'SCHOOL_ADMIN');
  const teacher = actor('teacher', 'TEACHER', SCHOOL_ID, ['students.read']);
  const foreignAdmin = actor('foreign-admin', 'SCHOOL_ADMIN', 'foreign-school');
  const auth = createAuthService({ users: [admin, teacher, foreignAdmin], sessionSecret: 'users-and-roles-test-session-secret' });
  const server = await startServer(createApp({ auth, database, aiEnabled: false }));
  try {
    const adminLogin = auth.login({ username: admin.username, password: 'Test-password-123!', portal: 'school', role: admin.roleKey });
    const teacherLogin = auth.login({ username: teacher.username, password: 'Test-password-123!', portal: 'school', role: teacher.roleKey });
    const foreignLogin = auth.login({ username: foreignAdmin.username, password: 'Test-password-123!', portal: 'school', role: foreignAdmin.roleKey });
    assert.equal(adminLogin.ok, true);
    assert.equal(teacherLogin.ok, true);
    assert.equal(foreignLogin.ok, true);

    const anonymous = await request(server, '/api/users');
    assert.equal(anonymous.status, 401);
    const forbidden = await request(server, '/api/users', { token: teacherLogin.token });
    assert.equal(forbidden.status, 403);
    const wrongSchool = await request(server, '/api/users', { token: foreignLogin.token });
    assert.equal(wrongSchool.status, 403);
    assert.equal(queryCalls.length, 0);

    const result = await request(server, '/api/users?schoolId=attacker-controlled-school', { token: adminLogin.token });
    assert.equal(result.status, 200);
    const payload = JSON.parse(result.body);
    assert.deepEqual(queryCalls[0].params, [SCHOOL_ID]);
    assert.equal(payload.users.length, 2);
    assert.equal(payload.users[0].displayName, 'School Administrator');
    assert.equal(payload.users[0].roles[0].name, 'Administrator');
    assert.doesNotMatch(result.body, /passwordHash|password_hash|resetToken|sessionToken|apiSecret|authSecret/i);

    const page = await request(server, '/users?embedded=1&navigationKey=users', { token: adminLogin.token, document: true });
    assert.equal(page.status, 200);
    assert.match(page.contentType, /text\/html/);
    assert.match(page.body, /School user directory/);
    assert.match(page.body, /fetch\('\/api\/users'/);
    assert.doesNotMatch(page.body, /administrator-management\.html|school selector|name="schoolId"/i);
    assert.equal(USER_DIRECTORY_SQL.includes('u.school_id = ?'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
