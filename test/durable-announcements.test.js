import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAnnouncementsService } from '../src/durable-announcements.js';

function databaseFixture() {
  const executed = [];
  const database = {
    executed,
    async query(sql, params) {
      if (sql.includes('SELECT DISTINCT u.id AS userId')) return [{ userId: 'teacher-1', recipientType: 'TEACHER' }];
      if (sql.includes('FROM users u') && sql.includes("r.role_key='TEACHER'")) return [{ id: 'teacher-1', name: 'Teacher One' }, { id: 'teacher-2', name: 'Teacher Two' }];
      if (sql.includes('FROM users u') && sql.includes("r.role_key NOT IN ('PARENT','TEACHER','PROPRIETOR'")) return [{ id: 'staff-1', name: 'Staff One', roleKey: 'HR_OFFICER' }];
      if (sql.includes('FROM users u') && sql.includes("r.role_key='PARENT'")) return [{ id: 'parent-1', name: 'Parent One' }, { id: 'parent-2', name: 'Parent Two' }];
      if (sql.includes('SELECT DISTINCT u.id AS userId')) return [{ userId: 'teacher-1', recipientType: 'TEACHER' }];
      if (sql.includes('SELECT id FROM announcement_recipients')) return params?.[2] === 'teacher-1' ? [{ id: 'recipient-row' }] : [];
      if (sql.includes('SELECT a.id')) return [{ id: 'ann-1', schoolId: 'school-1', title: 'Hello', message: 'World', priority: 'HIGH', recipientCategory: 'INDIVIDUAL_TEACHER', status: 'PUBLISHED', publishedAt: '2026-10-08T10:00:00.000Z', createdAt: '2026-10-08T10:00:00.000Z', senderId: 'admin-1', senderName: 'Admin', senderRole: 'SCHOOL_ADMIN', readAt: null }];
      return [];
    },
    async execute(sql, params) { executed.push({ sql, params }); },
    async transaction(work) { return work(this); }
  };
  return database;
}

const actor = { id: 'admin-1', schoolId: 'school-1', roleKey: 'SCHOOL_ADMIN', permissions: new Set(['announcements.create']) };

test('announcement creation is denied to teachers and parents', async () => {
  const service = createDurableAnnouncementsService({ database: databaseFixture(), schoolId: 'school-1' });
  await assert.rejects(() => service.create({ title: 'x', message: 'y', recipientCategory: 'ALL_PARENTS' }, { id: 'teacher', schoolId: 'school-1', roleKey: 'TEACHER', permissions: new Set(['communication.write']) }), /announcements.create/);
  await assert.rejects(() => service.create({ title: 'x', message: 'y', recipientCategory: 'ALL_PARENTS' }, { id: 'parent', schoolId: 'school-1', roleKey: 'PARENT', permissions: new Set() }), /announcements.create/);
});

test('durable creation assigns only selected recipients and supports drafts', async () => {
  const database = databaseFixture(); const service = createDurableAnnouncementsService({ database, schoolId: 'school-1', clock: () => '2026-10-08T10:00:00.000Z' });
  const published = await service.create({ title: 'Staff update', message: 'Read this', recipientCategory: 'INDIVIDUAL_TEACHER', recipientIds: ['teacher-1'], priority: 'HIGH' }, actor);
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(database.executed.filter((item) => item.sql.includes('INSERT INTO announcement_recipients')).length, 1);
  const draft = await service.create({ title: 'Draft', message: 'Later', recipientCategory: 'ALL_PARENTS', status: 'DRAFT' }, actor);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(database.executed.filter((item) => item.sql.includes('INSERT INTO announcement_recipients')).length, 1);
});

test('scheduled publication dates must be future and reads are recipient-scoped', async () => {
  const service = createDurableAnnouncementsService({ database: databaseFixture(), schoolId: 'school-1', clock: () => '2026-10-08T10:00:00.000Z' });
  await assert.rejects(() => service.create({ title: 'Bad', message: 'Date', recipientCategory: 'ALL_PARENTS', scheduledFor: '2026-10-08T09:00:00.000Z' }, actor), /future/);
  const read = await service.markRead('ann-1', { id: 'teacher-1', schoolId: 'school-1', roleKey: 'TEACHER' });
  assert.equal(read.ok, true);
  await assert.rejects(() => service.markRead('ann-1', { id: 'other', schoolId: 'school-1', roleKey: 'TEACHER' }), /not found/);
});
