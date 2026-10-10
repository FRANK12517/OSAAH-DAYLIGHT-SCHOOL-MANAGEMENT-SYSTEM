import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFile(resolve(root, path), 'utf8');

test('Staff Attendance schema retains canonical school/staff identity and uniqueness', async () => {
  const [foundation, base, scope, leave, audit] = await Promise.all([
    read('schema/001_foundation.sql'),
    read('schema/006_attendance.sql'),
    read('schema/034_attendance_academic_scope.sql'),
    read('schema/035_staff_leave_attendance_reconciliation.sql'),
    read('schema/036_attendance_provenance_audit.sql')
  ]);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS staff\s*\([\s\S]*?id TEXT PRIMARY KEY[\s\S]*?school_id TEXT NOT NULL REFERENCES schools\(id\)/i);
  assert.match(base, /CREATE TABLE IF NOT EXISTS staff_attendance\s*\([\s\S]*?school_id TEXT NOT NULL REFERENCES schools\(id\)[\s\S]*?staff_id TEXT NOT NULL REFERENCES staff\(id\)[\s\S]*?attendance_date TEXT NOT NULL[\s\S]*?entered_by TEXT NOT NULL REFERENCES users\(id\)/i);
  assert.match(scope, /ADD COLUMN IF NOT EXISTS academic_year[\s\S]*?ALTER TABLE staff_attendance ADD COLUMN IF NOT EXISTS term/i);
  assert.match(scope, /CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_scope_identity ON staff_attendance\(school_id, academic_year, term, attendance_date, staff_id, attendance_type\)/i);
  assert.match(leave, /ADD COLUMN IF NOT EXISTS attendance_status/i);
  assert.match(leave, /ADD COLUMN IF NOT EXISTS attendance_source/i);
  assert.match(leave, /ADD COLUMN IF NOT EXISTS leave_request_id/i);
  assert.match(leave, /ADD COLUMN IF NOT EXISTS note/i);
  assert.match(leave, /CREATE TABLE IF NOT EXISTS staff_attendance_reconciliation_audit/i);
  assert.match(audit, /ADD COLUMN IF NOT EXISTS recorded_by/i);
  assert.match(audit, /UPDATE staff_attendance SET recorded_by = entered_by WHERE recorded_by IS NULL/i);
  assert.match(audit, /CREATE TABLE IF NOT EXISTS attendance_audit_history/i);
  assert.match(audit, /person_type VARCHAR\(16\) NOT NULL/i);
});

test('checked-in schema history contains no destructive operation targeting staff_attendance', async () => {
  const files = (await readdir(resolve(root, 'schema'))).filter((name) => name.endsWith('.sql'));
  const destructive = /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\s+(?:IF\s+EXISTS\s+)?[`"]?staff_attendance\b|\bALTER\s+TABLE\s+[`"]?staff_attendance\b[^;]*\bDROP\s+(?:COLUMN|INDEX|KEY)\b/i;
  for (const name of files) {
    const sql = (await readFile(resolve(root, 'schema', name), 'utf8')).replace(/--[^\n]*/g, '');
    assert.doesNotMatch(sql, destructive, `${name} must not destructively remove staff attendance data or keys`);
  }
});

test('Staff Attendance API and navigation continue to use the existing server permission model', async () => {
  const [server, modules, aliases, auth] = await Promise.all([
    read('src/server.mjs'), read('src/module-registry.js'), read('src/proprietor-sidebar-routes.js'), read('src/auth.js')
  ]);
  assert.match(server, /pathname === '\/api\/attendance\/staff' && request\.method === 'POST'[\s\S]*?canAccess\(user, 'staff\.attendance\.write'\)/);
  assert.match(server, /pathname === '\/api\/attendance\/staff' \|\| pathname === '\/api\/attendance\/staff\/report'[\s\S]*?canAccess\(user, 'staff\.attendance\.read'\)/);
  assert.match(server, /pathname === '\/api\/attendance\/staff\/overview'[\s\S]*?canAccess\(user, 'staff\.attendance\.read'\)/);
  assert.match(server, /reportType === 'STAFF' \? canAccess\(user, 'attendance\.read'\) && canAccess\(user, 'staff\.attendance\.read'\) : canAccess\(user, 'attendance\.read'\)/);
  assert.match(modules, /moduleKey: 'staff-attendance',[\s\S]*?requiredPermission: 'staff\.attendance\.read'/);
  assert.match(modules, /moduleKey: 'staff-attendance-hr',[\s\S]*?requiredPermission: 'staff\.attendance\.read'/);
  assert.match(aliases, /\['staff-attendance', 'Staff Attendance', '\/attendance\/staff'\]/);
  assert.match(aliases, /\['staff-attendance-hr', 'Staff Attendance', '\/staff\/attendance'\]/);
  assert.match(auth, /'staff\.attendance\.read', 'staff\.attendance\.write'/);
});

test('protected CI includes the dedicated suite and migration inventory validation', async () => {
  const [workflow, packageJson] = await Promise.all([read('.github/workflows/protected-components.yml'), read('package.json')]);
  const pkg = JSON.parse(packageJson);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /npm run test:staff-attendance/);
  assert.match(workflow, /npm run migration:validate/);
  assert.match(pkg.scripts['test:staff-attendance'], /test\/staff-attendance-\*\.test\.js/);
  assert.match(pkg.scripts['test:staff-attendance'], /test\/staff-leave-reconciliation-part3\.test\.js/);
});

test('Staff Attendance mobile layout keeps wide registers inside scrollable containers and labels controls', async () => {
  const [html, styles] = await Promise.all([read('public/staff-attendance.html'), read('public/styles.css')]);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.ok((html.match(/class="responsive-table"/g) ?? []).length >= 2);
  assert.match(html, /@media\(max-width:600px\)/);
  assert.match(html, /<label for="attendance-academic-year">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(styles, /\.responsive-table\{width:100%;overflow-x:auto\}/);
  assert.match(html, /async function saveAttendance\(\)/);
});
