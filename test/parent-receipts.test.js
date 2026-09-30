import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableFeeReader } from '../src/durable-fee-reader.js';

test('durable parent receipt reads require an active linked student and parent identity', async () => {
  const calls = [];
  const adapter = { async query(sql, params) {
    calls.push({ sql, params });
    return [{ id: 'payment-1', paymentReference: 'PAY-1', receiptNumber: 'RCT-1', invoiceNumber: 'INV-1', studentName: 'Ama Mensah', className: 'Primary 4', academicYear: '2026', term: '1st Term', feeType: 'TUITION', studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/0001', classId: 'class-1', academicYearId: 'year-1', termId: 'term-1', amount: 250, method: 'MOBILE_MONEY', status: 'COMPLETED', paymentDate: '2026-09-01', providerReference: 'MOMO-1', enteredBy: 'bursar-1', createdAt: '2026-09-01T00:00:00Z', issuer: 'bursar-1', receiptStatus: 'VALID', previousBalance: 500, newBalance: 250, parentGuardianName: 'Parent One', registeredParentPhone: '+233240000000' }];
  } };
  const reader = createDurableFeeReader({ adapter });
  const parent = { id: 'parent-1', portal: 'parent', schoolId: 'school-1' };
  const receipts = await reader.listReceipts({}, parent);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receiptNumber, 'RCT-1');
  assert.equal(receipts[0].parentGuardianName, 'Parent One');
  assert.match(calls[0].sql, /parent_student_links/);
  assert.deepEqual(calls[0].params, ['parent-1', 'school-1']);
  await assert.rejects(() => reader.listParentReceipts({ id: 'staff-1', portal: 'school', schoolId: 'school-1' }), /Parent access required/);
});

test('durable parent receipt reads return a safe empty state on schema compatibility errors', async () => {
  const reader = createDurableFeeReader({ adapter: {
    async query() { throw Object.assign(new Error("Unknown column 'p.provider_reference'"), { code: 'ER_BAD_FIELD_ERROR' }); }
  } });
  const receipts = await reader.listReceipts({}, { id: 'parent-1', portal: 'parent', schoolId: 'school-1' });
  assert.deepEqual(receipts, []);
});
