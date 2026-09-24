import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createCashbookService } from '../src/cashbook.js';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';

function memoryCashbookAdapter() {
  const tables = {
    payments: [
      { id:'fee-1', school_id:'school-test-a', payment_reference:'FEE-001', permanent_student_id:'PS-001', student_name:'Ama Mensah', academic_year_id:'2026', term_id:'TERM1', amount:'0.10', payment_method:'CASH', payment_date:'2026-01-01T09:00:00', status:'COMPLETED', received_by:'accountant-a', created_at:'2026-01-01T09:00:00' },
      { id:'fee-2', school_id:'school-test-a', payment_reference:'FEE-REVERSED', permanent_student_id:'PS-002', student_name:'Kojo Mensah', academic_year_id:'2026', term_id:'TERM1', amount:'999.99', payment_method:'BANK', payment_date:'2026-01-02T09:00:00', status:'REVERSED', received_by:'accountant-a', created_at:'2026-01-02T09:00:00' },
      { id:'fee-3', school_id:'school-test-a', payment_reference:'FEE-002', permanent_student_id:'PS-001', student_name:'Ama Mensah', academic_year_id:'2026', term_id:'TERM1', amount:'0.20', payment_method:'BANK', payment_date:'2026-01-02T09:00:00', status:'VALID', received_by:'accountant-a', created_at:'2026-01-02T09:00:00' },
      { id:'fee-b', school_id:'school-test-b', payment_reference:'FEE-B', permanent_student_id:'PS-B', student_name:'School B Student', academic_year_id:'2026', term_id:'TERM1', amount:'700.00', payment_method:'CASH', payment_date:'2026-01-01T09:00:00', status:'COMPLETED', received_by:'accountant-b', created_at:'2026-01-01T09:00:00' }
    ],
    income: [
      { id:'income-1', school_id:'school-test-a', transaction_date:'2026-01-02T09:00:00', academic_year:'2026', term:'TERM1', income_category:'Donations', description:'Library donation', reference_number:'INC-001', amount:'0.30', payment_method:'BANK', payer_or_source:'Alumni Association', status:'POSTED', created_by:'accountant-a', created_at:'2026-01-02T09:00:00' },
      { id:'income-void', school_id:'school-test-a', transaction_date:'2026-01-02T10:00:00', academic_year:'2026', term:'TERM1', income_category:'Grants', description:'Voided grant', reference_number:'INC-VOID', amount:'500.00', payment_method:'BANK', payer_or_source:'District', status:'VOIDED', created_by:'accountant-a', created_at:'2026-01-02T10:00:00' }
    ],
    expenses: [
      { id:'expense-1', school_id:'school-test-a', transaction_date:'2026-01-03T09:00:00', academic_year:'2026', term:'TERM1', expense_category:'Utilities', description:'Electricity', reference_number:'EXP-001', amount:'0.40', payment_method:'BANK', payee:'Power Company', status:'POSTED', created_by:'accountant-a', created_at:'2026-01-03T09:00:00' },
      { id:'expense-void', school_id:'school-test-a', transaction_date:'2026-01-03T10:00:00', academic_year:'2026', term:'TERM1', expense_category:'Utilities', description:'Voided expense', reference_number:'EXP-VOID', amount:'600.00', payment_method:'BANK', payee:'Supplier', status:'VOIDED', created_by:'accountant-a', created_at:'2026-01-03T10:00:00' }
    ]
  };
  return { tables, async query(sql, params = []) { if (sql.includes('student_fee_payments')) return tables.payments.filter((row) => row.school_id === params[0] && ['COMPLETED','POSTED','VALID','PAID'].includes(row.status)); if (sql.includes('general_income')) return tables.income.filter((row) => row.school_id === params[0]); if (sql.includes('general_expenses')) return tables.expenses.filter((row) => row.school_id === params[0]); return []; } };
}
const accountant = { id:'accountant-a', roleKey:'ACCOUNTANT_BURSAR', schoolId:'school-test-a' };
const proprietor = { id:'proprietor-a', roleKey:'PROPRIETOR', schoolId:'school-test-a' };

test('Cashbook derives one qualifying entry per source and reconciles exact cents', async () => {
  const service = createCashbookService({ adapter:memoryCashbookAdapter() }); const result = await service.getCashbookEntries({}, accountant); assert.equal(result.total, 4); assert.deepEqual(result.entries.map((row) => row.sourceType), ['FEE_PAYMENT','FEE_PAYMENT','GENERAL_INCOME','GENERAL_EXPENSE']); assert.equal(result.summary.openingBalance, 0); assert.equal(result.summary.totalMoneyIn, 0.6); assert.equal(result.summary.totalMoneyOut, 0.4); assert.equal(result.summary.closingBalance, 0.2); assert.equal(result.entries.at(-1).runningBalance, 0.2); assert.ok(!result.entries.some((row) => row.reference.includes('VOID') || row.reference.includes('REVERSED')));
});

test('Cashbook opening balance and running balance remain correct across date filters and pages', async () => {
  const service = createCashbookService({ adapter:memoryCashbookAdapter() }); const filtered = await service.getCashbookEntries({ dateFrom:'2026-01-02', dateTo:'2026-01-03' }, accountant); assert.equal(filtered.summary.openingBalance, 0.1); assert.equal(filtered.summary.totalMoneyIn, 0.5); assert.equal(filtered.summary.totalMoneyOut, 0.4); assert.equal(filtered.summary.closingBalance, 0.2); const page1 = await service.getCashbookEntries({ page:1, pageSize:1 }, accountant); const page2 = await service.getCashbookEntries({ page:2, pageSize:1 }, accountant); assert.equal(page1.entries[0].runningBalance, 0.1); assert.equal(page2.entries[0].runningBalance, 0.3); assert.equal(page2.summary.closingBalance, 0.2); assert.equal(page2.total, 4);
});

