import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeeService } from '../src/fees.js';
import { authorizeFinancial, canFinancial, FinancialAuthorizationError } from '../src/financial-authorization.js';

const actor = (roleKey, schoolId = 'school-a', permissions = []) => ({ id: `${roleKey}-1`, roleKey, schoolId, permissions: new Set(permissions) });

test('Part 7 financial matrix is least privilege by operation', () => {
  assert.equal(canFinancial(actor('PROPRIETOR'), 'VOID_REVERSE', 'receipts'), true);
  assert.equal(canFinancial(actor('ACCOUNTANT_BURSAR', 'school-a', ['fees.read', 'fees.write']), 'CREATE', 'payments'), true);
  assert.equal(canFinancial(actor('ACCOUNTANT_BURSAR', 'school-a', ['fees.read', 'fees.write']), 'VOID_REVERSE', 'receipts'), false);
  assert.equal(canFinancial(actor('HEADTEACHER'), 'READ', 'fees'), true);
  assert.equal(canFinancial(actor('HEADTEACHER'), 'CREATE', 'invoices'), false);
  assert.equal(canFinancial(actor('ASSISTANT_HEADTEACHER'), 'PRINT_EXPORT', 'receipts'), true);
  assert.equal(canFinancial(actor('TEACHER'), 'READ', 'studentFees'), false);
});

test('server-side fee service rejects a teacher even when UI controls are bypassed', () => {
  const fees = createFeeService({ schoolId: 'school-a' });
  assert.throws(() => fees.addFee({ type: 'TUITION', amount: 100, schoolId: 'school-a' }, actor('TEACHER')), FinancialAuthorizationError);
});

test('fee service rejects cross-school actors and request school IDs', () => {
  const fees = createFeeService({ schoolId: 'school-a' });
  const accountant = actor('ACCOUNTANT_BURSAR', 'school-a', ['fees.read', 'fees.write']);
  assert.throws(() => fees.addFee({ type: 'TUITION', amount: 100, schoolId: 'school-b' }, accountant), /Cross-school/);
  assert.throws(() => fees.addFee({ type: 'TUITION', amount: 100 }, actor('ACCOUNTANT_BURSAR', 'school-b', ['fees.read', 'fees.write'])), /Cross-school/);
});

test('payment and receipt mutations are authorized and fully audited', () => {
  const audit = [];
  const fees = createFeeService({ schoolId: 'school-a', audit: (event) => audit.push(event) });
  const accountant = actor('ACCOUNTANT_BURSAR', 'school-a', ['fees.read', 'fees.write']);
  const proprietor = actor('PROPRIETOR', 'school-a');
  const invoice = fees.invoice({ studentId: 'student-a', schoolId: 'school-a', lineItems: [{ type: 'TUITION', amount: 100 }] }, accountant);
  const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 100, method: 'BANK', schoolId: 'school-a' }, accountant);
  assert.throws(() => fees.changeReceipt(payment.receiptNumber, 'REVERSE', accountant, 'Correction'), /permission required/);
  fees.changeReceipt(payment.receiptNumber, 'REVERSE', proprietor, 'Correction');
  assert.equal(audit.length, 3);
  assert.deepEqual(audit.map((event) => event.action), ['CREATE', 'CREATE', 'VOID_REVERSE']);
  for (const event of audit) {
    assert.equal(event.schoolId, 'school-a');
    assert.ok(event.userId);
    assert.ok(event.roleId);
    assert.ok(event.entity);
    assert.ok(event.transactionReference);
  }
});

test('financial service lists cannot be widened by a requested school ID', () => {
  const fees = createFeeService({ schoolId: 'school-a' });
  const headteacher = actor('HEADTEACHER', 'school-a');
  assert.throws(() => fees.listInvoices(actor('HEADTEACHER', 'school-b')), /Cross-school/);
  assert.throws(() => fees.listIncomes({ requestedSchoolId: 'school-b' }, headteacher), /Cross-school/);
  authorizeFinancial(headteacher, 'READ', 'payments', 'school-a');
});
