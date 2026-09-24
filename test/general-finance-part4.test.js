import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import test from 'node:test';
import { createGeneralFinanceService } from '../src/general-finance.js';
import { createReportingService } from '../src/reporting.js';
import { createApp } from '../src/server.mjs';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';

function adapter() {
  const storage = { income: [], expenses: [], budgets: [{ id: 'budget-a', school_id: 'school-test-a', status: 'APPROVED', budget_name: 'Approved Plan' }], items: [{ id: 'item-a', budget_id: 'budget-a', school_id: 'school-test-a', category: 'Utilities', description: 'Power' }], audit: [] };
  const rows = (kind) => kind === 'income' ? storage.income : storage.expenses;
  return { storage,
    async query(sql, params = []) {
      if (sql.includes('FROM academic_years')) return params[1] === 'school-test-a' ? [{ id: params[0] }] : [];
      if (sql.includes('FROM terms')) return params[2] === 'school-test-a' ? [{ id: params[0] }] : [];
      if (sql.includes('FROM budgets')) return storage.budgets.filter((row) => row.school_id === params[0] && (!sql.includes('id=?') || row.id === params[1]));
      if (sql.includes('FROM budget_items')) return storage.items.filter((row) => row.school_id === params[0] && row.budget_id === params[1] && (!sql.includes('AND id=?') || row.id === params[2]));
      if (sql.includes('FROM general_income')) return this._select('income', sql, params);
      if (sql.includes('FROM general_expenses')) return this._select('expenses', sql, params);
      return [];
    },
    _select(kind, sql, params) {
      let result = rows(kind).filter((row) => row.school_id === params[0]); let index = 1;
      if (sql.includes('AND id=?')) result = result.filter((row) => row.id === params[index++]);
      else { for (const field of ['academic_year','term',kind === 'income' ? 'income_category' : 'expense_category','payment_method','status']) if (sql.includes(`${field}=?`)) result = result.filter((row) => row[field] === params[index++]); if (sql.includes('transaction_date>=?')) result = result.filter((row) => row.transaction_date >= params[index++]); if (sql.includes('transaction_date<=?')) result = result.filter((row) => row.transaction_date <= params[index++]); if (sql.includes('reference_number=?')) result = result.filter((row) => row.reference_number === params[index++]); }
      return result;
    },
    async execute(sql, params = []) {
      if (sql.includes('financial_audit_history')) { this.storage.audit.push({ sql, params }); return { affectedRows: 1 }; }
      if (sql.startsWith('INSERT INTO general_income')) { const [id,school_id,transaction_date,academic_year,term,income_category,custom_category,description,reference_number,amount,payment_method,payer_or_source,notes,status,created_by,created_at,updated_by,updated_at] = params; storage.income.push({ id,school_id,transaction_date,academic_year,term,income_category,custom_category,description,reference_number,amount,payment_method,payer_or_source,notes,status,created_by,created_at,updated_by,updated_at }); }
      if (sql.startsWith('INSERT INTO general_expenses')) { const [id,school_id,transaction_date,academic_year,term,expense_category,custom_category,description,reference_number,amount,payment_method,payee,notes,status,budget_id,budget_item_id,created_by,created_at,updated_by,updated_at] = params; storage.expenses.push({ id,school_id,transaction_date,academic_year,term,expense_category,custom_category,description,reference_number,amount,payment_method,payee,notes,status,budget_id,budget_item_id,created_by,created_at,updated_by,updated_at }); }
      if (sql.startsWith('UPDATE general_income SET description')) { const row = storage.income.find((item) => item.id === params[6] && item.school_id === params[5]); Object.assign(row, { description: params[0], notes: params[1], payer_or_source: params[2], updated_by: params[3], updated_at: params[4] }); }
      if (sql.startsWith('UPDATE general_expenses SET description')) { const row = storage.expenses.find((item) => item.id === params[6] && item.school_id === params[5]); Object.assign(row, { description: params[0], notes: params[1], payee: params[2], updated_by: params[3], updated_at: params[4] }); }
      if (sql.startsWith('UPDATE general_income SET status')) { const row = storage.income.find((item) => item.id === params[6] && item.school_id === params[5]); Object.assign(row, { status:'VOIDED', voided_by:params[0], voided_at:params[1], void_reason:params[2], updated_by:params[3], updated_at:params[4] }); }
      if (sql.startsWith('UPDATE general_expenses SET status')) { const row = storage.expenses.find((item) => item.id === params[6] && item.school_id === params[5]); Object.assign(row, { status:'VOIDED', voided_by:params[0], voided_at:params[1], void_reason:params[2], updated_by:params[3], updated_at:params[4] }); }
      return { affectedRows: 1 };
    },
    async transaction(work) { return work(this); }
  };
}
const accountant = { id:'accountant-a', roleKey:'ACCOUNTANT_BURSAR', schoolId:'school-test-a', permissions:new Set(['income.read','income.create','income.update','expenses.read','expenses.create','expenses.update']) };
const proprietor = { id:'proprietor-a', roleKey:'PROPRIETOR', schoolId:'school-test-a', permissions:new Set(['*']) };
const baseIncome = { transactionDate:'2026-01-15', academicYear:'2026', term:'TERM1', category:'Other', customCategory:'Community Donation', description:'Donation for library', referenceNumber:'INC-001', amount:'1250.50', paymentMethod:'BANK', payerOrSource:'Alumni Association', notes:'Restricted to library' };
const baseExpense = { transactionDate:'2026-01-16', academicYear:'2026', term:'TERM1', category:'Utilities', description:'Electricity', referenceNumber:'EXP-001', amount:'300.25', paymentMethod:'BANK', payee:'Power Company', budgetId:'budget-a', budgetItemId:'item-a' };

