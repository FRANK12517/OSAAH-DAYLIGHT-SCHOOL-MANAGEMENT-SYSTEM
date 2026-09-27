import { authorizeFinancial } from './financial-authorization.js';

const VALID_STATUSES = new Set(['COMPLETED', 'POSTED', 'VALID', 'PAID']);

function paymentModel(row) {
  return {
    id: row.id,
    schoolId: row.school_id ?? row.schoolId ?? null,
    receiptNumber: row.receiptNumber ?? row.paymentReference,
    transactionReference: row.paymentReference,
    invoiceNumber: row.invoiceNumber ?? null,
    studentName: row.studentName ?? null,
    className: row.className ?? null,
    academicYear: row.academicYear ?? row.academicYearId ?? null,
    term: row.term ?? row.termId ?? null,
    feeType: row.feeType ?? null,
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
    issuer: row.issuer ?? null,
    receiptStatus: row.receiptStatus ?? null,
    previousBalance: row.previousBalance == null ? null : Number(row.previousBalance),
    balance: row.newBalance == null ? null : Number(row.newBalance)
  };
}

function unknownOptionalPaymentColumn(error, column) {
  const message = String(error?.message ?? error?.sqlMessage ?? '');
  return /unknown column/i.test(message) && new RegExp(`\\bp\\.${column}\\b`, 'i').test(message);
}

export function createDurableFeeReader({ adapter } = {}) {
  if (!adapter?.query) throw new Error('A durable database adapter is required for persisted fee reads.');

  const optionalPaymentColumns = { createdAt: true, providerReference: true };

  async function listPayments({ studentId = null, status = null } = {}, actor) {
    authorizeFinancial(actor, 'READ', 'payments');
    let rows;
    while (true) {
      const createdAtColumn = optionalPaymentColumns.createdAt ? 'p.created_at' : 'p.payment_date';
      const providerReferenceColumn = optionalPaymentColumns.providerReference ? 'p.provider_reference' : 'NULL';
      const createdAtOrder = optionalPaymentColumns.createdAt ? ', p.created_at DESC' : '';
      try {
        rows = await adapter.query(`
      SELECT p.id,
        p.payment_reference AS paymentReference,
        r.receipt_number AS receiptNumber,
        i.invoice_number AS invoiceNumber,
        i.student_name AS studentName,
        i.class_name AS className,
        i.academic_year AS academicYear,
        i.term AS term,
        (SELECT GROUP_CONCAT(DISTINCT ii.fee_type ORDER BY ii.fee_type SEPARATOR ', ')
           FROM fee_invoice_items ii
          WHERE ii.invoice_id=i.id AND ii.school_id=p.school_id) AS feeType,
        a.student_id AS studentId,
        p.permanent_student_id AS permanentStudentId,
        p.class_id AS classId,
        p.academic_year_id AS academicYearId,
        p.term_id AS termId,
        p.amount,
        p.payment_method AS method,
        p.status,
        p.payment_date AS paymentDate,
        ${providerReferenceColumn} AS providerReference,
        p.received_by AS enteredBy,
        ${createdAtColumn} AS createdAt,
        r.issued_by AS issuer,
        r.status AS receiptStatus,
        r.previous_balance AS previousBalance,
        r.new_balance AS newBalance
      FROM student_fee_payments p
      LEFT JOIN student_fee_accounts a ON a.id=p.account_id AND a.school_id=p.school_id
      LEFT JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id
      LEFT JOIN student_fee_receipts r ON r.payment_id=p.id AND r.school_id=p.school_id
      WHERE p.school_id=?
      ORDER BY p.payment_date DESC${createdAtOrder}, p.id DESC`, [actor.schoolId]);
        break;
      } catch (error) {
        if (optionalPaymentColumns.createdAt && unknownOptionalPaymentColumn(error, 'created_at')) {
          optionalPaymentColumns.createdAt = false;
          continue;
        }
        if (optionalPaymentColumns.providerReference && unknownOptionalPaymentColumn(error, 'provider_reference')) {
          optionalPaymentColumns.providerReference = false;
          continue;
        }
        throw error;
      }
    }
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

  async function getReceipt(receiptNumber, actor) {
    const receipts = await listReceipts({}, actor);
    return receipts.find((receipt) => receipt.receiptNumber === receiptNumber) ?? null;
  }

  return { listPayments, listReceipts, getReceipt, validStatuses: () => [...VALID_STATUSES] };
}
