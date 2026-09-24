import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createBudgetService } from '../src/budgets.js';
import { createApp } from '../src/server.mjs';
import { createServer } from 'node:http';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';

function createBudgetAdapter() {
  const storage = { budgets: [], items: [], statements: [] };
  return {
    storage,
    async query(sql, params = []) {
      if (sql.includes('FROM academic_years')) return params[1] === 'school-test-a' ? [{ id: params[0] }] : [];
      if (sql.includes('FROM terms')) return params[2] === 'school-test-a' ? [{ id: params[0] }] : [];
      if (sql.includes('FROM budgets')) { let result = storage.budgets.filter((row) => row.school_id === params[0]); if (sql.includes('AND id=?')) result = result.filter((row) => row.id === params[1]); else { if (sql.includes('academic_year=?')) result = result.filter((row) => row.academic_year === params[1]); if (sql.includes('term=?')) result = result.filter((row) => row.term === params[sql.includes('academic_year=?') ? 2 : 1]); if (sql.includes('status=?')) result = result.filter((row) => row.status === params[sql.includes('academic_year=?') && sql.includes('term=?') ? 3 : 2]); } return result; }
      if (sql.includes('FROM budget_items')) return storage.items.filter((row) => row.school_id === params[0] && row.budget_id === params[1]);
      if (sql.includes('fee_collection_records')) return [];
      return [];
    },
    async execute(sql, params = []) {
      storage.statements.push(sql);
      if (sql.startsWith('INSERT INTO budgets')) storage.budgets.push({ id: params[0], school_id: params[1], academic_year: params[2], term: params[3], budget_name: params[4], description: params[5], status: params[6], total_budget_amount: params[7], created_by: params[8], created_at: params[9], updated_by: params[10], updated_at: params[11] });
      if (sql.startsWith('INSERT INTO budget_items')) storage.items.push({ id: params[0], budget_id: params[1], school_id: params[2], category: params[3], custom_category: params[4], description: params[5], allocated_amount: params[6], created_at: params[7], updated_at: params[8] });
      if (sql.startsWith('UPDATE budgets SET academic_year')) { const row = storage.budgets.find((item) => item.id === params[8] && item.school_id === params[7]); Object.assign(row, { academic_year: params[0], term: params[1], budget_name: params[2], description: params[3], total_budget_amount: params[4], updated_by: params[5], updated_at: params[6] }); }
      if (sql.startsWith('UPDATE budgets SET status')) { const row = storage.budgets.find((item) => item.id === params[4] && item.school_id === params[3]); Object.assign(row, { status: params[0], updated_by: params[1], updated_at: params[2] }); }
      if (sql.startsWith('DELETE FROM budget_items')) { storage.items = storage.items.filter((item) => !(item.school_id === params[0] && item.budget_id === params[1])); }
      return { affectedRows: 1 };
    },
    async transaction(work) { return work(this); }
  };
}

