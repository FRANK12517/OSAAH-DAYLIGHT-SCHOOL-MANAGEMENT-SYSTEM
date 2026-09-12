import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { PROPRIETOR_SIDEBAR_CATEGORIES, SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';

test('authoritative proprietor mapping covers every requested item with unique routes', () => {
  assert.equal(PROPRIETOR_SIDEBAR_ROUTES.length, 160);
  assert.equal(new Set(PROPRIETOR_SIDEBAR_ROUTES.map((item) => item.moduleKey)).size, PROPRIETOR_SIDEBAR_ROUTES.length);
  assert.equal(new Set(PROPRIETOR_SIDEBAR_ROUTES.map((item) => item.route)).size, PROPRIETOR_SIDEBAR_ROUTES.length);
  for (const item of PROPRIETOR_SIDEBAR_ROUTES) {
    assert.match(item.route, /^\//, `${item.moduleName} must have an application route`);
    assert.match(item.page, /^\/.+\.html$/, `${item.moduleName} must reuse an existing page`);
  }
});

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
  assert.match(script, /history\.pushState/);
  assert.match(script, /window\.onpopstate/);
  assert.match(script, /module-frame/);
  assert.match(script, /OSAAH module render failure/);
  assert.match(css, /color:#ef5350/);
  assert.match(css, /\.sidebar-link\.active/);
  assert.match(css, /\.sidebar-open \.sidebar/);
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /\.module-frame/);
});

test('proprietor shell has one mount point and one replaceable child host', async () => {
  const [script, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);
  assert.equal((script.match(/class="app-shell"/g) ?? []).length, 1);
  assert.equal((script.match(/id="primary-sidebar"/g) ?? []).length, 1);
  assert.equal((script.match(/id="module-frame"/g) ?? []).length, 1);
  assert.match(script, /if \(dashboardBuildPromise\) return dashboardBuildPromise/);
  assert.match(script, /dashboard\.querySelector\('\.app-shell'\)\) return/);
  assert.match(script, /frame\.removeAttribute\('src'\)/);
  assert.match(script, /overview\.hidden = true; host\.hidden = false/);
  assert.match(script, /if \(route === '\/'\) \{ overview\.hidden = false; host\.hidden = true/);
  assert.equal((script.match(/id="dashboard-overview"/g) ?? []).length, 1);
  assert.match(script, /navigationVersion/);
  assert.match(script, /navigateToRoute\(dashboard/);
  assert.doesNotMatch(script, /createPortal|<Outlet|activeModule|selectedModule/);
  assert.match(css, /\.app-shell\{--sidebar-width:250px;min-height:100vh\}/);
  assert.match(css, /\.sidebar\{width:var\(--sidebar-width\);flex:0 0 var\(--sidebar-width\)\}/);
  assert.match(css, /\.workspace\{margin-left:var\(--sidebar-width\);width:calc\(100% - var\(--sidebar-width\)\);max-width:calc\(100% - var\(--sidebar-width\)\);min-width:0\}/);
  assert.match(css, /@media\(max-width:759px\)\{\.workspace\{margin-left:0;width:100%;max-width:100%\}\}/);
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

test('every requested proprietor component opens its mapped implementation', async () => {
  const auth = createAuthService();
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  const token = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school' }).token;
  const request = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, headers: { Authorization: `Bearer ${token}` } }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    for (const item of PROPRIETOR_SIDEBAR_ROUTES) {
      const response = await request(item.route);
      assert.equal(response.status, 200, `${item.moduleName} (${item.route}) should render`);
      assert.match(response.body, /<!doctype html>/i, `${item.moduleName} should render a page, not a redirect or blank response`);
      const titleLabel = item.moduleName.replace(/&/g, '&amp;');
      assert.ok(response.body.includes(`<title>${titleLabel} | OsaaH Daylight</title>`), `${item.moduleName} should identify itself in the page title`);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
