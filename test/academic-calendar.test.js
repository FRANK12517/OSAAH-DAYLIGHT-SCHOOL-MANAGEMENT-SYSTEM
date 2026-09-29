import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAcademicCalendarService } from '../src/academic-calendar.js';
import { resolveRouteContract } from '../src/sidebar-route-contract.js';

const admin = { id: 'admin-1', schoolId: 'school-osaah-daylight', roleKey: 'SCHOOL_ADMIN' };
const teacher = { id: 'teacher-1', schoolId: 'school-osaah-daylight', roleKey: 'TEACHER' };
const base = { title: 'First Term Reopening', category: 'Reopening', academicYear: '2026/2027', term: '1st Term', startDate: '2026-09-01', endDate: '2026-09-01', audience: ['All School'], allDay: true };

test('Academic Calendar resolves to its independent page and API', async () => {
  const contract = resolveRouteContract({ moduleKey: 'academic-calendar', route: '/academic-calendar' });
  assert.equal(contract.component, '/academic-calendar.html');
  assert.deepEqual(contract.apiDependencies, ['/api/academic-calendar', '/api/academic-calendar/options']);
  const html = await readFile(new URL('../public/academic-calendar.html', import.meta.url), 'utf8');
  assert.match(html, /Plan, manage and publish academic terms/);
  assert.doesNotMatch(html, /Calendar entries are managed through the existing Communication module/);
});

test('calendar service validates CRUD, filtering, publication and cancellation', async () => {
  const service = createAcademicCalendarService({ now: () => '2026-08-01T10:00:00.000Z' });
  const created = await service.create(base, admin);
  assert.equal(created.status, 'DRAFT');
  assert.equal((await service.list({ academicYear: '2026/2027', term: '1st Term' }, admin)).length, 1);
  await assert.rejects(() => service.create({ ...base, endDate: '2026-08-31', category: 'Other' }, admin), /Specify Event Category/);
  await assert.rejects(() => service.create({ ...base, startTime: '14:00', endTime: '13:00' }, admin), /End Time/);
  const updated = await service.update(created.id, { ...base, title: 'Published Reopening', status: 'PUBLISHED' }, admin);
  assert.equal(updated.status, 'PUBLISHED');
  assert.equal(updated.publishedBy, admin.id);
  assert.equal((await service.list({}, teacher)).length, 1);
  const cancelled = await service.cancel(created.id, admin);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(await service.remove(created.id, admin), { ok: true, id: created.id });
});

test('draft events are hidden from non-management users and cross-school actors are denied', async () => {
  const service = createAcademicCalendarService();
  const created = await service.create(base, admin);
  assert.equal((await service.list({}, teacher)).length, 0);
  await assert.rejects(() => service.list({}, { ...admin, schoolId: 'other-school' }), /Forbidden/);
  await assert.rejects(() => service.create(base, teacher), /not permitted/);
  assert.equal((await service.get(created.id, teacher)), null);
});

test('calendar schema is additive and non-destructive', async () => {
  const sql = await readFile(new URL('../schema/058_academic_calendar.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS academic_calendar_events/);
  assert.match(sql, /school_id TEXT NOT NULL REFERENCES schools\(id\)/);
  assert.match(sql, /published_at/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
});
