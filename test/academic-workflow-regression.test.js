import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { PROPRIETOR_PAGE_ALIASES } from '../src/proprietor-sidebar-routes.js';

test('academic sidebar routes keep Promotion and Attendance Alerts isolated from result and register views', async () => {
  assert.equal(PROPRIETOR_PAGE_ALIASES['/promotion'], '/promotion.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/alerts'], '/attendance-alerts.html');
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/promotion'], PROPRIETOR_PAGE_ALIASES['/results']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/attendance/alerts'], PROPRIETOR_PAGE_ALIASES['/attendance']);
  assert.match(await readFile(new URL('../public/promotion.html', import.meta.url), 'utf8'), /Promotion decision/);
  assert.match(await readFile(new URL('../public/attendance-alerts.html', import.meta.url), 'utf8'), /Attendance Alerts/);
});

test('sample students use reserved IDs, populate every class, and stay out of normal lists', () => {
  const students = createStudentService();
  const samples = students.seedSampleStudents();
  assert.equal(samples.length, CORE_LEVELS.length * 2);
  assert.ok(samples.every((student) => student.isTestRecord && student.permanentStudentId.startsWith('TEST-OSAAH-')));
  assert.equal(students.listStudents().length, 0);
  assert.equal(students.listStudents({ includeTestRecords: true }).length, CORE_LEVELS.length * 2);
  for (const classId of CORE_LEVELS) assert.equal(samples.filter((student) => student.classId === classId).length, 2);
  assert.throws(() => students.createStudent({ firstName: 'Unsafe', surname: 'Record', permanentStudentId: 'TEST-OSAAH-X-001' }), /(reserved|malformed)/);
});

test('attendance page exposes all canonical classes through one selector', async () => {
  const html = await readFile(new URL('../public/attendance.html', import.meta.url), 'utf8');
  assert.equal((html.match(/<select id="attendance-class"/g) ?? []).length, 1);
  for (const classId of CORE_LEVELS) assert.match(html, new RegExp(`value="${classId}"`));
});
