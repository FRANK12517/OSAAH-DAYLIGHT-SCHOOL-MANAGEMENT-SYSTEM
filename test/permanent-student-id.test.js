import assert from 'node:assert/strict';
import test from 'node:test';
import { createPermanentStudentIdAllocator, reconcilePermanentStudentIds } from '../src/permanent-student-id.js';
import { createStudentService } from '../src/students.js';

test('yearly allocator issues immutable, non-reusable identifiers sequentially', () => {
  const allocator = createPermanentStudentIdAllocator();
  assert.equal(allocator.reserve(2026), 'OSAAH/2026/0001');
  assert.equal(allocator.reserve('2026-09-02'), 'OSAAH/2026/0002');
  assert.throws(() => allocator.register('OSAAH/2026/0002'), /already exists/);
});

test('backfill preserves valid IDs and flags ambiguous records instead of guessing', () => {
  const allocator = createPermanentStudentIdAllocator();
  allocator.register('OSAAH/2025/0003');
  const students = [{ id: 'valid', permanentStudentId: 'OSAAH/2025/0003' }, { id: 'missing' }, { id: 'unknown' }, { id: 'bad', permanentStudentId: 'manual-id' }];
  const report = reconcilePermanentStudentIds(students, { allocate: (year) => allocator.reserve(year), admissionYear: (student) => student.id === 'missing' ? 2026 : null });
  assert.equal(students[0].permanentStudentId, 'OSAAH/2025/0003');
  assert.equal(students[1].permanentStudentId, 'OSAAH/2026/0001');
  assert.deepEqual(report.ambiguities.map((item) => item.studentId), ['unknown', 'bad']);
});

test('promotion/class changes cannot alter a permanent Student ID', () => {
  const students = createStudentService({ now: () => '2026-09-02T00:00:00.000Z' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', admissionDate: '2026-09-02', classId: 'Primary 4' });
  const promoted = students.assignClass(student.id, { classId: 'Primary 5', reason: 'PROMOTION' });
  assert.equal(promoted.permanentStudentId, student.permanentStudentId);
  assert.equal(students.findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER' }).id, student.id);
});
