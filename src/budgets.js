import { randomUUID } from 'node:crypto';
import { assertInputSchool, authorizeFinancial, financialAudit } from './financial-authorization.js';

export const BUDGET_STATUSES = Object.freeze(['DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'CLOSED']);
export const BUDGET_CATEGORIES = Object.freeze([
  'Salaries & Wages', 'Teaching & Learning Materials', 'Examination Expenses', 'Utilities',
  'Maintenance & Repairs', 'Transport', 'Feeding/Canteen', 'Boarding/Hostel', 'ICT',
  'Administration', 'Sports', 'Staff Development', 'Infrastructure', 'Security',
  'Health & First Aid', 'Events & Activities', 'Communication', 'Printing & Stationery',
  'Cleaning & Sanitation', 'Other'
]);
const WRITE_ROLES = new Set(['ACCOUNTANT_BURSAR', 'PROPRIETOR', 'SCHOOL_ADMIN']);
const APPROVE_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN']);
const COPY = (value) => structuredClone(value);

function role(actor) { return String(actor?.roleKey ?? '').toUpperCase() === 'ACCOUNTANT' ? 'ACCOUNTANT_BURSAR' : String(actor?.roleKey ?? '').toUpperCase(); }
function requiredText(value, field) { const result = String(value ?? '').trim(); if (!result) throw Object.assign(new Error(`${field} is required.`), { code: 'INVALID_BUDGET' }); return result; }
function amount(value, field = 'Amount') { if (typeof value === 'boolean' || value === '' || value === null || value === undefined || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value).trim())) throw Object.assign(new Error(`${field} must be a non-negative amount with at most two decimal places.`), { code: 'INVALID_BUDGET_AMOUNT' }); const parsed = Number(value); if (!Number.isSafeInteger(Math.round(parsed * 100)) || parsed < 0) throw Object.assign(new Error(`${field} is invalid.`), { code: 'INVALID_BUDGET_AMOUNT' }); return Math.round(parsed * 100) / 100; }
function status(value) { const normalized = String(value ?? 'DRAFT').trim().toUpperCase(); if (!BUDGET_STATUSES.includes(normalized)) throw Object.assign(new Error('Invalid budget status.'), { code: 'INVALID_BUDGET_STATUS' }); return normalized; }

