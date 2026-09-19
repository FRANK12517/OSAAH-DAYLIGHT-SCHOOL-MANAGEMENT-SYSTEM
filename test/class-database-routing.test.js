import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

const schoolId = 'school-osaah-daylight';
const password = 'Part2Routing123!';
const hash = (id) => `${id}-salt:${scryptSync(password, `${id}-salt`, 32).toString('hex')}`;
const roles = ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
const allClasses = ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const users = roles.map((roleKey) => ({ id: `part2-${roleKey.toLowerCase()}`, username: `${roleKey.toLowerCase()}@part2.test`, passwordHash: hash(`part2-${roleKey.toLowerCase()}`), portal: 'school', roleKey, schoolId, permissions: new Set(['students.read', ...(roleKey === 'PROPRIETOR' ? ['*'] : [])]), assignedClassIds: roleKey === 'TEACHER' ? allClasses : [] }));

function request(server, path, token) { return new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); }); }

test('every authorized role maps to one exact Class Database sidebar route and component', async (t) => {
  const module = SIDEBAR_MODULES.find((item) => item.moduleKey === 'class-database');
  assert.ok(module); assert.equal(module.route, '/class-database.html'); assert.equal(module.category, 'STUDENTS MANAGEMENT'); assert.equal(module.requiredPermission, 'students.read');
  const auth = createAuthService({ users, sessionSecret: 'part2-routing-session-secret-0123456789' });
  const server = createServer(createApp({ auth })); await new Promise((resolve) => server.listen(0, resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const roleKey of roles) {
    const user = users.find((item) => item.roleKey === roleKey); const login = auth.login({ username: user.username, password, portal: 'school', role: roleKey }); assert.equal(login.ok, true, roleKey);
    const groups = visibleSidebar({ permissions: new Set([...user.permissions]), roleKey, portal: 'school' }); const studentGroup = groups.find((group) => group.category === 'STUDENTS MANAGEMENT' || group.category === 'STUDENT MANAGEMENT'); const item = studentGroup?.modules.find((entry) => entry.moduleKey === 'class-database'); assert.ok(item, `${roleKey} sidebar visibility`); assert.equal(item.route, '/class-database.html', roleKey);
    const page = await request(server, '/class-database.html?embedded=1&route=%2Fclass-database.html', login.token); assert.equal(page.status, 200, roleKey); assert.match(page.body, /CLASS DATABASE/); assert.match(page.body, /Permanent Student ID/); assert.match(page.body, /class-database\.js/); assert.doesNotMatch(page.body, /Coming Soon|Student Profiles|Student Search|Student Directory/);
    const options = await request(server, '/api/class-database/options', login.token); assert.equal(options.status, 200, `${roleKey} API`); assert.match(options.body, /Nursery 1/); assert.match(options.body, /JHS 3/);
  }
  const unauthenticated = await request(server, '/class-database.html?embedded=1', 'invalid-token'); assert.equal(unauthenticated.status, 401);
});

test('Class Database is a single route/component and is not aliased to generic student pages', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /navigateToRoute\(dashboard, route, title/); assert.match(source, /frame\.src = url\.pathname \+ url\.search/); assert.doesNotMatch(source, /class-database[^\n]*(students\.html|student-search|coming-soon)/i);
});
