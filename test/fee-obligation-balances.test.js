import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeObligationBalances } from '../src/fee-obligation-balances.js';

test('ambiguous invoice/payment history remains neutral', () => {
  const balance = createFeeObligationBalances().getBalanceForObligation({ id: 'ob-1', amountMinor: 1250 });
  assert.deepEqual(balance, { obligationId: 'ob-1', allocation_status: 'UNAVAILABLE', charged_minor: 1250, paid_minor: null, outstanding_minor: null, payment_status: null });
});

test('balance projection never performs floating-point or fabricated attribution', () => {
  const rows = createFeeObligationBalances().getBalancesForObligations([{ id: 'a', amountMinor: 100 }, { id: 'b', amountMinor: 101 }]);
  assert.equal(rows.every((row) => row.allocation_status === 'UNAVAILABLE' && row.paid_minor === null), true);
});
