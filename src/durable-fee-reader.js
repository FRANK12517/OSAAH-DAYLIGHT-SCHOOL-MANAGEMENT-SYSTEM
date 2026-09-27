import { authorizeFinancial } from './financial-authorization.js';

const VALID_STATUSES = new Set(['COMPLETED', 'POSTED', 'VALID', 'PAID']);

function paymentModel(row) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber ?? row.paymentReference,
    transactionReference: row.paymentReference,
    invoiceNumber: row.invoiceNumber ?? null,
    studentId: row.studentId ?? null,
    permanentStudentId: row.permanentStudentId,
    classId: row.classId,
    academicYearId: row.academicYearId,
    termId: row.termId,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    createdAt: row.createdAt,
    paymentDate: row.paymentDate,
    providerReference: row.providerReference ?? null,
    enteredBy: row.enteredBy ?? null,
    receiptStatus: row.receiptStatus ?? null,
    previousBalance: row.previousBalance == null ? null : Number(row.previousBalance),
    balance: row.newBalance == null ? null : Number(row.newBalance)
  };
}

export function createDurableFeeReader({ adapter } = {}) {
  if (!adapter?.query) throw new Error('A durable database adapter is required for persisted fee reads.');

  async function listPayments({ studentId = null, status = null } = {}, actor) {
    authorizeFinancial(actor, 'READ', 'payments');
    const rows = await adapter.query(`
      SELECT p.id,
        p.payment_reference AS paymentReference,
        r.receipt_number AS receiptNumber,
        i.invoice_number AS invoiceNumber,
        a.student_id AS studentId,
        p.permanent_student_id AS permanentStudentId,
        p.class_id AS classId,
        p.academic_year_id AS academicYearId,
        p.term_id AS termId,
        p.amount,
        p.payment_method AS method,
        p.status,
        p.payment_date AS paymentDate,
        p.provider_reference AS providerReference,
        p.received_by AS enteredBy,
        p.created_at AS createdAt,
        r.status AS receiptStatus,
        r.previous_balance AS previousBalance,
        r.new_balance AS newBalance
      FROM student_fee_payments p
      LEFT JOIN student_fee_accounts a ON a.id=p.account_id AND a.school_id=p.school_id
      LEFT JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
      LEFT JOIN student_fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id
      WHERE p.school_id=?
      ORDER BY p.payment_date DESC, p.created_at DESC, p.id DESC`, [actor.schoolId]);
    return rows.map(paymentModel).filter((payment) => {
      if (studentId && payment.studentId !== studentId && payment.permanentStudentId !== studentId) return false;
      if (status && String(payment.status).toUpperCase() !== String(status).toUpperCase()) return false;
      return true;
    });
  }

  async function listReceipts(filters = {}, actor) {
    const payments = await listPayments(filters, actor);
    return payments.filter((payment) => payment.receiptNumber && (!payment.receiptStatus || String(payment.receiptStatus).toUpperCase() !== 'VOIDED'));
  }

  return { listPayments, listReceipts, validStatuses: () => [...VALID_STATUSES] };
}
