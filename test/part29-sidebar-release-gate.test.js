import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { SIDEBAR_MODULES } from '../src/sidebar-registry.js';
import { resolveRouteContract } from '../src/sidebar-route-contract.js';
import '../src/module-registry.js';

test('Part 29 preserves the release gate and certifies every role destination', async () => {
  const output = execFileSync(process.execPath, ['scripts/part28-release-gate.mjs'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.status, 'PASS');
  assert.equal(result.missingComponentTargetBlockers, 0);
  assert.equal(result.duplicateRouteBlockers, 0);
  const artifact = JSON.parse(await readFile('docs/role-sidebar-route-audit.json', 'utf8'));
  assert.equal(artifact.current.status, 'PASS');
  assert.equal(artifact.records.length, result.roleDestinationRecords);
});

test('critical Part 29 destinations reconnect to existing functional components', () => {
  const expected = new Map([
    ['student-search', '/student-canonical.html'],
    ['student-attendance', '/attendance.html'],
    ['attendance-reports', '/reports-academic.html'],
    ['staff-attendance', '/staff-attendance.html'],
    ['hr', '/staff-canonical.html'],
    ['leave', '/leave.html'],
    ['teachers', '/staff-canonical.html'],
    ['curriculum', '/academic-modules.html'],
    ['lesson-plans', '/academic-modules.html'],
    ['academic-assignments', '/academic-modules.html'],
    ['timetable', '/academic-modules.html'],
    ['exam-timetable', '/exam-timetable.html']
  ]);
  for (const [moduleKey, component] of expected) assert.equal(resolveRouteContract(SIDEBAR_MODULES.find((module) => module.moduleKey === moduleKey)).component, component, moduleKey);
});

test('every registered module has stable identity and exact view metadata', () => {
  const keys = new Set();
  for (const module of SIDEBAR_MODULES) {
    const contract = resolveRouteContract(module);
    assert.ok(contract.navigationKey);
    assert.ok(contract.exactView);
    assert.ok(contract.component.startsWith('/'));
    assert.equal(keys.has(contract.navigationKey), false, `duplicate navigation key: ${contract.navigationKey}`);
    keys.add(contract.navigationKey);
  }
});

test('the previous merge conflict markers are absent from browser navigation code', async () => {
  const app = await readFile('public/app.js', 'utf8');
  assert.doesNotMatch(app, /<<<<<<<|=======|>>>>>>>/);
  assert.match(app, /function navigateToRoute/);
  assert.match(app, /data-exact-view/);
});
