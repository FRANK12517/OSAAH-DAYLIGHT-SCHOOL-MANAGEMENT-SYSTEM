import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeeService } from '../src/fees.js';
import { createFinancialIntelligenceService } from '../src/ai/financial-intelligence.js';
import { createReceiptBrandingService } from '../src/receipt-branding.js';
import { createReportingService } from '../src/reporting.js';

const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const YEAR = '2026';
const TERM = 'T1';
const CLASS = 'class-a';
const PERMANENT_ID = 'OSAAH/2026/0001';
const actor = (roleKey, schoolId = SCHOOL_A) => ({ id: `${roleKey}-${schoolId}`, roleKey, schoolId, portal: 'school', permissions: new Set(['finance.read', 'fees.read']) });
const cents = (value) => Math.round(value * 100);

function makeStudentDirectory(permanentStudentId = PERMANENT_ID) {
  return { getStudent: (studentId) => ({ id: studentId, permanentStudentId, firstName: 'Ama', surname: 'Mensah', classId: CLASS }) };
}

function projectionBundle(fees, studentId, actorForRead, receiptBranding, financialIntelligence, reporting) {
  const statement = fees.statement(studentId, null, actorForRead, { academicYearId: YEAR, termId: TERM, classId: CLASS });
  const invoices = fees.listInvoices(actorForRead).filter((item) => item.studentId === studentId && item.academicYearId === YEAR && item.termId === TERM && item.classId === CLASS);
  const payments = fees.listPayments(actorForRead).filter((item) => item.studentId === studentId && item.academicYearId === YEAR && item.termId === TERM && item.classId === CLASS);
  return { statement, invoices, payments, receipt: receiptBranding.get(payments.at(-1).receiptNumber, actorForRead), financialIntelligence, reporting };
}

test('Part 8 authoritative source of truth stays synchronized from assessment through full payment', async () => {
  const fees = createFeeService({ schoolId: SCHOOL_A, now: () => '2026-09-23T12:00:00.000Z' });
  const studentDirectory = makeStudentDirectory();
  const receiptBranding = createReceiptBrandingService({ fees, students: studentDirectory, schoolId: SCHOOL_A });
  const financialIntelligence = createFinancialIntelligenceService({ fees, now: () => '2026-09-23T12:00:00.000Z' });
  const reporting = createReportingService({ schoolId: SCHOOL_A, now: () => '2026-09-23T12:00:00.000Z' });
  const accountant = actor('ACCOUNTANT_BURSAR');
  const invoice = fees.invoice({ studentId: 'student-a', permanentStudentId: PERMANENT_ID, classId: CLASS, academicYearId: YEAR, termId: TERM, lineItems: [{ type: 'TUITION', amount: 2000 }] }, accountant);
  const stages = [
    { amount: 500, paid: 500, outstanding: 1500, status: 'PART_PAID' },
    { amount: 700, paid: 1200, outstanding: 800, status: 'PART_PAID' },
    { amount: 800, paid: 2000, outstanding: 0, status: 'PAID' }
  ];
  const receiptNumbers = [];
  for (const stage of stages) {
    const payment = fees.pay({ invoiceNumber: invoice.invoiceNumber, amount: stage.amount, method: 'BANK', schoolId: SCHOOL_A }, accountant);
    receiptNumbers.push(payment.receiptNumber);
    const bundle = projectionBundle(fees, 'student-a', accountant, receiptBranding, financialIntelligence, reporting);
    assert.equal(bundle.invoices.length, 1);
    assert.equal(bundle.invoices[0].total, 2000);
    assert.equal(bundle.invoices[0].paid, stage.paid);
    assert.equal(bundle.invoices[0].balance, stage.outstanding);
    assert.equal(bundle.invoices[0].status, stage.status);
    assert.equal(bundle.statement.invoices[0].balance, stage.outstanding);
    assert.equal(bundle.statement.payments.reduce((sum, item) => sum + item.amount, 0), stage.paid);
    assert.equal(bundle.payments.reduce((sum, item) => sum + item.amount, 0), stage.paid);
    assert.equal(bundle.receipt.receiptNumber, payment.receiptNumber);
    assert.equal(bundle.receipt.transactionReference, payment.id);
    assert.equal(payment.invoiceNumber, invoice.invoiceNumber);
    assert.equal(payment.permanentStudentId, PERMANENT_ID);
    assert.equal(payment.classId, CLASS);

    const dashboard = await financialIntelligence.snapshot({ actor: accountant, academicYearId: YEAR, termId: TERM, classId: CLASS, studentId: PERMANENT_ID });
    assert.deepEqual({ assessed: dashboard.metrics.expectedRevenue, paid: dashboard.metrics.totalCollected, outstanding: dashboard.metrics.outstanding }, { assessed: 2000, paid: stage.paid, outstanding: stage.outstanding });
    const refreshedDashboard = await financialIntelligence.snapshot({ actor: accountant, academicYearId: YEAR, termId: TERM, classId: CLASS, studentId: PERMANENT_ID });
    assert.deepEqual(refreshedDashboard.metrics, dashboard.metrics);

    const report = reporting.buildFinancialReport({ academicYear: YEAR, term: TERM, classId: CLASS, studentId: 'student-a' }, accountant, { fees });
    assert.deepEqual({ assessed: report.summary.totalExpectedFees, paid: report.summary.totalFeesCollected, outstanding: report.summary.totalOutstandingFees }, { assessed: 2000, paid: stage.paid, outstanding: stage.outstanding });
  }
  assert.deepEqual(receiptNumbers, ['RCT-000001', 'RCT-000002', 'RCT-000003']);
});

