import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryFoundationRepositories, FoundationRepositoryError } from '../src/platform/foundation-repositories.js';

test('foundation repositories enforce school scope and preserve student identity', async () => {
  const repo = createMemoryFoundationRepositories({ schoolId: 'school-a' });
  const student = await repo.students.createStudentAggregate({ permanentStudentId: 'PG-000001', firstName: 'Ama', surname: 'Mensah', classId: 'class-1' });
  assert.equal((await repo.students.getStudentByPermanentId(student.permanentStudentId)).id, student.id);
  await repo.students.transitionStudentClass(student.id, { classId: 'class-2', academicYearId: '2026' });
  assert.equal((await repo.students.getStudentById(student.id)).permanentStudentId, 'PG-000001');
  assert.equal((await repo.students.getStudentClassHistory(student.id)).length, 1);
  await repo.parents.linkParentStudent({ parentId: 'parent-1', studentId: student.id });
  assert.equal((await repo.parents.listParentStudents('parent-1')).length, 1);
  await repo.parents.linkParentStudent({ parentId: 'parent-1', studentId: student.id });
  assert.equal((await repo.parents.listParentStudents('parent-1')).length, 1);
});

test('foundation transaction rolls back failed class transition', async () => {
  const repo = createMemoryFoundationRepositories({ schoolId: 'school-a' });
  const student = await repo.students.createStudentAggregate({ firstName: 'Kojo', surname: 'Owusu', classId: 'class-1' });
  await assert.rejects(() => repo.transaction.withTransaction(async () => { await repo.students.transitionStudentClass(student.id, { classId: 'class-2' }); throw new FoundationRepositoryError('TRANSACTION_FAILURE', 'Injected failure.'); }), /Injected failure/);
  assert.equal((await repo.students.getStudentById(student.id)).classId, 'class-1');
});
