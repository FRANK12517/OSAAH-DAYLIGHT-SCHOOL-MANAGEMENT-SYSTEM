import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { access } from 'node:fs/promises';
import { createFeeService } from '../src/fees.js';
import { createStudentService } from '../src/students.js';
import { createReceiptBrandingService, RECEIPT_FONT_ASSET, RECEIPT_HEADER_ASSET, RECEIPT_WATERMARK_ASSET, formatGhanaCurrency } from '../src/receipt-branding.js';
import { createApp } from '../src/server.js';
import { createAuthService } from '../src/auth.js';

function request(port, path, token) { return new Promise((resolve, reject) => { const req = http.request({ port, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }); req.on('error', reject); req.end(); }); }

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
  assert.equal(formatGhanaCurrency(1234.56), 'GH₵ 1,234.56');
  assert.deepEqual([0, 1, 10.5, 100, 10000, 100000].map(formatGhanaCurrency), ['GH₵ 0.00', 'GH₵ 1.00', 'GH₵ 10.50', 'GH₵ 100.00', 'GH₵ 10,000.00', 'GH₵ 100,000.00']);
  assert.equal(receipt.balance, 750);
  assert.match(service.markup(receipt), /branding-osaah-receipt-header\.png/);
  assert.match(service.markup(receipt), /branding-osaah-watermark\.png/);
  const pdf = await service.pdf(receipt);
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
  assert.ok((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length >= 2);
  assert.match(pdf.toString('latin1'), /\/FontFile2/);
  assert.match(pdf.toString('latin1'), /\/ToUnicode/);
  assert.equal(await service.validateAssets(), true);
  assert.throws(() => service.get(payment.receiptNumber, { id: 'other', portal: 'parent', schoolId: 'school-osaah-daylight' }), /Forbidden/);
  const parentReceipt = service.get(payment.receiptNumber, { id: 'parent-1', portal: 'parent', schoolId: 'school-osaah-daylight' });
  assert.equal(parentReceipt.receiptNumber, payment.receiptNumber);
  await access(new URL(`../public${RECEIPT_HEADER_ASSET}`, import.meta.url));
  await access(new URL(`../public${RECEIPT_WATERMARK_ASSET}`, import.meta.url));
  await access(new URL(`../public${RECEIPT_FONT_ASSET}`, import.meta.url));
});

test('receipt rendering is read-only, escapes stored values, and supports concurrent PDFs', async () => {
  const fees = createFeeService();
  const students = createStudentService();
  const student = students.createStudent({ firstName: '<Ama>', surname: 'Mensah', classId: 'Primary 4', admissionYearId: '2026' });
  const invoice = fees.invoice({ studentId: student.id, parentUserId: 'parent-1', lineItems: [{ type: 'TUITION', amount: 1000000 }] });
  const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 250.5, method: 'MOBILE_MONEY' }, { userId: 'bursar-1' });
  const service = createReceiptBrandingService({ fees, students });
  const user = { id: 'bursar-1', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['fees.read']) };
  const before = { counts: fees.counts(), payment: fees.listPayments()[0], invoice: fees.listInvoices()[0] };
  const receipt = service.buildReceiptModel(payment.receiptNumber, user);
  assert.match(service.renderReceiptHtml(receipt), /&lt;Ama&gt;/);
  const pdfs = await Promise.all([service.generateReceiptPdf(receipt), service.generateReceiptPdf(receipt)]);
  for (const pdf of pdfs) { assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/); assert.match(pdf.toString('latin1'), /\/FontFile2/); }
  assert.deepEqual(fees.counts(), before.counts);
  assert.deepEqual(fees.listPayments()[0], before.payment);
  assert.deepEqual(fees.listInvoices()[0], before.invoice);
});

test('receipt HTTP routes enforce IDOR protection and safe private responses', async () => {
  const auth = createAuthService(); const fees = createFeeService(); const students = createStudentService();
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', classId: 'Primary 4', admissionYearId: '2026' });
  const invoice = fees.invoice({ studentId: student.id, parentUserId: 'user-parent-1', lineItems: [{ type: 'TUITION', amount: 500 }] });
  const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 100, method: 'CASH' }, { userId: 'user-bursar-1' });
  const server = http.createServer(createApp({ auth, fees, students })); await new Promise((resolve) => server.listen(0, resolve)); const port = server.address().port;
  const accountant = auth.login({ username: 'bursar@osaah.edu.gh', password: 'Bursar123!', portal: 'school' }); const parent = auth.login({ username: 'parent@example.com', password: 'Parent123!', portal: 'parent' }); const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const pdf = await request(port, `/api/fees/receipts/${payment.receiptNumber}/pdf`, accountant.token); assert.equal(pdf.status, 200); assert.match(pdf.headers['content-type'], /application\/pdf/); assert.match(pdf.headers['content-disposition'], /OSAAH-Receipt-RCT-000001\.pdf/); assert.equal(pdf.headers['cache-control'], 'private, no-store');
  const preview = await request(port, `/api/fees/receipts/${payment.receiptNumber}/preview`, parent.token); assert.equal(preview.status, 200); assert.match(preview.body.toString(), /branding-osaah-watermark/);
  assert.equal((await request(port, `/api/fees/receipts/${payment.receiptNumber}`, teacher.token)).status, 403); assert.equal((await request(port, `/api/fees/receipts/${payment.receiptNumber}`)).status, 401); assert.equal((await request(port, '/api/fees/receipts/RCT-999999/pdf', accountant.token)).status, 404);
  assert.equal(fees.counts().payments, 1); assert.equal(fees.listInvoices()[0].balance, 400); await new Promise((resolve) => server.close(resolve));
});
