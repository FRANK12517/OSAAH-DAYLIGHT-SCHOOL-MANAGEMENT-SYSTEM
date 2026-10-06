import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

test('School Administrator can open Results & Reports without broadening Teacher scope', () => {
  const adminModules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['results.read']), roleKey: 'SCHOOL_ADMIN', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  const teacherModules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['results.read']), roleKey: 'TEACHER', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  assert.equal(adminModules.find((module) => module.moduleKey === 'results')?.route, '/results');
  assert.equal(teacherModules.find((module) => module.moduleKey === 'results')?.route, '/results');
  const resultModule = SIDEBAR_MODULES.find((module) => module.moduleKey === 'results');
  assert.deepEqual(resultModule.roles, ['SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']);
  assert.equal(resultModule.requiredPermission, 'results.read');
});

test('Results & Reports permissions are delivered by additive migration 071', async () => {
  const historical = await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8');
  const forward = await readFile(new URL('../schema/071_school_admin_results_reports_permission.sql', import.meta.url), 'utf8');
  const administratorBlock = historical.match(/FROM roles r JOIN permissions p ON p\.permission_key IN \([^;]+\)\nWHERE r\.role_key = 'SCHOOL_ADMIN';/s)?.[0] ?? '';
  assert.notEqual(administratorBlock, '');
  assert.doesNotMatch(administratorBlock, /results\.(read|generate|print)/);
  for (const permission of ['results.read', 'results.generate', 'results.print']) assert.match(forward, new RegExp(permission.replace('.', '\\.')));
  assert.match(forward, /INSERT IGNORE INTO role_permissions/);
  assert.match(forward, /WHERE r\.role_key = 'SCHOOL_ADMIN'/);
  assert.doesNotMatch(forward, /\b(DROP|TRUNCATE|DELETE|RENAME)\b/i);
});
