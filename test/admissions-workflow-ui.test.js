import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../src/module-registry.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

test('staff admissions page presents three distinct registration categories', async () => {
  const html = await readFile(new URL('../public/admissions.html', import.meta.url), 'utf8');
  for (const category of ['EXISTING_STUDENT', 'TRANSFER', 'FIRST_TIME']) assert.ok(html.includes(`value="${category}"`));
  assert.match(html, /Already-enrolled student.*migrate into system/i);
  assert.match(html, /Transfer student.*register transfer/i);
  assert.match(html, /First-time student.*new admission/i);
  assert.match(html, /aria-live="polite"/);
});

test('staff migration UI uses the guarded preview and explicit idempotent execution contract', async () => {
  const [script, registry, server] = await Promise.all([
    readFile(new URL('../public/admissions-workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/module-registry.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(script, /\/api\/staff-admissions\/migration-preview/);
  assert.match(script, /\/api\/staff-admissions\/migration/);
  assert.match(script, /execute: true/);
  assert.match(script, /previewFingerprint: migrationPreview\.fingerprint/);
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /item\.permanentStudentId/);
  assert.match(script, /api\('\/api\/sidebar'\)/);
  assert.match(script, /\['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'\]/);
  assert.match(registry, /moduleKey: 'admissions'.*roles: \[[^\]]*'HEADTEACHER', 'ASSISTANT_HEADTEACHER'/);
  assert.match(server, /pathname === '\/api\/staff-admissions\/migration'[^\n]*canAccess\(user, 'admissions\.accept'\)/);
});

test('proprietor and both school leadership dashboards can discover Admissions', () => {
  for (const roleKey of ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']) {
    const groups = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['admissions.read']), roleKey, portal: 'school' });
    assert.ok(groups.some((group) => group.modules.some((module) => module.route === '/admissions')), `${roleKey} should see Admissions`);
  }
});

test('transfer and first-time UI cannot use existing-student migration shortcut', async () => {
  const script = await readFile(new URL('../public/admissions-workflow.js', import.meta.url), 'utf8');
  const otherCategory = script.slice(script.indexOf('function renderOtherCategory'), script.indexOf("categoryForm.addEventListener"));
  assert.match(otherCategory, /cannot use the existing-student migration shortcut/);
  assert.match(otherCategory, /school’s approved admission process/);
  assert.doesNotMatch(otherCategory, /api\/staff-admissions\/migration/);
});