export function createBudgetService({ adapter, audit = () => {}, now = () => new Date().toISOString() } = {}) {
  if (!adapter?.query || !adapter?.execute || !adapter?.transaction) throw new Error('A durable database adapter is required for budgets.');
  const scope = (actor) => { authorizeFinancial(actor, 'READ', 'budgets'); return actor.schoolId; };
  const writable = (actor) => { authorizeFinancial(actor, 'CREATE', 'budgets'); if (!WRITE_ROLES.has(role(actor))) throw Object.assign(new Error('Budget write permission required.'), { status: 403 }); return actor.schoolId; };
  const approver = (actor) => { authorizeFinancial(actor, 'UPDATE', 'budgets'); if (!APPROVE_ROLES.has(role(actor))) throw Object.assign(new Error('Budget approval permission required.'), { status: 403 }); return actor.schoolId; };
  async function persistAudit({ actor, action, entityId, previousValue = null, newValue = null }) { await adapter.execute('INSERT INTO financial_audit_history (id,school_id,entity_type,entity_id,action,previous_values,new_values,changed_by,changed_at,source) VALUES (?,?,?,?,?,?,?,?,?,?)', [randomUUID(), actor.schoolId, 'Budget', entityId, action, previousValue == null ? null : JSON.stringify(previousValue), newValue == null ? null : JSON.stringify(newValue), actor.id, now(), 'MANUAL']); }
  async function validatePeriod(input, actor) {
    const schoolId = actor.schoolId;
    const yearRows = await adapter.query('SELECT id FROM academic_years WHERE id=? AND school_id=?', [input.academicYear, schoolId]);
    if (!yearRows.length) throw Object.assign(new Error('Academic year not found for the authenticated school.'), { code: 'INVALID_ACADEMIC_YEAR' });
    const term = requiredText(input.term, 'Term');
    if (term === 'FULL_YEAR') return { academicYear: input.academicYear, term };
    const termRows = await adapter.query('SELECT t.id FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE t.id=? AND y.id=? AND y.school_id=?', [term, input.academicYear, schoolId]);
    if (!termRows.length) throw Object.assign(new Error('Term not found for the selected academic year.'), { code: 'INVALID_TERM' });
    return { academicYear: input.academicYear, term };
  }
  function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('At least one budget item is required.'), { code: 'INVALID_BUDGET_ITEMS' });
    return items.map((item) => {
      const category = requiredText(item.category, 'Budget category');
      if (!BUDGET_CATEGORIES.includes(category)) throw Object.assign(new Error('Invalid budget category.'), { code: 'INVALID_BUDGET_CATEGORY' });
      const customCategory = category === 'Other' ? requiredText(item.customCategory, 'Specify Category') : null;
      return { category, customCategory, description: String(item.description ?? '').trim() || null, allocatedAmount: amount(item.allocatedAmount, 'Allocated amount') };
    });
  }
  async function getRaw(id, actor) { const schoolId = scope(actor); const rows = await adapter.query('SELECT * FROM budgets WHERE school_id=? AND id=?', [schoolId, id]); return rows[0] ?? null; }
  async function itemsFor(id, actor) { return adapter.query('SELECT * FROM budget_items WHERE school_id=? AND budget_id=? ORDER BY created_at,id', [actor.schoolId, id]); }
  function present(budget, items) {
    const lines = items.map((item) => ({ ...item, customCategory: item.custom_category ?? item.customCategory ?? null, allocatedAmount: Number(item.allocated_amount ?? item.allocatedAmount ?? 0), utilizedAmount: Number(item.utilized_amount ?? item.utilizedAmount ?? 0), remainingAmount: Number(item.remaining_amount ?? item.remainingAmount ?? 0), utilizationPercentage: Number(item.utilization_percentage ?? item.utilizationPercentage ?? 0) }));
    const totalBudget = lines.reduce((sum, item) => sum + item.allocatedAmount, 0);
    const utilized = lines.reduce((sum, item) => sum + item.utilizedAmount, 0);
    return { ...budget, academicYear: budget.academic_year ?? budget.academicYear, term: budget.term, budgetName: budget.budget_name ?? budget.budgetName, totalBudgetAmount: totalBudget, amountUtilized: utilized, remainingAmount: totalBudget - utilized, utilizationPercentage: totalBudget ? Math.round((utilized / totalBudget) * 10000) / 100 : 0, items: lines };
  }
  async function list(input = {}, actor) {
    const schoolId = scope(actor); const filters = []; const params = [schoolId];
    if (input.academicYear) { filters.push('academic_year=?'); params.push(input.academicYear); }
    if (input.term) { filters.push('term=?'); params.push(input.term); }
    if (input.status) { filters.push('status=?'); params.push(status(input.status)); }
    const rows = await adapter.query(`SELECT * FROM budgets WHERE school_id=?${filters.length ? ` AND ${filters.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC`, params);
    const category = String(input.category ?? '').trim(); const search = String(input.search ?? '').trim().toLowerCase(); const result = [];
    for (const row of rows) { const item = present(row, await itemsFor(row.id, actor)); const categoryMatch = !category || item.items.some((line) => line.category === category || line.customCategory === category); const searchMatch = !search || `${item.budgetName} ${item.description ?? ''}`.toLowerCase().includes(search); if (categoryMatch && searchMatch) result.push(item); }
    return result;
  }
  async function get(id, actor) { const row = await getRaw(id, actor); if (!row) return null; return present(row, await itemsFor(id, actor)); }
  async function create(input, actor) {
    const schoolId = writable(actor); assertInputSchool(actor, input); const name = requiredText(input.budgetName, 'Budget name'); const period = await validatePeriod(input, actor); const items = normalizeItems(input.items); const id = randomUUID(); const nowValue = now();
    const total = items.reduce((sum, item) => sum + item.allocatedAmount, 0);
    await adapter.transaction(async (tx) => {
      await tx.execute('INSERT INTO budgets (id,school_id,academic_year,term,budget_name,description,status,total_budget_amount,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, period.academicYear, period.term, name, String(input.description ?? '').trim() || null, 'DRAFT', total, actor.id, nowValue, actor.id, nowValue]);
      for (const item of items) await tx.execute('INSERT INTO budget_items (id,budget_id,school_id,category,custom_category,description,allocated_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [randomUUID(), id, schoolId, item.category, item.customCategory, item.description, item.allocatedAmount, nowValue, nowValue]);
    });
    financialAudit({ audit, actor, action: 'BUDGET_CREATED', entity: 'Budget', entityId: id, transactionReference: id, newValue: { id, schoolId, budgetName: name, totalBudgetAmount: total } });
    await persistAudit({ actor, action: 'BUDGET_CREATED', entityId: id, newValue: { id, schoolId, budgetName: name, totalBudgetAmount: total } });
    return get(id, actor);
  }
  async function update(id, input, actor) {
    const schoolId = writable(actor); assertInputSchool(actor, input); const existing = await getRaw(id, actor); if (!existing) throw Object.assign(new Error('Budget not found.'), { status: 404 }); if (existing.status !== 'DRAFT') throw Object.assign(new Error('Only draft budgets can be edited.'), { code: 'INVALID_BUDGET_STATUS' }); const name = requiredText(input.budgetName ?? existing.budget_name, 'Budget name'); const period = await validatePeriod({ academicYear: input.academicYear ?? existing.academic_year, term: input.term ?? existing.term }, actor); const items = normalizeItems(input.items); const nowValue = now(); const total = items.reduce((sum, item) => sum + item.allocatedAmount, 0);
    await adapter.transaction(async (tx) => { await tx.execute('UPDATE budgets SET academic_year=?,term=?,budget_name=?,description=?,total_budget_amount=?,updated_by=?,updated_at=? WHERE school_id=? AND id=?', [period.academicYear, period.term, name, String(input.description ?? existing.description ?? '').trim() || null, total, actor.id, nowValue, schoolId, id]); await tx.execute('DELETE FROM budget_items WHERE school_id=? AND budget_id=?', [schoolId, id]); for (const item of items) await tx.execute('INSERT INTO budget_items (id,budget_id,school_id,category,custom_category,description,allocated_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [randomUUID(), id, schoolId, item.category, item.customCategory, item.description, item.allocatedAmount, nowValue, nowValue]); });
    financialAudit({ audit, actor, action: 'BUDGET_UPDATED', entity: 'Budget', entityId: id, transactionReference: id, newValue: { id, totalBudgetAmount: total } }); await persistAudit({ actor, action: 'BUDGET_UPDATED', entityId: id, newValue: { id, totalBudgetAmount: total } }); return get(id, actor);
  }
  async function transition(id, target, actor) {
    const schoolId = target === 'SUBMITTED' ? writable(actor) : approver(actor); const existing = await getRaw(id, actor); if (!existing) throw Object.assign(new Error('Budget not found.'), { status: 404 }); const current = String(existing.status).toUpperCase(); const allowed = { DRAFT: ['SUBMITTED'], SUBMITTED: ['APPROVED', 'DRAFT'], APPROVED: ['ACTIVE', 'CLOSED'], ACTIVE: ['CLOSED'] }[current] ?? []; if (!allowed.includes(target)) throw Object.assign(new Error(`Cannot transition budget from ${current} to ${target}.`), { code: 'INVALID_BUDGET_TRANSITION' }); const nowValue = now(); await adapter.execute('UPDATE budgets SET status=?,updated_by=?,updated_at=? WHERE school_id=? AND id=?', [target, actor.id, nowValue, schoolId, id]); financialAudit({ audit, actor, action: `BUDGET_${target}`, entity: 'Budget', entityId: id, transactionReference: id, previousValue: { status: current }, newValue: { status: target } }); await persistAudit({ actor, action: `BUDGET_${target}`, entityId: id, previousValue: { status: current }, newValue: { status: target } }); return get(id, actor);
  }
  return { list, get, create, update, transition, categories: () => [...BUDGET_CATEGORIES], statuses: () => [...BUDGET_STATUSES] };
}
