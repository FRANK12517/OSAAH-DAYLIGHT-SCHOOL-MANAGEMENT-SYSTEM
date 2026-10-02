import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PROPRIETOR_PAGE_ALIASES } from '../src/proprietor-sidebar-routes.js';
import { resolveRouteContract } from '../src/sidebar-route-contract.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

test('attendance navigation uses distinct overview and daily register components', async () => {
  const overview = SIDEBAR_MODULES.find((module) => module.moduleKey === 'attendance-dashboard');
  const daily = SIDEBAR_MODULES.find((module) => module.moduleKey === 'student-attendance');
  assert.equal(overview.moduleName, 'Attendance Overview');
  assert.equal(daily.moduleName, "Today's Attendance");
  assert.equal(resolveRouteContract(overview).component, '/attendance-overview.html');
  assert.equal(resolveRouteContract(daily).component, '/attendance.html');
  assert.notEqual(resolveRouteContract(overview).component, resolveRouteContract(daily).component);
  await readFile(new URL('../public/attendance-overview.html', import.meta.url), 'utf8');
  await readFile(new URL('../public/attendance.html', import.meta.url), 'utf8');
});

test('authorized school roles see both attendance destinations without exposing staff records', () => {
  for (const roleKey of ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['*']), roleKey, portal: 'school' })
      .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
    const attendance = modules.filter((module) => ['attendance-dashboard', 'student-attendance'].includes(module.moduleKey));
    assert.deepEqual(attendance.map((module) => module.moduleName), ['Attendance Overview', "Today's Attendance"], roleKey);
    assert.deepEqual(attendance.map((module) => module.route), ['/attendance', '/attendance/students'], roleKey);
    assert.equal(modules.some((module) => module.moduleKey === 'staff-attendance-hr'), roleKey !== 'TEACHER');
  }
});

test('direct page aliases preserve the daily register and historical overview routes', () => {
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance'], '/attendance-overview.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/students'], '/attendance.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/reports'], '/reports-academic.html');
});
