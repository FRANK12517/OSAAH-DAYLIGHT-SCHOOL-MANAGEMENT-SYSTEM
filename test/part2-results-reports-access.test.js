import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

test('School Administrator can open Results & Reports without broadening Teacher scope', async () => {
  const adminModules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['results.read']), roleKey: 'SCHOOL_ADMIN', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  const teacherModules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['results.read']), roleKey: 'TEACHER', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  assert.equal(adminModules.find((module) => module.moduleKey === 'results')?.route, '/results');
  assert.equal(teacherModules.find((module) => module.moduleKey === 'results')?.route, '/results');
  const resultModule = SIDEBAR_MODULES.find((module) => module.moduleKey === 'results');
  assert.deepEqual(resultModule.roles, ['SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']);
  assert.equal(resultModule.requiredPermission, 'results.read');
  const source = await readFile(new URL('../src/module-registry.js', import.meta.url), 'utf8');
  assert.match(source, /registerNavigationGroup\('EXAMINATIONS & RESULTS',[\s\S]*?'ASSISTANT_HEADTEACHER'/);
  for (const roleKey of ['ASSISTANT_HEADTEACHER', 'TEACHER', 'SCHOOL_ADMIN', 'HEADTEACHER']) {
    const permissions = new Set(['examinations.read', 'results.read', 'marks.write', 'mock.scores.write', 'mock.results.read']);
    const visible = visibleSidebar({ modules: SIDEBAR_MODULES, permissions, roleKey, portal: 'school' }).flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
    for (const key of ['examinations', 'results', 'report-cards', 'broadsheets']) assert.equal(visible.filter((module) => module.moduleKey === key).length, 1, `${roleKey}:${key}`);
    for (const key of ['mock-score-entry', 'mock-results']) assert.equal(visible.filter((module) => module.moduleKey === key).length, roleKey === 'SCHOOL_ADMIN' || roleKey === 'ASSISTANT_HEADTEACHER' || roleKey === 'TEACHER' || roleKey === 'HEADTEACHER' ? 1 : 0, `${roleKey}:${key}`);
  }
  for (const key of ['examinations', 'results', 'report-cards', 'broadsheets']) assert.equal(PROPRIETOR_SIDEBAR_ROUTES.filter((module) => module.moduleKey === key).length, 1, `PROPRIETOR:${key}`);
});

test('shared Academic Module serves the authorized Broadsheet with canonical single-select classes and context race protection', async () => {
  const html = await readFile(new URL('../public/academic-modules.html', import.meta.url), 'utf8');
  assert.match(html, /Broadsheet/);
  assert.match(html, /canonicalClassOptions/);
  assert.match(html, /const catalogue=\[\['Nursery 1'/);
  assert.match(html, /return match\?\{\.\.\.match,label\}:\{id:canonical,name:canonical,label\}/);
  assert.match(html, /api\/academic\/broadsheet/);
  assert.match(html, /state\.subjectRequest/);
  assert.match(html, /state\.broadsheetRequest/);
  assert.match(html, /broadsheet-retry/);
  assert.doesNotMatch(html, /multiple[^\n]*id="subject"/);
});

test('Results & Reports permissions are delivered by additive migration 071', async () => {
  const historical = await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8');
  const forward = await readFile(new URL('../schema/071_school_admin_results_reports_permission.sql', import.meta.url), 'utf8');
  const administratorBlock = historical.match(/INSERT IGNORE INTO role_permissions[^;]+WHERE r\.role_key = 'SCHOOL_ADMIN';/s)?.[0] ?? '';
  assert.notEqual(administratorBlock, '');
  assert.doesNotMatch(administratorBlock, /results\.(read|generate|print)/);
  for (const permission of ['results.read', 'results.generate', 'results.print']) assert.match(forward, new RegExp(permission.replace('.', '\\.')));
  assert.match(forward, /INSERT IGNORE INTO role_permissions/);
  assert.match(forward, /WHERE r\.role_key = 'SCHOOL_ADMIN'/);
  assert.doesNotMatch(forward, /\b(DROP|TRUNCATE|DELETE|RENAME)\b/i);
});