test('Part 8 isolates academic year, term, class, student, and school without changing the canonical balance', async () => {
  const feesA = createFeeService({ schoolId: SCHOOL_A, now: () => '2026-09-23T12:00:00.000Z' });
  const feesB = createFeeService({ schoolId: SCHOOL_B, now: () => '2026-09-23T12:00:00.000Z' });
  const readA = actor('HEADTEACHER', SCHOOL_A);
  const readB = actor('HEADTEACHER', SCHOOL_B);
  const writeA = actor('ACCOUNTANT_BURSAR', SCHOOL_A);
  const writeB = actor('ACCOUNTANT_BURSAR', SCHOOL_B);
  const main = feesA.invoice({ studentId: 'student-a', permanentStudentId: PERMANENT_ID, classId: CLASS, academicYearId: YEAR, termId: TERM, lineItems: [{ type: 'TUITION', amount: 2000 }] }, writeA);
  const otherTerm = feesA.invoice({ studentId: 'student-a', permanentStudentId: PERMANENT_ID, classId: CLASS, academicYearId: YEAR, termId: 'T2', lineItems: [{ type: 'TUITION', amount: 300 }] }, writeA);
  const otherClass = feesA.invoice({ studentId: 'student-a', permanentStudentId: PERMANENT_ID, classId: 'class-b', academicYearId: YEAR, termId: TERM, lineItems: [{ type: 'TUITION', amount: 400 }] }, writeA);
  const otherStudent = feesA.invoice({ studentId: 'student-b', permanentStudentId: 'OSAAH/2026/0002', classId: CLASS, academicYearId: YEAR, termId: TERM, lineItems: [{ type: 'TUITION', amount: 500 }] }, writeA);
  feesB.invoice({ studentId: 'student-a', permanentStudentId: 'OTHER/2026/0001', classId: CLASS, academicYearId: YEAR, termId: TERM, lineItems: [{ type: 'TUITION', amount: 900 }] }, writeB);
  feesA.pay({ invoiceNumber: main.invoiceNumber, amount: 500, method: 'BANK', schoolId: SCHOOL_A }, writeA);
  feesA.pay({ invoiceNumber: otherTerm.invoiceNumber, amount: 300, method: 'BANK', schoolId: SCHOOL_A }, writeA);
  feesA.pay({ invoiceNumber: otherClass.invoiceNumber, amount: 400, method: 'BANK', schoolId: SCHOOL_A }, writeA);
  feesA.pay({ invoiceNumber: otherStudent.invoiceNumber, amount: 500, method: 'BANK', schoolId: SCHOOL_A }, writeA);
  const intelligenceA = createFinancialIntelligenceService({ fees: feesA, now: () => '2026-09-23T12:00:00.000Z' });
  const scoped = await intelligenceA.snapshot({ actor: readA, academicYearId: YEAR, termId: TERM, classId: CLASS, studentId: PERMANENT_ID });
  assert.deepEqual({ assessed: scoped.metrics.expectedRevenue, paid: scoped.metrics.totalCollected, outstanding: scoped.metrics.outstanding }, { assessed: 2000, paid: 500, outstanding: 1500 });
  const termOnly = await intelligenceA.snapshot({ actor: readA, academicYearId: YEAR, termId: 'T2', classId: CLASS, studentId: PERMANENT_ID });
  assert.equal(termOnly.metrics.expectedRevenue, 300);
  const classOnly = await intelligenceA.snapshot({ actor: readA, academicYearId: YEAR, termId: TERM, classId: 'class-b', studentId: PERMANENT_ID });
  assert.equal(classOnly.metrics.expectedRevenue, 400);
  const studentOnly = await intelligenceA.snapshot({ actor: readA, academicYearId: YEAR, termId: TERM, classId: CLASS, studentId: 'OSAAH/2026/0002' });
  assert.equal(studentOnly.metrics.expectedRevenue, 500);
  const intelligenceB = createFinancialIntelligenceService({ fees: feesB, now: () => '2026-09-23T12:00:00.000Z' });
  const schoolBView = await intelligenceB.snapshot({ actor: readB, academicYearId: YEAR, termId: TERM, classId: CLASS });
  assert.equal(schoolBView.metrics.expectedRevenue, 900);
  assert.equal((await intelligenceA.snapshot({ actor: readA, academicYearId: YEAR, termId: TERM, classId: CLASS, studentId: 'OTHER/2026/0001' })).metrics.expectedRevenue, 0);
  assert.equal(feesA.listInvoices(readA).find((item) => item.invoiceNumber === main.invoiceNumber).balance, 1500);
});
