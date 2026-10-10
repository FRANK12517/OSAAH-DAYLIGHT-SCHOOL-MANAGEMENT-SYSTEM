import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

test('Administrator can see the authoritative Score Entry module with marks.write', () => {
  const permissions = new Set(['examinations.read', 'marks.write']);
  const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions, roleKey: 'SCHOOL_ADMIN', portal: 'school' })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
  const scoreEntry = modules.find((module) => module.moduleKey === 'examinations');
  assert.ok(scoreEntry, 'Score Entry must be visible to School Administrator');
  assert.equal(scoreEntry.route, '/examinations');
  assert.equal(scoreEntry.requiredPermission, 'examinations.read');
  assert.ok(scoreEntry.allowedRoles.includes('SCHOOL_ADMIN'));
});

test('Administrator marks.write is delivered by a forward migration without editing migration 032', async () => {
  const historical = (await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const forward = await readFile(new URL('../schema/070_school_admin_score_entry_permission.sql', import.meta.url), 'utf8');
  const administratorBlock = historical.match(/FROM roles r JOIN permissions p ON p\.permission_key IN \([^;]+\)\nWHERE r\.role_key = 'SCHOOL_ADMIN';/s)?.[0] ?? '';
  assert.notEqual(administratorBlock, '');
  assert.doesNotMatch(administratorBlock, /marks\.write/);
  assert.match(forward, /INSERT IGNORE INTO permissions/);
  assert.match(forward, /marks\.write/);
  assert.match(forward, /WHERE r\.role_key = 'SCHOOL_ADMIN'/);
});
