import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentFeeObligationsRepository } from '../src/parent-fee-obligations-repository.js';

test('parent obligation reads are authenticated, parameterized, and grouped by child', async () => {
  let seen;
  const db = { query: async (sql, params) => { seen = { sql, params }; return [
    { studentId: 'st-1', permanentStudentId: 'PS-1', firstName: 'Ama', surname: 'Mensah', classId: 'p4', schoolId: 'school-a', obligationId: 'ob-1', feeStructureId: 'fee-1', amountMinor: 1000, status: 'PUBLISHED' },
    { studentId: 'st-2', permanentStudentId: 'PS-2', firstName: 'Kojo', surname: 'Mensah', classId: 'p5', schoolId: 'school-a', obligationId: null }
  ]; } };
  const result = await createParentFeeObligationsRepository(db).listForParent({ id: 'parent-1', roleKey: 'PARENT', portal: 'parent' }, { status: 'PUBLISHED' });
  assert.equal(result.children.length, 2);
  assert.equal(result.children[0].obligations[0].allocation_status, 'NOT_EVALUATED');
  assert.deepEqual(result.children[1].obligations, []);
  assert.deepEqual(seen.params, ['parent-1', 'PUBLISHED']);
  assert.match(seen.sql, /parent_user_id/);
  assert.match(seen.sql, /link_status='ACTIVE'/);
});

test('non-parent actors cannot read parent obligations', async () => {
  await assert.rejects(() => createParentFeeObligationsRepository({ query: async () => [] }).listForParent({ id: 'x', roleKey: 'TEACHER', portal: 'school' }), /Parent access required/);
});