test('durable income supports create, retrieve, filter, custom category, update, idempotency, void, and audit', async () => {
  const db = adapter(); const audit = []; const service = createGeneralFinanceService({ adapter: db, audit: (event) => audit.push(event), now: () => '2026-02-01T00:00:00.000Z' });
  const created = await service.income.create(baseIncome, accountant); assert.equal(created.amount, 1250.5); assert.equal(created.customCategory, 'Community Donation'); assert.equal(db.storage.income.length, 1); assert.equal(db.storage.audit.length, 1);
  assert.equal((await service.income.get(created.id, accountant)).referenceNumber, 'INC-001'); assert.equal((await service.income.list({ academicYear:'2026', term:'TERM1', category:'Other', search:'Alumni' }, accountant)).length, 1);
  await assert.rejects(() => service.income.create({ ...baseIncome, amount:'-1', referenceNumber:'INC-002' }, accountant), (error) => error.code === 'INVALID_TRANSACTION_AMOUNT');
  await assert.rejects(() => service.income.create({ ...baseIncome, amount:'0', referenceNumber:'INC-003' }, accountant), (error) => error.code === 'INVALID_TRANSACTION_AMOUNT');
  await assert.rejects(() => service.income.create({ ...baseIncome, amount:'1.234', referenceNumber:'INC-004' }, accountant), (error) => error.code === 'INVALID_TRANSACTION_AMOUNT');
  await assert.rejects(() => service.income.create(baseIncome, accountant), (error) => error.code === 'DUPLICATE_REFERENCE');
  const updated = await service.income.update(created.id, { description:'Updated donation', payerOrSource:'Alumni Association' }, accountant); assert.equal(updated.description, 'Updated donation');
  const voided = await service.income.void(created.id, 'Correction', proprietor); assert.equal(voided.status, 'VOIDED'); assert.equal((await service.income.list({ status:'POSTED' }, accountant)).length, 0); assert.ok(audit.some((event) => event.action === 'INCOME_VOIDED'));
});

