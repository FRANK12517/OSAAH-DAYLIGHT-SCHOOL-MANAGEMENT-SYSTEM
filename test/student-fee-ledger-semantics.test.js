import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentFeeLedgerService } from '../src/student-fee-ledger.js';

const scope = { accountId: 'acct-1', permanentStudentId: 'OSAAH/2026/0001', academicYearId: 'year-1', termId: 'term-1', classId: 'class-1' };
const actor = { id: 'bursar-1' };

test('ledger transaction types apply the required balance semantics', () => {
  const ledger = createStudentFeeLedgerService({ now: () => '2026-09-23T00:00:00.000Z' });
  const charge = ledger.record({ ...scope, transactionType: 'CHARGE', amount: '100.00' }, actor);
  const adjustment = ledger.record({ ...scope, transactionType: 'ADJUSTMENT', amount: '-10.00' }, actor);
  ledger.record({ ...scope, transactionType: 'DISCOUNT', amount: 20 }, actor);
  ledger.record({ ...scope, transactionType: 'PAYMENT', amount: 30 }, actor);
  assert.equal(charge.balanceEffect, 100);
  assert.equal(adjustment.balanceEffect, -10);
  assert.equal(ledger.balance(scope), 40);
});

test('reversal requires an active referenced transaction and applies its exact opposite', () => {
  const ledger = createStudentFeeLedgerService();
  const charge = ledger.record({ ...scope, transactionType: 'CHARGE', amount: 75 }, actor);
  const reversal = ledger.reverse(charge.id, actor, 'Correction');
  assert.equal(reversal.transactionType, 'REVERSAL');
  assert.equal(reversal.referenceId, charge.id);
  assert.equal(reversal.balanceEffect, -75);
  assert.equal(ledger.balance(scope), 0);
  assert.equal(ledger.get(charge.id).status, 'REVERSED');
  assert.throws(() => ledger.reverse(charge.id, actor), { code: 'TRANSACTION_NOT_ACTIVE' });
  assert.throws(() => ledger.record({ ...scope, transactionType: 'REVERSAL', referenceId: reversal.id }, actor), { code: 'REVERSAL_CHAIN_NOT_ALLOWED' });
});

test('ledger validates transaction amounts and actor/school scope', () => {
  const ledger = createStudentFeeLedgerService({ schoolId: 'school-a' });
  assert.throws(() => ledger.record({ ...scope, transactionType: 'PAYMENT', amount: 0 }, actor), { code: 'INVALID_TRANSACTION_AMOUNT' });
  assert.throws(() => ledger.record({ ...scope, transactionType: 'ADJUSTMENT', amount: 0 }, actor), { code: 'INVALID_ADJUSTMENT_AMOUNT' });
  assert.throws(() => ledger.record({ ...scope, schoolId: 'school-b', transactionType: 'CHARGE', amount: 1 }, actor), { code: 'CROSS_SCHOOL_DENIED' });
  assert.throws(() => ledger.record({ ...scope, transactionType: 'CHARGE', amount: 1 }), { code: 'RECORDED_BY_REQUIRED' });
});
