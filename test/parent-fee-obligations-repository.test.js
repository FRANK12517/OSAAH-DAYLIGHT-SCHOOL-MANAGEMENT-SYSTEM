import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentFeeObligationsRepository } from '../src/parent-fee-obligations-repository.js';

test('parent obligation reads are authenticated, parameterized, and grouped by child', async () => {
  let seen;
  const db = { query: async (sql, params) => { seen = { sql, params }; return [
    { studentId: 'st-1', permanentStudentId: 'PS-1', firstName: 'Ama', surname: 'Mensah', classId: 'p4', schoolId: 'school-a', obligationId: 'ob-1', feeStructureId: 'fee-1', amountMinor: 1000, status: 'PUBLISHED' },
    { studentId: 'st-2', permanentStudentId: 'PS-2', firstName: 'Kojo', surname: 'Mensah', classId: 'p5', schoolId: 'school-a', obligationId: null }
  ]; } };
  const result = await createParentFeeObligationsRepository(db).listForParent({ id: 'parent-1', schoolId: 'school-a', roleKey: 'PARENT', portal: 'parent' }, { status: 'PUBLISHED' });
  assert.equal(result.children.length, 2);
  assert.equal(result.children[0].obligations[0].allocation_status, 'NOT_EVALUATED');
  assert.deepEqual(result.children[1].obligations, []);
  assert.deepEqual(seen.params, ['school-a', 'parent-1', 'school-a', 'PUBLISHED']);
  assert.match(seen.sql, /parent_user_id/);
  assert.match(seen.sql, /s\.school_id=\?/);
  assert.match(seen.sql, /s\.last_name AS surname/);
  assert.doesNotMatch(seen.sql, /s\.surname/);
  assert.match(seen.sql, /link_status='ACTIVE'/);
});

test('non-parent actors cannot read parent obligations', async () => {
  await assert.rejects(() => createParentFeeObligationsRepository({ query: async () => [] }).listForParent({ id: 'x', roleKey: 'TEACHER', portal: 'school' }), /Parent access required/);
});

test('Parent obligation reads require the authenticated school scope', async () => {
  await assert.rejects(() => createParentFeeObligationsRepository({ query: async () => [] }).listForParent({ id: 'parent-1', roleKey: 'PARENT', portal: 'parent' }), /Parent access required/);
});

test('Parent obligation class filters use the stored period obligation class and retain class-neutral fees', async () => {
  let seen;
  const db = { query: async (sql, params) => { seen = { sql, params }; return []; } };
  await createParentFeeObligationsRepository(db).listForParent({ id: 'parent-1', schoolId: 'school-a', roleKey: 'PARENT', portal: 'parent' }, { academicYearId: 'year-1', termId: 'term-1', classId: 'class-historical', status: 'PUBLISHED' });
  assert.deepEqual(seen.params, ['school-a', 'parent-1', 'school-a', 'year-1', 'term-1', 'PUBLISHED', 'class-historical']);
  assert.match(seen.sql, /\(fo\.class_id=\? OR fo\.class_id IS NULL\)/);
  assert.doesNotMatch(seen.sql, /sp\.class_id=\?/);
});
