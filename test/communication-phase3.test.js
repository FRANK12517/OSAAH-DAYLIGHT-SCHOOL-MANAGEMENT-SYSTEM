import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService } from '../src/students.js';
import { createCommunicationService } from '../src/communication.js';
import { createCommunicationEngine } from '../src/communication-engine.js';

test('attendance notification identity is per child, date, status and remains idempotent', async () => {
  const students = createStudentService({ now: () => '2026-09-12T00:00:00.000Z' });
  const first = students.createStudent({ firstName: 'Ama', surname: 'Mensah', admissionDate: '2026-09-12', classId: 'Primary 4' });
  const second = students.createStudent({ firstName: 'Kojo', surname: 'Mensah', admissionDate: '2026-09-12', classId: 'JHS 1' });
  students.linkParent(first.id, { parentId: 'parent-1', telephone: '0241234567' }); students.linkParent(second.id, { parentId: 'parent-1', telephone: '+233241234567' });
  const communication = createCommunicationService(); const engine = createCommunicationEngine({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  for (const student of [first, second]) for (const link of students.parentLinksFor(student.id)) { const key = `school-osaah-daylight+${link.permanentStudentId}+2026-09-12+ABSENT+ATTENDANCE`; const queued = engine.enqueue({ recipient: link.telephone, payload: { body: `Dear Parent, your child, ${link.studentName} with Permanent Student ID ${link.permanentStudentId} is absent today.` }, idempotencyKey: key }, { id: 'system', schoolId: 'school-osaah-daylight' }); engine.enqueue({ recipient: link.telephone, payload: {}, idempotencyKey: key }, { id: 'system', schoolId: 'school-osaah-daylight' }); communication.notify({ type: 'ATTENDANCE', recipientId: link.parentId, studentId: link.studentId, permanentStudentId: link.permanentStudentId, studentName: link.studentName, title: 'Attendance: Absent', body: 'Absent today.' }); assert.ok(queued.id); }
  assert.equal(engine.listOutbox({ roleKey: 'DEVELOPER' }).length, 2); assert.equal(communication.listNotifications({ id: 'parent-1', portal: 'parent', children: [{ id: first.id }, { id: second.id }] }).length, 2); assert.equal((await engine.process(engine.listOutbox({ roleKey: 'DEVELOPER' })[0].id)).status, 'FAILED');
});