test('Cashbook deterministically orders same-time sources and supports filters/search', async () => {
  const service = createCashbookService({ adapter:memoryCashbookAdapter() }); const result = await service.getCashbookEntries({ academicYear:'2026', term:'TERM1', sourceType:'GENERAL_INCOME', paymentMethod:'BANK', search:'Alumni' }, proprietor); assert.equal(result.total, 1); assert.equal(result.entries[0].reference, 'INC-001'); const sameDate = await service.getCashbookEntries({ dateFrom:'2026-01-02', dateTo:'2026-01-02' }, accountant); assert.deepEqual(sameDate.entries.map((row) => row.sourceId), ['fee-3','income-1']); const studentSearch = await service.getCashbookEntries({ search:'PS-001' }, accountant); assert.equal(studentSearch.total, 2);
});

test('Cashbook controlled reconciliation preserves a prior GHS 1,000 opening balance', async () => {
  const db = memoryCashbookAdapter(); db.tables.payments = [{ id:'opening-fee', school_id:'school-test-a', payment_reference:'OPEN-001', permanent_student_id:'PS-OPEN', student_name:'Opening Student', academic_year_id:'2026', term_id:'TERM1', amount:'1000.00', payment_method:'BANK', payment_date:'2025-12-31T09:00:00', status:'COMPLETED', received_by:'accountant-a', created_at:'2025-12-31T09:00:00' }, { id:'period-fee', school_id:'school-test-a', payment_reference:'FEE-500', permanent_student_id:'PS-OPEN', student_name:'Opening Student', academic_year_id:'2026', term_id:'TERM1', amount:'500.00', payment_method:'BANK', payment_date:'2026-01-01T09:00:00', status:'COMPLETED', received_by:'accountant-a', created_at:'2026-01-01T09:00:00' }]; db.tables.income = [{ id:'period-income', school_id:'school-test-a', transaction_date:'2026-01-02T09:00:00', academic_year:'2026', term:'TERM1', income_category:'Donations', description:'Donation', reference_number:'INC-200', amount:'200.00', payment_method:'CASH', payer_or_source:'Community', status:'POSTED', created_by:'accountant-a', created_at:'2026-01-02T09:00:00' }]; db.tables.expenses = [{ id:'period-expense', school_id:'school-test-a', transaction_date:'2026-01-03T09:00:00', academic_year:'2026', term:'TERM1', expense_category:'Utilities', description:'Power', reference_number:'EXP-300', amount:'300.00', payment_method:'BANK', payee:'Power Company', status:'POSTED', created_by:'accountant-a', created_at:'2026-01-03T09:00:00' }]; const result = await createCashbookService({ adapter:db }).getCashbookEntries({ dateFrom:'2026-01-01', dateTo:'2026-01-03' }, accountant); assert.equal(result.summary.openingBalance, 1000); assert.equal(result.summary.totalMoneyIn, 700); assert.equal(result.summary.totalMoneyOut, 300); assert.equal(result.summary.closingBalance, 1400); assert.equal(result.entries.at(-1).runningBalance, 1400);
});

test('Cashbook details are source-labeled, school-scoped, and read-only', async () => {
  const service = createCashbookService({ adapter:memoryCashbookAdapter() }); const detail = await service.getCashbookEntryDetails('GENERAL_INCOME','income-1', accountant); assert.equal(detail.source.sourceType, 'GENERAL_INCOME'); assert.equal(detail.source.reference, 'INC-001'); await assert.rejects(() => service.getCashbookEntryDetails('GENERAL_INCOME','income-1',{ ...accountant, schoolId:'school-test-b' }), (error) => error.status === 404); await assert.rejects(() => service.getCashbookEntryDetails('INVALID','income-1',accountant), (error) => error.status === 400);
});

function request(port, path, { method='GET', token, body } = {}) { return new Promise((resolve, reject) => { const headers = token ? { Authorization:`Bearer ${token}` } : {}; if (body) headers['Content-Type'] = 'application/json'; const req = httpRequest({ port, path, method, headers }, (res) => { let raw=''; res.on('data',(chunk) => { raw += chunk; }); res.on('end',() => resolve({ status:res.statusCode, body:raw ? JSON.parse(raw) : null })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); }); }

test('Cashbook HTTP API enforces Accountant/Proprietor access, rejects unauthorized roles, and has no write endpoint', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = fixture.app; const listener = server.listen ? server : null; const httpServer = listener ?? (await import('node:http')).createServer(server); await new Promise((resolve) => httpServer.listen(0, resolve)); try { const port = httpServer.address().port; const allowed = await request(port, '/api/finance/cashbook', { token:fixture.accountantToken }); assert.equal(allowed.status, 200); assert.equal(Array.isArray(allowed.body.entries), true); const teacher = await request(port, '/api/finance/cashbook', { token:fixture.teacherToken }); assert.equal(teacher.status, 403); const unauthenticated = await request(port, '/api/finance/cashbook'); assert.equal(unauthenticated.status, 401); const write = await request(port, '/api/finance/cashbook', { method:'POST', token:fixture.accountantToken, body:{} }); assert.equal(write.status, 405); } finally { await new Promise((resolve) => httpServer.close(resolve)); }
});
