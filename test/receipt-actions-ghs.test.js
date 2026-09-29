import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatGhanaCurrency, createReceiptBrandingService } from '../src/receipt-branding.js';
import { createFeeService } from '../src/fees.js';
import { createStudentService } from '../src/students.js';

const financePage = new URL('../public/finance-canonical.html', import.meta.url);
const receiptsPage = new URL('../public/receipts.html', import.meta.url);

test('generated receipts expose canonical View, Print, and Export actions only from persisted receipt IDs', async () => {
  const source = await readFile(financePage, 'utf8');
  assert.match(source, /RECEIPT GENERATED SUCCESSFULLY/);
  assert.match(source, /data-print-receipt/);
  assert.match(source, /window\.open\('', '_blank'/);
  assert.match(source, /printWindow\.print\(\)/);
  assert.match(source, /receiptActions\(result\.receiptNumber, \{ view: false \}\)/);
  assert.match(source, /api\/fees\/receipts\/\$\{encoded\}\/pdf/);
  assert.match(source, /Export to PDF/);
  assert.match(source, /receiptActions\(row\.receiptNumber/);
  assert.doesNotMatch(source, /Download PDF/);

  const receipts = await readFile(receiptsPage, 'utf8');
  assert.match(receipts, /Print Receipt/);
  assert.match(receipts, /Export to PDF/);
  assert.match(receipts, /disabled/);
});

test('canonical receipt HTML and PDF use Ghana Cedi labels without changing numeric amounts', async () => {
  const fees = createFeeService({ now: () => '2026-09-02T00:00:00.000Z' });
  const students = createStudentService({ now: () => '2026-09-02T00:00:00.000Z' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 4', admissionYearId: '2026' });
  const invoice = fees.invoice({ studentId: student.id, lineItems: [{ type: 'TUITION', amount: 1000 }] });
  const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 250, method: 'CASH' }, { userId: 'accountant-1' });
  const service = createReceiptBrandingService({ fees, students });
  const user = { id: 'accountant-1', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['fees.read']) };
  const receipt = service.get(payment.receiptNumber, user);
  assert.equal(receipt.amount, 250);
  assert.equal(receipt.amountDue, 1000);
  assert.equal(formatGhanaCurrency(receipt.amount), 'GH₵ 250.00');
  const markup = service.markup(receipt);
  for (const label of ['Currency', 'Amount Due', 'Previously Paid', 'Amount Received', 'Total Paid', 'Outstanding Balance', 'GHS']) assert.match(markup, new RegExp(label));
  assert.match(markup, /GH₵ 250\.00/);
  const pdf = await service.pdf(receipt);
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
  assert.ok((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 2);
  assert.equal(fees.listPayments()[0].amount, 250);
});
