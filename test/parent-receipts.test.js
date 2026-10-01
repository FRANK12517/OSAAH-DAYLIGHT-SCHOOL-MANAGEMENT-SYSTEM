import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableFeeReader } from '../src/durable-fee-reader.js';

const parent = { id: 'parent-1', portal: 'parent', schoolId: 'school-1' };

function receiptRow(overrides = {}) {
  return {
    id: 'payment-1', paymentReference: 'PAY-1', receiptNumber: 'RCT-1', invoiceNumber: 'INV-1',
    studentName: 'Controlled Student', className: 'Primary 4', academicYear: '2026', term: 'Term 1',
    feeType: 'TUITION', studentId: 'profile-1', permanentStudentId: 'CONTROLLED-0001', classId: 'class-1',
    academicYearId: 'year-1', termId: 'term-1', amount: 250, method: 'MOBILE_MONEY', status: 'COMPLETED',
    paymentDate: '2026-09-01', providerReference: 'MOMO-1', enteredBy: 'bursar-1',
    createdAt: '2026-09-01T00:00:00Z', issuer: 'bursar-1', receiptStatus: 'VALID',
    previousBalance: 500, newBalance: 250, parentGuardianName: 'Controlled Parent',
    registeredParentPhone: '+233240000000', ...overrides
  };
}

function error(message, code) {
  return Object.assign(new Error(message), { code });
}

test('durable parent receipt reads require an active linked student and parent identity', async () => {
  const calls = [];
  const adapter = { async query(sql, params) {
    calls.push({ sql, params });
    return [receiptRow()];
  } };
  const reader = createDurableFeeReader({ adapter });
  const receipts = await reader.listReceipts({}, parent);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receiptNumber, 'RCT-1');
  assert.equal(receipts[0].parentGuardianName, 'Controlled Parent');
  assert.match(calls[0].sql, /parent_student_links/);
  assert.deepEqual(calls[0].params, ['parent-1', 'school-1']);
  await assert.rejects(() => reader.listParentReceipts({ id: 'staff-1', portal: 'school', schoolId: 'school-1' }), /Parent access required/);
});

test('durable parent receipt reads return an empty collection when no receipts exist', async () => {
  const reader = createDurableFeeReader({ adapter: { async query() { return []; } } });
  assert.deepEqual(await reader.listReceipts({}, parent), []);
});

test('the exact missing legacy receipt relation is a safe empty state', async () => {
  const reader = createDurableFeeReader({ adapter: {
    async query() { throw error("Table 'school.student_fee_receipts' doesn't exist", 'ER_NO_SUCH_TABLE'); }
  } });
  assert.deepEqual(await reader.listReceipts({}, parent), []);
});

test('the exact missing legacy receipt column is a safe empty state', async () => {
  const reader = createDurableFeeReader({ adapter: {
    async query() { throw error("Unknown column 'r.receipt_number'", 'ER_BAD_FIELD_ERROR'); }
  } });
  assert.deepEqual(await reader.listReceipts({}, parent), []);
});

test('legacy optional payment columns use the established fallback and preserve receipts', async () => {
  let calls = 0;
  const reader = createDurableFeeReader({ adapter: { async query(sql) {
    calls += 1;
    if (calls === 1) throw error("Unknown column 'p.provider_reference'", 'ER_BAD_FIELD_ERROR');
    return [receiptRow({ providerReference: null })];
  } } });
  const receipts = await reader.listReceipts({}, parent);
  assert.equal(calls, 2);
  assert.equal(receipts[0].receiptNumber, 'RCT-1');
});

for (const [label, failure] of [
  ['an unrelated ER_BAD_FIELD_ERROR', error("Unknown column 'p.unrelated_field'", 'ER_BAD_FIELD_ERROR')],
  ['an unrelated missing table', error("Table 'school.unrelated_table' doesn't exist", 'ER_NO_SUCH_TABLE')],
  ['a connection error', error('Connection refused', 'ECONNREFUSED')],
  ['a timeout', error('Query timed out', 'ETIMEDOUT')],
  ['a generic repository failure', error('Repository unavailable', 'REPOSITORY_FAILURE')]
]) {
  test(`${label} propagates`, async () => {
    const reader = createDurableFeeReader({ adapter: { async query() { throw failure; } } });
    await assert.rejects(() => reader.listReceipts({}, parent), (received) => received === failure);
  });
}

test('logged-out Parent receipt requests are rejected before database access', async () => {
  let queried = false;
  const reader = createDurableFeeReader({ adapter: { async query() { queried = true; return []; } } });
  await assert.rejects(() => reader.listReceipts({}, { portal: 'parent', schoolId: 'school-1' }), /Parent access required/);
  assert.equal(queried, false);
});

test('receipt rows without canonical receipt identity are not fabricated', async () => {
  const reader = createDurableFeeReader({ adapter: { async query() { return [receiptRow({ receiptNumber: null, paymentReference: 'PAY-ONLY' })]; } } });
  assert.deepEqual(await reader.listReceipts({}, parent), []);
});
