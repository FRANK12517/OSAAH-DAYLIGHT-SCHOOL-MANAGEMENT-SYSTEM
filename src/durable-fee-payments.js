import { randomUUID } from 'node:crypto';
import { authorizeFinancial, assertInputSchool } from './financial-authorization.js';

const METHODS = new Set(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_DEPOSIT', 'CHEQUE', 'CARD_POS', 'ONLINE_PAYMENT', 'OTHER', 'BANK', 'MOBILE_MONEY', 'CARD', 'PAYMENT_GATEWAY']);
const text = (value) => String(value ?? '').trim();
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (message, status = 400, code = 'PAYMENT_VALIDATION_ERROR') => { throw Object.assign(new Error(message), { status, code }); };

export function createDurableFeePayments({ database, schoolId, audit = () => {}, idFactory = randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!database?.query || !database?.execute || !database?.transaction) return null;
  const amount = (value) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) fail('Amount received must be greater than zero.'); return Math.round(n * 100) / 100; };
  const period = async (tx, academicYear, term) => {
    const year = rows(await tx.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYear, academicYear]))[0];
    if (!year) fail('Academic year not found.', 404);
    const termRow = rows(await tx.query('SELECT t.id,t.name FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? AND y.id=? AND (t.id=? OR t.name=?) LIMIT 1', [schoolId, year.id, term, term]))[0];
    if (!termRow) fail('Term not found.', 404);
    return { yearId: year.id, yearName: year.name, termId: termRow.id, termName: termRow.name };
  };
  async function record(input = {}, actor) {
    authorizeFinancial(actor, 'CREATE', 'payments');
    assertInputSchool(actor, input);
    if (actor.schoolId !== schoolId) fail('Cross-school financial access is forbidden.', 403, 'CROSS_SCHOOL_ACCESS');
    const permanentStudentId = text(input.permanentStudentId || input.studentId);
    if (!permanentStudentId) fail('Student is required.');
    const academicYear = text(input.academicYearId || input.academicYear);
    const term = text(input.termId || input.term);
    if (!academicYear) fail('Academic year is required.');
    if (!term) fail('Term is required.');
    const paymentDate = text(input.paymentDate || input.date) || clock().slice(0, 10);
    const method = text(input.paymentMethod || input.method).toUpperCase().replace(/[ /-]+/g, '_');
    if (!METHODS.has(method)) fail('Invalid payment method.');
    const paidAmount = amount(input.amountReceived ?? input.amount);
    const reference = text(input.paymentReference || input.reference || `OSAAH-PAY-${Date.now()}-${idFactory().slice(0, 8)}`);
    const feeType = text(input.feeType || input.feeTypeId || input.category) || 'OTHER';
    return database.transaction(async (transaction) => {
      const tx = transaction ?? database;
      const p = await period(tx, academicYear, term);
      const student = rows(await tx.query('SELECT id,permanent_student_id AS permanentStudentId,class_id AS classId,first_name AS firstName,middle_name AS middleName,last_name AS surname FROM students WHERE school_id=? AND (id=? OR permanent_student_id=?) LIMIT 1', [schoolId, permanentStudentId, permanentStudentId]))[0];
      if (!student) fail('Student not found.', 404);
      const duplicate = rows(await tx.query('SELECT id,account_id AS accountId FROM student_fee_payments WHERE school_id=? AND payment_reference=? LIMIT 1', [schoolId, reference]))[0];
      if (duplicate) {
        const receipt = rows(await tx.query('SELECT receipt_number AS receiptNumber FROM student_fee_receipts WHERE school_id=? AND payment_id=? LIMIT 1', [schoolId, duplicate.id]))[0];
        return { duplicate: true, id: duplicate.id, receiptNumber: receipt?.receiptNumber ?? null };
      }
      let account = rows(await tx.query('SELECT id,class_id AS classId FROM student_fee_accounts WHERE school_id=? AND permanent_student_id=? AND academic_year_id=? AND term_id=? LIMIT 1', [schoolId, student.permanentStudentId, p.yearId, p.termId]))[0];
      if (!account) {
        account = { id: idFactory(), classId: student.classId ?? 'SCHOOL' };
        await tx.execute('INSERT INTO student_fee_accounts (id,school_id,student_id,permanent_student_id,academic_year_id,term_id,class_id,account_status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [account.id, schoolId, student.id, student.permanentStudentId, p.yearId, p.termId, account.classId, 'ACTIVE', actor.id, clock()]);
      }
      let invoice = rows(await tx.query('SELECT id,invoice_number AS invoiceNumber,total_amount AS totalAmount,account_id AS accountId FROM fee_invoices WHERE school_id=? AND account_id=? AND status IN (\'ISSUED\',\'PART_PAID\',\'PAID\') ORDER BY invoice_date DESC,id DESC LIMIT 1', [schoolId, account.id]))[0];
      if (!invoice) {
        const obligation = rows(await tx.query('SELECT COALESCE(SUM(amount_minor),0) AS total FROM fee_obligations WHERE school_id=? AND student_id=? AND academic_year_id=? AND term_id=? AND status=\'PUBLISHED\'', [schoolId, student.id, p.yearId, p.termId]))[0];
        const total = Number(obligation?.total ?? 0) / 100;
        if (!(total > 0)) fail('No fee obligation or invoice exists for this student and period.', 409);
        const invoiceId = idFactory(); const invoiceNumber = `INV-${Date.now()}-${invoiceId.slice(0, 8)}`; const now = clock();
        await tx.execute('INSERT INTO fee_invoices (id,school_id,account_id,permanent_student_id,academic_year_id,term_id,class_id,invoice_number,invoice_date,subtotal,total_amount,status,issued_by,issued_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [invoiceId, schoolId, account.id, student.permanentStudentId, p.yearId, p.termId, account.classId, invoiceNumber, paymentDate, total, total, 'ISSUED', actor.id, now, actor.id, now]);
        await tx.execute('INSERT INTO fee_invoice_items (id,school_id,invoice_id,fee_type,description,amount,created_at) VALUES (?,?,?,?,?,?,?)', [idFactory(), schoolId, invoiceId, feeType, text(input.notes || feeType), total, now]);
        await tx.execute('INSERT INTO student_fee_ledger (id,school_id,account_id,permanent_student_id,academic_year_id,term_id,class_id,transaction_type,fee_type,amount,reference_type,reference_id,description,transaction_date,source,recorded_by,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [idFactory(), schoolId, account.id, student.permanentStudentId, p.yearId, p.termId, account.classId, 'CHARGE', feeType, total, 'INVOICE', invoiceId, feeType, paymentDate, 'FEE_INVOICE', actor.id, now]);
        invoice = { id: invoiceId, invoiceNumber, totalAmount: total, accountId: account.id };
      }
      const previousBalanceRow = rows(await tx.query('SELECT COALESCE(SUM(CASE WHEN transaction_type=\'CHARGE\' THEN amount WHEN transaction_type IN (\'DISCOUNT\',\'PAYMENT\') THEN -amount ELSE 0 END),0) AS balance FROM student_fee_ledger WHERE school_id=? AND account_id=? AND status=\'ACTIVE\'', [schoolId, account.id]))[0];
      const previousBalance = Number(previousBalanceRow?.balance ?? invoice.totalAmount ?? 0);
      if (paidAmount > previousBalance) fail('Amount received cannot exceed the outstanding balance.', 409);
      const paymentId = idFactory(); const receiptNumber = `OSAAH-RCP-${new Date(paymentDate).getFullYear()}-${idFactory().replaceAll('-', '').slice(0, 12).toUpperCase()}`; const now = clock(); const newBalance = Math.max(0, previousBalance - paidAmount);
      await tx.execute('INSERT INTO student_fee_payments (id,school_id,account_id,invoice_id,permanent_student_id,academic_year_id,term_id,class_id,payment_reference,amount,payment_method,provider_reference,payment_date,status,received_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [paymentId, schoolId, account.id, invoice.id, student.permanentStudentId, p.yearId, p.termId, account.classId, reference, paidAmount, method, text(input.providerReference) || null, paymentDate, 'COMPLETED', actor.id, now]);
      await tx.execute('INSERT INTO student_fee_ledger (id,school_id,account_id,permanent_student_id,academic_year_id,term_id,class_id,transaction_type,fee_type,amount,reference_type,reference_id,description,transaction_date,source,recorded_by,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [idFactory(), schoolId, account.id, student.permanentStudentId, p.yearId, p.termId, account.classId, 'PAYMENT', feeType, paidAmount, 'PAYMENT', paymentId, text(input.notes || 'Fee payment'), paymentDate, 'MANUAL', actor.id, now]);
      await tx.execute('INSERT INTO student_fee_receipts (id,school_id,payment_id,account_id,permanent_student_id,receipt_number,amount_paid,previous_balance,new_balance,issued_by,issued_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [idFactory(), schoolId, paymentId, account.id, student.permanentStudentId, receiptNumber, paidAmount, previousBalance, newBalance, actor.id, now, 'VALID']);
      await tx.execute('UPDATE fee_invoices SET status=?,updated_by=?,updated_at=? WHERE id=? AND school_id=?', [newBalance === 0 ? 'PAID' : 'PART_PAID', actor.id, now, invoice.id, schoolId]);
      audit({ schoolId, userId: actor.id, action: 'CREATE', entity: 'Payment', entityId: paymentId, transactionReference: reference, newValue: { receiptNumber, amount: paidAmount, previousBalance, newBalance, role: actor.roleKey } });
      return { id: paymentId, schoolId, receiptNumber, transactionReference: reference, invoiceNumber: invoice.invoiceNumber, studentId: student.id, permanentStudentId: student.permanentStudentId, classId: account.classId, academicYearId: p.yearId, termId: p.termId, amount: paidAmount, method, status: 'COMPLETED', previousBalance, balance: newBalance, receivedBy: actor.id, createdAt: now };
    });
  }
  return Object.freeze({ record });
}
export default createDurableFeePayments;
