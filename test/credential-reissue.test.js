import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

const schoolId = 'sch_default_01';
const password = 'Test-password-123!';
const hash = (value, salt) => `${salt}:${scryptSync(value, salt, 32).toString('hex')}`;
const user = { id: 'credential-admin', username: 'admin@example.test', email: 'admin@example.test', passwordHash: hash(password, 'credential-salt'), portal: 'school', roleKey: 'SCHOOL_ADMIN', schoolId, permissions: new Set(['users.read', 'users.credentials.manage']) };
const target = { id: 'credential-target', username: 'teacher@example.test', email: 'teacher@example.test', passwordHash: hash(password, 'target-salt'), portal: 'school', roleKey: 'TEACHER', schoolId, permissions: new Set(['students.read']) };
function request(server, path, token) { return new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path, method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); }); }

test('authorized credential reissue returns one-time material and revokes target sessions without leaking hashes', async () => {
  const audit = [];
  const auth = createAuthService({ users: [user, target], sessionSecret: 'credential-reissue-test-session-secret', audit: (entry) => audit.push(entry) });
  const database = { query: async () => [{ id: target.id, username: target.username, email: target.email, status: 'ACTIVE', firstName: 'Target', lastName: 'Teacher', roleKey: 'TEACHER', roleName: 'Teacher' }] };
  const server = createServer(createApp({ auth, database, audit: (entry) => audit.push(entry), aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const login = auth.login({ username: user.username, password, portal: 'school', role: user.roleKey });
    assert.equal(login.ok, true);
    const result = await request(server, `/api/users/${target.id}/credentials/reissue`, login.token);
    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.ok, true);
    assert.equal(body.mustChangePassword, true);
    assert.match(body.temporaryPassword, /[A-Z]/);
    assert.match(body.temporaryPassword, /[a-z]/);
    assert.match(body.temporaryPassword, /\d/);
    assert.match(body.temporaryPassword, /[^A-Za-z0-9]/);
    assert.doesNotMatch(result.body, /passwordHash|password_hash|sessionToken|resetToken/i);
    assert.equal(audit.at(-1).action, 'CREDENTIALS_REISSUED');
    assert.doesNotMatch(JSON.stringify(audit), /password_hash|temporaryPassword|credential-salt/i);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});


test('canonical School Administrator role can reissue credentials despite an incomplete persisted permission set', async () => {
  const administrator = { ...user, id: 'credential-admin-incomplete', permissions: new Set(['users.read']) };
  const audit = [];
  const auth = createAuthService({ users: [administrator, target], sessionSecret: 'credential-reissue-admin-role-test-secret', audit: (entry) => audit.push(entry) });
  const database = { query: async () => [{ id: target.id, username: target.username, email: target.email, status: 'ACTIVE', firstName: 'Target', lastName: 'Teacher', roleKey: 'TEACHER', roleName: 'Teacher' }] };
  const server = createServer(createApp({ auth, database, audit: (entry) => audit.push(entry), aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const login = auth.login({ username: administrator.username, password, portal: 'school', role: administrator.roleKey });
    assert.equal(login.ok, true);
    const result = await request(server, `/api/users/${target.id}/credentials/reissue`, login.token);
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).ok, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
