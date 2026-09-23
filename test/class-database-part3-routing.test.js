import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { resolveRouteContract } from '../src/sidebar-route-contract.js';

const schoolId = 'school-osaah-daylight';
const password = 'Part3Routing123!';
const hash = (id) => `${id}-salt:${scryptSync(password, `${id}-salt`, 32).toString('hex')}`;
const roles = ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
const allClasses = ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const users = roles.map((roleKey) => ({ id: `part3-${roleKey.toLowerCase()}`, username: `${roleKey.toLowerCase()}@part3.test`, passwordHash: hash(`part3-${roleKey.toLowerCase()}`), portal: 'school', roleKey, schoolId, permissions: new Set(['students.read', ...(roleKey === 'PROPRIETOR' ? ['*'] : [])]), assignedClassIds: roleKey === 'TEACHER' ? allClasses : [] }));

function request(server, path, token, method = 'GET', cookie = false) {
  return new Promise((resolve, reject) => {
    const headers = token ? { [cookie ? 'Cookie' : 'Authorization']: cookie ? `osaah_session=${token}` : `Bearer ${token}` } : {};
    const req = httpRequest({ port: server.address().port, path, method, headers }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.end();
  });
}

function classDatabaseItem(roleKey) {
  return visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['students.read', '*']), roleKey, portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]))
    .find((module) => module.moduleKey === 'class-database');
}

test('all required roles expose one canonical Class Database exact-view route', () => {
  const registryItem = SIDEBAR_MODULES.find((module) => module.moduleKey === 'class-database');
  assert.ok(registryItem);
  assert.equal(registryItem.route, '/class-database.html');
  assert.equal(registryItem.category, 'STUDENTS MANAGEMENT');
  assert.equal(registryItem.requiredPermission, 'students.read');
  assert.equal(resolveRouteContract(registryItem).exactView, 'class-database');
  assert.equal(resolveRouteContract(registryItem).component, '/class-database.html');
  assert.equal(PROPRIETOR_SIDEBAR_ROUTES.find((module) => module.moduleKey === 'class-database')?.page, '/class-database.html');
  for (const roleKey of roles) {
    const item = classDatabaseItem(roleKey);
    assert.ok(item, `${roleKey} sidebar item`);
    assert.equal(item.navigationKey, 'class-database', roleKey);
    assert.equal(item.route, '/class-database.html', roleKey);
    assert.equal(item.exactView, 'class-database', roleKey);
    assert.equal(item.component, '/class-database.html', roleKey);
  }
  assert.equal(SIDEBAR_MODULES.filter((module) => module.moduleKey === 'class-database').length, 1);
  assert.equal(new Set(SIDEBAR_MODULES.map((module) => module.navigationKey)).size, SIDEBAR_MODULES.length);
});

test('role sidebar, exact page, refresh state, API authorization, and logout protection work together', async (t) => {
  const auth = createAuthService({ users, sessionSecret: 'part3-routing-session-secret-0123456789' });
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const roleKey of roles) {
    const user = users.find((item) => item.roleKey === roleKey);
    const login = auth.login({ username: user.username, password, portal: 'school', role: roleKey });
    assert.equal(login.ok, true, `${roleKey} login`);
    const sidebar = await request(server, '/api/sidebar', login.token);
    assert.equal(sidebar.status, 200, `${roleKey} sidebar`);
    const groups = JSON.parse(sidebar.body).categories;
    const item = groups.flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])])).find((module) => module.moduleKey === 'class-database');
    assert.ok(item, `${roleKey} visible sidebar`);
    assert.equal(item.route, '/class-database.html', roleKey);
    const page = await request(server, '/class-database.html?embedded=1&route=%2Fclass-database.html&navigationKey=class-database&view=class-database', login.token);
    assert.equal(page.status, 200, `${roleKey} page`);
    assert.match(page.body, /CLASS DATABASE/);
    assert.match(page.body, /Academic Year/);
    assert.match(page.body, /class-database\.js/);
    assert.doesNotMatch(page.body, /Coming Soon|Student Profiles|Student Search|Student Directory|generic dashboard/i);
    const options = await request(server, '/api/class-database/options', login.token);
    assert.equal(options.status, 200, `${roleKey} options`);
    assert.match(options.body, /Nursery 1/);
    assert.match(options.body, /JHS 3/);
    const logout = await request(server, '/api/auth/logout', login.token, 'POST', true);
    assert.equal(logout.status, 204, `${roleKey} logout`);
    assert.equal((await request(server, '/api/class-database/options')).status, 401, `${roleKey} API after logout`);
    assert.equal((await request(server, '/class-database.html?embedded=1')).status, 401, `${roleKey} route after logout`);
  }
  assert.equal((await request(server, '/api/class-database/options')).status, 401, 'unauthenticated API');
  assert.equal((await request(server, '/class-database.html?embedded=1')).status, 401, 'unauthenticated route');
});

test('Class Database navigation is not aliased to a generic student page', async () => {
  const app = await (await import('node:fs/promises')).readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /navigateToRoute\(dashboard, route, title/);
  assert.match(app, /frame\.src = url\.pathname \+ url\.search/);
  assert.doesNotMatch(app, /class-database[^\n]*(students\.html|student-search|coming-soon)/i);
});
