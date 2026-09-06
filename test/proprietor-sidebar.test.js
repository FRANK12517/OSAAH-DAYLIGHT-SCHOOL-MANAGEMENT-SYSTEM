import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { PROPRIETOR_SIDEBAR_CATEGORIES, SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

test('proprietor navigation follows executive priority and retains every authorized module', () => {
  const groups = visibleSidebar({ permissions: new Set(['*']), roleKey: 'PROPRIETOR', portal: 'school' });
  assert.deepEqual(groups.map((group) => group.category), [...PROPRIETOR_SIDEBAR_CATEGORIES, 'LOGOUT']);
  assert.equal(groups[0].modules[0].moduleKey, 'dashboard');
  assert.equal(groups[1].category, 'ADMINISTRATIVE');
  assert.equal(groups.at(-1).modules[0].moduleKey, 'logout');
  const expected = SIDEBAR_MODULES.filter((module) => module.enabled && module.visible && !module.parentDashboard && (!module.allowedRoles.length || module.allowedRoles.includes('PROPRIETOR'))).map((module) => module.moduleKey).sort();
  const actual = groups.flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])])).map((module) => module.moduleKey).sort();
  assert.deepEqual(actual, expected);
});

test('proprietor sidebar is an accessible responsive accordion with route-based active state', async () => {
  const [script, css] = await Promise.all([readFile(new URL('../public/app.js', import.meta.url), 'utf8'), readFile(new URL('../public/styles.css', import.meta.url), 'utf8')]);
  assert.match(script, /sidebar-group-toggle/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /aria-current="page"/);
  assert.match(script, /window\.location\.pathname/);
  assert.match(script, /sidebar-menu-button/);
  assert.match(css, /color:#ef5350/);
  assert.match(css, /\.sidebar-link\.active/);
  assert.match(css, /\.sidebar-open \.sidebar/);
  assert.match(css, /overflow-y:auto/);
});

test('every registered proprietor route is directly renderable and remains server-authorized', async () => {
  const auth = createAuthService();
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  const token = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' }).token;
  const request = (path, authorization = token) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, headers: authorization ? { Authorization: `Bearer ${authorization}` } : {} }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    const routes = [...new Set(visibleSidebar({ permissions: new Set(['*']), roleKey: 'PROPRIETOR', portal: 'school' }).flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])])).filter((module) => module.moduleKey !== 'logout').map((module) => module.route))];
    for (const route of routes) assert.equal(await request(route), 200, `${route} should render`);
    assert.equal(await request('/finance', null), 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
