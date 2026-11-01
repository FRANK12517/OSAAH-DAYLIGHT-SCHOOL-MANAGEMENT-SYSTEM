import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStudentAssignmentRepository } from '../src/demo-student-assignment-repository.js';

test('demo student lookup is school, class, active status and canonical ID scoped', async () => {
  let call;
  const repository = createDemoStudentAssignmentRepository({
    schoolId: 'school-a',
    database: { query: async (sql, params) => {
      call = { sql, params };
      return [{ studentId: 'master-1', permanentStudentId: 'OSAAH/DEMO/001', firstName: 'Sample', surname: 'Student One', classId: 'class-a', schoolId: 'school-a' }];
    } }
  });
  const students = await repository.listForClass('class-a');
  assert.equal(students.length, 1);
  assert.equal(students[0].isTestRecord, true);
  assert.equal(students[0].isDemonstrationStudent, true);
  assert.deepEqual(call.params, ['school-a', 'class-a', 'OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
  assert.match(call.sql, /s\.student_status='ACTIVE'/);
  assert.match(call.sql, /s\.is_test_record=TRUE/);
  assert.match(call.sql, /student_profiles/);
});

test('demo assignment existence checks require a canonical demo identity and exact class', async () => {
  const calls = [];
  const repository = createDemoStudentAssignmentRepository({
    schoolId: 'school-a',
    database: { query: async (sql, params) => { calls.push({ sql, params }); return [{ id: 'master-1' }]; } }
  });
  assert.equal(await repository.hasAssignment({ permanentStudentId: 'OSAAH/DEMO/001', classId: 'class-a' }), true);
  assert.equal(await repository.hasAssignment({ permanentStudentId: 'OSAAH/2026/001', classId: 'class-a' }), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['school-a', 'class-a', 'OSAAH/DEMO/001', 'OSAAH/DEMO/002', 'OSAAH/DEMO/001', 'OSAAH/DEMO/001']);
});

test('demo class lookup rejects empty tenant or class scope', async () => {
  const repository = createDemoStudentAssignmentRepository({ database: { query: async () => [] } });
  await assert.rejects(() => repository.listForClass(''), /Class is required/);
  await assert.rejects(() => repository.listForClass('class-a', ''), /School is required/);
});