const accountant = { id: 'accountant-a', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-test-a', permissions: new Set(['budgets.read', 'budgets.write', 'budgets.update']) };
const proprietor = { id: 'proprietor-a', roleKey: 'PROPRIETOR', schoolId: 'school-test-a', permissions: new Set(['*']) };
const teacher = { id: 'teacher-a', roleKey: 'TEACHER', schoolId: 'school-test-a', permissions: new Set() };
const input = { schoolId: 'school-test-a', academicYear: '2026', term: 'TERM1', budgetName: '2026 Teaching Plan', description: 'Annual teaching allocation', items: [{ category: 'Teaching & Learning Materials', description: 'Books', allocatedAmount: '1000.25' }, { category: 'Other', customCategory: 'Community Outreach', description: 'Outreach', allocatedAmount: '250.50' }] };

test('budget service creates multiple lines and calculates totals server-side', async () => {
  const adapter = createBudgetAdapter(); const audit = []; const service = createBudgetService({ adapter, audit: (event) => audit.push(event) });
  const budget = await service.create(input, accountant);
  assert.equal(budget.items.length, 2);
  assert.equal(budget.totalBudgetAmount, 1250.75);
  assert.equal(budget.amountUtilized, 0);
  assert.equal(budget.remainingAmount, 1250.75);
  assert.equal(budget.items[1].customCategory, 'Community Outreach');
  assert.equal(audit[0].action, 'BUDGET_CREATED');
  assert.equal(adapter.storage.budgets[0].status, 'DRAFT');
  assert.ok(adapter.storage.statements.some((sql) => sql.includes('financial_audit_history')));
  assert.deepEqual(await service.list({ search: 'does-not-exist' }, accountant), []);
  await assert.rejects(() => service.create(input, teacher), (error) => error.status === 403);
});

test('canonical Budgets route is server-backed and exposes controlled UI states', async () => {
  const source = await readFile(new URL('../public/finance-canonical.html', import.meta.url), 'utf8');
  assert.match(source, /'\/finance\/budgets': \{[^}]*loader:'budgets'/);
  assert.match(source, /\/api\/finance\/budgets/);
  assert.match(source, /data-budget-form/);
  assert.match(source, /data-budget-detail/);
  assert.match(source, /data-budget-action/);
  assert.match(source, /data-state=\"\$\{type \|\| 'info'\}\"/);
});

test('budget service validates amounts, categories, periods, and draft updates', async () => {
  const adapter = createBudgetAdapter(); const service = createBudgetService({ adapter });
  await assert.rejects(() => service.create({ ...input, items: [{ category: 'Utilities', allocatedAmount: '-1' }] }, accountant), (error) => error.code === 'INVALID_BUDGET_AMOUNT');
  await assert.rejects(() => service.create({ ...input, items: [{ category: 'Not Controlled', allocatedAmount: '1' }] }, accountant), (error) => error.code === 'INVALID_BUDGET_CATEGORY');
  const budget = await service.create(input, accountant);
  const updated = await service.update(budget.id, { ...input, budgetName: 'Updated Plan', items: [{ category: 'Utilities', allocatedAmount: '10.00' }] }, accountant);
  assert.equal(updated.budgetName, 'Updated Plan');
  assert.equal(updated.totalBudgetAmount, 10);
});

test('budget workflow preserves accountant/proprietor least privilege and invalid transitions fail', async () => {
  const adapter = createBudgetAdapter(); const audit = []; const service = createBudgetService({ adapter, audit: (event) => audit.push(event) });
  const budget = await service.create(input, accountant);
  await service.transition(budget.id, 'SUBMITTED', accountant);
  await assert.rejects(() => service.transition(budget.id, 'APPROVED', accountant), /approval permission/);
  const approved = await service.transition(budget.id, 'APPROVED', proprietor);
  assert.equal(approved.status, 'APPROVED');
  await assert.rejects(() => service.transition(budget.id, 'SUBMITTED', proprietor), (error) => error.code === 'INVALID_BUDGET_TRANSITION');
  assert.deepEqual(audit.map((event) => event.action), ['BUDGET_CREATED', 'BUDGET_SUBMITTED', 'BUDGET_APPROVED']);
});

test('budget service rejects cross-school ID access', async () => {
  const adapter = createBudgetAdapter(); const service = createBudgetService({ adapter }); const budget = await service.create(input, accountant);
  assert.equal(await service.get(budget.id, { ...accountant, schoolId: 'school-test-b' }), null);
  await assert.rejects(() => service.update(budget.id, { ...input, schoolId: 'school-test-b' }, { ...accountant, schoolId: 'school-test-b' }), /Cross-school|not found/);
});

function request(port, path, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    const req = httpRequest({ port, path, method, headers }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

test('budget HTTP API supports create, list, details, filters, and RBAC', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const database = createBudgetAdapter(); const app = createApp({ auth: fixture.auth, database }); const server = createServer(app); await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    const created = await request(port, '/api/finance/budgets', { method: 'POST', token: fixture.accountantToken, body: input });
    assert.equal(created.status, 201); assert.equal(created.body.totalBudgetAmount, 1250.75);
    const list = await request(port, '/api/finance/budgets?academicYear=2026&term=TERM1&status=DRAFT', { token: fixture.accountantToken });
    assert.equal(list.status, 200); assert.equal(list.body.budgets.length, 1);
    const filtered = await request(port, '/api/finance/budgets?category=Other&search=Teaching', { token: fixture.accountantToken });
    assert.equal(filtered.status, 200); assert.equal(filtered.body.budgets.length, 1);
    const detail = await request(port, `/api/finance/budgets/${created.body.id}`, { token: fixture.accountantToken });
    assert.equal(detail.status, 200); assert.equal(detail.body.items.length, 2);
    const teacher = await request(port, '/api/finance/budgets', { token: fixture.teacherToken });
    assert.equal(teacher.status, 403);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