test('durable expense supports budget linkage and rejects invalid/cross-school relationships', async () => {
  const db = adapter(); const service = createGeneralFinanceService({ adapter: db }); const created = await service.expenses.create(baseExpense, accountant); assert.equal(created.budgetId, 'budget-a'); assert.equal(created.budgetItemId, 'item-a'); assert.equal((await service.expenses.list({ category:'Utilities', search:'Power' }, accountant)).length, 1);
  await assert.rejects(() => service.expenses.create({ ...baseExpense, referenceNumber:'EXP-002', budgetId:'missing', budgetItemId:'item-a' }, accountant), (error) => error.code === 'INVALID_BUDGET_LINK');
  await assert.rejects(() => service.expenses.create({ ...baseExpense, referenceNumber:'EXP-003', budgetId:'budget-a', budgetItemId:'missing' }, accountant), (error) => error.code === 'INVALID_BUDGET_LINK');
  await assert.rejects(() => service.expenses.create({ ...baseExpense, referenceNumber:'EXP-004', schoolId:'school-test-b' }, accountant), /Cross-school/);
  await assert.rejects(() => service.expenses.void(created.id, 'No permission', accountant), (error) => error.status === 403);
  const voided = await service.expenses.void(created.id, 'Correction', proprietor); assert.equal(voided.status, 'VOIDED'); assert.equal((await service.expenses.list({ status:'POSTED' }, proprietor)).length, 0);
});

test('financial reporting includes durable general transactions once and excludes voided records', async () => {
  const db = adapter(); const service = createGeneralFinanceService({ adapter: db }); await service.income.create(baseIncome, accountant); await service.expenses.create(baseExpense, accountant); const report = await createReportingService({ schoolId:'school-test-a' }).buildFinancialReportAsync({ academicYear:'2026', term:'TERM1' }, proprietor, { generalFinance:service, fees:{ listInvoices:() => [], listPayments:() => [] } }); assert.equal(report.summary.totalIncome, 1250.5); assert.equal(report.summary.totalExpenses, 300.25); assert.equal(report.incomeTransactions.length, 1); assert.equal(report.expenseTransactions.length, 1);
});

function httpRequestFor(port, path, { method='GET', token, body }={}) { return new Promise((resolve, reject) => { const headers = { Authorization:`Bearer ${token}` }; if (body) headers['Content-Type']='application/json'; const req=httpRequest({ port, path, method, headers }, (res) => { let raw=''; res.on('data',(chunk)=>{raw+=chunk;}); res.on('end',()=>resolve({ status:res.statusCode, body:raw?JSON.parse(raw):null })); }); req.on('error',reject); if (body) req.write(JSON.stringify(body)); req.end(); }); }

test('authenticated APIs enforce persistence, RBAC, school scope, and fee boundary', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const db = adapter(); const app = createApp({ auth:fixture.auth, database:db }); const server=createServer(app); await new Promise((resolve)=>server.listen(0,resolve)); try { const port=server.address().port; const created=await httpRequestFor(port,'/api/finance/income',{method:'POST',token:fixture.accountantToken,body:baseIncome}); assert.equal(created.status,201); const listed=await httpRequestFor(port,'/api/finance/income?category=Other',{token:fixture.accountantToken}); assert.equal(listed.status,200); assert.equal(listed.body.transactions.length,1); const teacher=await httpRequestFor(port,'/api/finance/income',{token:fixture.teacherToken}); assert.equal(teacher.status,403); const unauth=await httpRequestFor(port,'/api/finance/expenses'); assert.equal(unauth.status,401); const feeBoundary=await httpRequestFor(port,'/api/finance/income',{method:'POST',token:fixture.accountantToken,body:{...baseIncome,referenceNumber:'INC-FEE',category:'School Fees'}}); assert.equal(feeBoundary.status,400); } finally { await new Promise((resolve)=>server.close(resolve)); }
});
