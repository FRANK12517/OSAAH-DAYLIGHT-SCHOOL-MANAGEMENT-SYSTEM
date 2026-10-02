import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableResultBlockingService } from '../src/durable-result-blocking.js';

function database() {
  const blocks = [], requests = [];
  return {
    blocks, requests,
    async query(sql, params = []) {
      if (sql.includes('FROM academic_result_blocks')) return blocks.filter((r) => r.school_id === params[0] && r.academic_year === params[1] && r.term === params[2] && r.class_id === params[3] && (sql.includes('student_id=?') ? r.student_id === params[4] : true) && (!sql.includes("student_id='*'") || r.student_id === '*' || r.student_id === null) && (!sql.includes('status=?') || r.status === params[2])).slice(0, 1);
      if (sql.includes('FROM academic_result_unblock_requests')) return requests.filter((r) => r.school_id === params[0] && (!params[1] || r.id === params[1]) && (!params[2] || r.status === params[2]));
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('INSERT INTO academic_result_blocks')) {
        const [id, school_id, academic_year, term, class_id, student_id, scope, status, reason, blocked_by, blocked_by_role, blocked_at] = params;
        const existing = blocks.find((r) => r.school_id === school_id && r.academic_year === academic_year && r.term === term && r.class_id === class_id && r.student_id === student_id);
        if (existing) Object.assign(existing, { status, reason, blocked_by, blocked_by_role, blocked_at, unblocked_by: null, unblocked_at: null });
        else blocks.push({ id, school_id, academic_year, term, class_id, student_id, scope, status, reason, blocked_by, blocked_by_role, blocked_at });
      } else if (sql.startsWith('INSERT INTO academic_result_unblock_requests')) {
        const [id, school_id, block_id, academic_year, term, class_id, student_id, scope, reason, requested_by, requested_by_role, status, requested_at] = params;
        requests.push({ id, school_id, block_id, academic_year, term, class_id, student_id, scope, reason, requested_by, requested_by_role, status, requested_at });
      } else if (sql.startsWith('UPDATE academic_result_unblock_requests')) {
        const row = requests.find((r) => r.school_id === params[3] && r.id === params[4]); Object.assign(row, { status: params[0], decided_by: params[1], decided_at: params[2] });
      } else if (sql.startsWith('UPDATE academic_result_blocks')) {
        const row = blocks.find((r) => r.school_id === params[3] && r.id === params[4]); Object.assign(row, { status: params[0], unblocked_by: params[1], unblocked_at: params[2] });
      }
      return { affectedRows: 1 };
    }
  };
}

const teacher = { id: 'teacher-1', roleKey: 'TEACHER', schoolId: 'school-1', assignedClassIds: ['Primary 1'] };
const accountant = { id: 'accountant-1', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-1' };
const head = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-1' };

test('durable result blocks are student/class scoped and deny reads until approved', async () => {
  const db = database(); const audit = []; const service = createDurableResultBlockingService({ database: db, schoolId: 'school-1', audit: (event) => audit.push(event), now: () => '2026-10-01T00:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const studentBlock = await service.blockResults({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', studentId: 'student-1', reason: 'Review' }, teacher);
  assert.equal(studentBlock.scope, 'STUDENT');
  await assert.rejects(() => service.assertReadable({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', studentId: 'student-1' }, { schoolId: 'school-1' }), (error) => error.code === 'PARENT_RESULT_BLOCKED' && error.status === 403);
  assert.equal(await service.blockFor({ academicYear: '2026/2027', term: 'Second Term', classId: 'Primary 1', studentId: 'student-1' }), null);
  const request = await service.requestUnblock({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', studentId: 'student-1', reason: 'Review complete' }, accountant);
  assert.equal(request.status, 'PENDING');
  await assert.rejects(() => service.decideUnblock(request.id, 'APPROVED', accountant), /Headteacher approval/);
  assert.equal((await service.decideUnblock(request.id, 'APPROVED', head)).status, 'APPROVED');
  await service.assertReadable({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', studentId: 'student-1' }, { schoolId: 'school-1' });
  assert.deepEqual(audit.map((item) => item.action), ['RESULTS_BLOCKED', 'RESULTS_UNBLOCK_REQUESTED', 'RESULTS_UNBLOCK_APPROVED']);
});

test('durable class blocks do not leak across schools or students after approval', async () => {
  const db = database(); const service = createDurableResultBlockingService({ database: db, schoolId: 'school-1', idFactory: () => 'class-1' });
  await service.blockResults({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', reason: 'Clearance' }, teacher);
  assert.equal((await service.blockFor({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', studentId: 'student-99' })).scope, 'CLASS');
  assert.equal(await service.blockFor({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 2', studentId: 'student-99' }), null);
  await assert.rejects(() => service.listBlocks({}, { schoolId: 'other-school', roleKey: 'PROPRIETOR' }), /Forbidden/);
});
