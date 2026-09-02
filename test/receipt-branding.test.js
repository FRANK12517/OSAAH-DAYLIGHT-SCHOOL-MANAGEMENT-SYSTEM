import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createFeeService } from '../src/fees.js';
import { createStudentService } from '../src/students.js';
import { createReceiptBrandingService, RECEIPT_HEADER_ASSET, RECEIPT_WATERMARK_ASSET } from '../src/receipt-branding.js';

test('official receipt branding preserves payment values in print and PDF outputs', async () => {
  const fees = createFeeService({ now: () => '2026-09-02T00:00:00.000Z' });
  const students = createStudentService({ now: () => '2026-09-02T00:00:00.000Z' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 4', admissionYearId: '2026' });
  const invoice = fees.invoice({ studentId: student.id, parentUserId: 'parent-1', lineItems: [{ type: 'TUITION', amount: 1000 }] });
  const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 250, method: 'MOBILE_MONEY' }, { userId: 'bursar-1' });
  const service = createReceiptBrandingService({ fees, students });
  const accountant = { id: 'bursar-1', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['fees.read']) };
  const receipt = service.get(payment.receiptNumber, accountant);
  assert.equal(receipt.amount, 250);
  assert.equal(receipt.balance, 750);
  assert.match(service.markup(receipt), /branding-osaah-receipt-header\.png/);
  assert.match(service.markup(receipt), /branding-osaah-watermark\.png/);
  const pdf = await service.pdf(receipt);
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.equal((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length, 4);
  assert.throws(() => service.get(payment.receiptNumber, { id: 'other', portal: 'parent', schoolId: 'school-osaah-daylight' }), /Forbidden/);
  const parentReceipt = service.get(payment.receiptNumber, { id: 'parent-1', portal: 'parent', schoolId: 'school-osaah-daylight' });
  assert.equal(parentReceipt.receiptNumber, payment.receiptNumber);
  await access(new URL(`../public${RECEIPT_HEADER_ASSET}`, import.meta.url));
  await access(new URL(`../public${RECEIPT_WATERMARK_ASSET}`, import.meta.url));
});
