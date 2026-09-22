import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService, DEMO_USERS } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import '../src/module-registry.js';
import { SIDEBAR_MODULES, validateSidebarRegistry, visibleSidebar } from '../src/sidebar-registry.js';

const accountantLabels = ['User Guide', 'Class Database', 'Completed Class Database / Archives', 'Fees', 'Invoices & Receipts', 'Fee Structure', 'Admission Fee Structures', 'Fee Setup', 'Extra Classes', 'Canteen', 'Collection Reports', 'Student Fees', 'Payments', 'Receipts', 'Finance', 'Finance Reports', 'Income', 'Expenses', 'Cashbook', 'Budgets', 'Arrears', 'Discounts', 'Fee Statements', 'About the Developer', 'Copyright'];
const rolePermissions = {
  ACCOUNTANT_BURSAR: new Set(['students.read', 'fees.read', 'fees.write', 'fees.configure', 'fees.collect', 'finance.read']),
  HEADTEACHER: new Set(['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'marks.write', 'mock.scores.read', 'mock.results.read', 'subjects.read', 'subject_register.view', 'reports.read', 'fees.read', 'finance.read']),
  ASSISTANT_HEADTEACHER: new Set(['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'marks.write', 'mock.scores.read', 'mock.results.read', 'subjects.read', 'subject_register.view', 'reports.read', 'fees.read', 'finance.read']),
  TEACHER: new Set(['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'marks.write', 'results.read', 'mock.scores.read', 'mock.results.read', 'subject_register.view'])
};

function roleModules(roleKey) {
  return visibleSidebar({ modules: SIDEBAR_MODULES, permissions: rolePermissions[roleKey], roleKey, portal: 'school' }).flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])])).filter((module) => module.moduleKey !== 'logout');
}

function fixtureAuth() {
  const teacher = DEMO_USERS.find((user) => user.roleKey === 'TEACHER');
  const users = Object.entries(rolePermissions).map(([roleKey, permissions]) => ({ ...teacher, id: `route-${roleKey}`, username: `${roleKey.toLowerCase()}@route.test`, roleKey, permissions }));
  return createAuthService({ users });
}

function request(server, path, token) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, headers: { Authorization: `Bearer ${token}`, 'sec-fetch-mode': 'navigate' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
}

test('Part 10 sidebar registry has no duplicate keys/routes and every child has stable identity', () => {
  const errors = validateSidebarRegistry(SIDEBAR_MODULES);
  assert.equal(errors.some((error) => ['DUPLICATE_MODULE_KEY', 'MISSING_ROUTE', 'INVALID_ROUTE', 'INVALID_PARENT'].includes(error.type)), false, JSON.stringify(errors));
  const all = SIDEBAR_MODULES.filter((module) => module.moduleKey !== 'logout');
  assert.equal(new Set(all.map((module) => module.moduleKey)).size, all.length);
  for (const module of all) assert.ok(module.moduleKey && module.route.startsWith('/'));
  const duplicateLabels = all.filter((module, index, list) => list.findIndex((candidate) => candidate.moduleName === module.moduleName) !== index);
  assert.ok(duplicateLabels.some((module) => module.moduleName === 'Receipts'));
  assert.equal(new Set(duplicateLabels.filter((module) => module.moduleName === 'Receipts').map((module) => module.moduleKey)).size, 1);
});

test('Accountant sidebar contains every required configured destination', () => {
  const labels = new Set(roleModules('ACCOUNTANT_BURSAR').map((module) => module.moduleName));
  for (const label of accountantLabels) assert.ok(labels.has(label), `missing Accountant child: ${label}`);
  const receipts = roleModules('ACCOUNTANT_BURSAR').filter((module) => module.moduleName === 'Receipts');
  assert.equal(receipts.length, 2);
  assert.deepEqual(new Set(receipts.map((module) => module.moduleKey)), new Set(['receipts', 'finance-receipts']));
});

test('every authorized Headteacher, Assistant Headteacher, and Teacher child is renderable and permission-scoped', async () => {
  const auth = fixtureAuth();
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    for (const roleKey of Object.keys(rolePermissions)) {
      const login = auth.login({ username: `${roleKey.toLowerCase()}@route.test`, password: 'Teacher123!', portal: 'school', role: roleKey });
      assert.equal(login.ok, true, roleKey);
      const modules = roleModules(roleKey);
      assert.ok(modules.length > 4, `${roleKey} must have an auditable sidebar`);
      for (const module of modules) assert.equal(await request(server, module.route, login.token), 200, `${roleKey}: ${module.moduleKey} ${module.route}`);
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('navigation error identity is stable and never derived from stale visible text', async () => {
  const app = await import('node:fs/promises');
  const source = await app.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /data-navigation-key/);
  assert.match(source, /navigationKey/);
  assert.match(source, /dataset\.moduleLabel/);
  assert.doesNotMatch(source, /link\.title \|\| link\.textContent\.trim\(\)/);
});
