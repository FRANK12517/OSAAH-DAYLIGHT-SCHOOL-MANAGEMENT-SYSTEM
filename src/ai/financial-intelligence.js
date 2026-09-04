import { createAIDataQualityGuard } from './data-quality-guard.js';
import { createProductionDataGuard } from './production-data-guard.js';

export const FINANCIAL_DASHBOARD_ROLES = Object.freeze(['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR']);
const VALID = new Set(['VALID', 'ISSUED', 'PART_PAID', 'PAID']);
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100);
const amount = (pesewas) => pesewas / 100;
const sum = (records, field = 'amount') => records.reduce((total, record) => total + money(record[field]), 0);
const periodMatches = (record, period) => (!period.academicYearId || record.academicYearId === period.academicYearId) && (!period.termId || record.termId === period.termId);
const latest = (records) => records.map((record) => record.changedAt ?? record.createdAt ?? record.publishedAt).filter(Boolean).sort().at(-1) ?? null;

function authorize(actor) {
  if (!actor?.id || !actor?.schoolId || !(actor.permissions instanceof Set)) throw Object.assign(new Error('Authentication is required.'), { code: 'UNAUTHENTICATED', status: 401 });
  if (!FINANCIAL_DASHBOARD_ROLES.includes(actor.roleKey) || !(actor.permissions.has('*') || actor.permissions.has('finance.read'))) throw Object.assign(new Error('Financial intelligence is unavailable for this role.'), { code: 'PERMISSION_DENIED', status: 403 });
}
function dataSources(fees) {
  const sources = {}; const unavailable = [];
  for (const [name, method] of Object.entries({ invoices: 'listInvoices', payments: 'listPayments', expenses: 'listExpenses', incomes: 'listIncomes' })) {
    try { const records = fees[method]?.(); if (!Array.isArray(records)) throw new Error('unavailable'); sources[name] = records; } catch { sources[name] = []; unavailable.push(name); }
  }
  return { sources, unavailable };
}
function publicSnapshot(snapshot) { const { revision, ...safe } = snapshot; return safe; }

export function createFinancialIntelligenceService({ fees, productionDataGuard = createProductionDataGuard({ environment: process.env.NODE_ENV }), dataQualityGuard = createAIDataQualityGuard(), schoolContextService = null, explain = null, now = () => new Date().toISOString() } = {}) {
  if (!fees) throw new Error('Financial intelligence requires the existing Fee Hub service.');
  let narrationCache = new Map();
  fees.subscribe?.(() => { narrationCache = new Map(); });
  async function reportingPeriod(actor, requested = {}) {
    if (requested.academicYearId || requested.termId) return { academicYearId: requested.academicYearId ?? null, termId: requested.termId ?? null, source: 'AUTHORIZED_SELECTION' };
    if (!schoolContextService) return { academicYearId: null, termId: null, source: 'CURRENT_AVAILABLE_RECORDS' };
    const context = await schoolContextService.generate({ authenticatedUser: actor, type: 'FINANCIAL' });
    return { academicYearId: context.academicYear?.id ?? null, termId: context.term?.id ?? null, source: 'SCHOOL_CONTEXT' };
  }
  async function snapshot({ actor, academicYearId = null, termId = null, includeExplanation = true } = {}) {
    authorize(actor); const generatedAt = now(); const period = await reportingPeriod(actor, { academicYearId, termId }); const loaded = dataSources(fees), sources = loaded.sources; const warnings = loaded.unavailable.map((name) => `${name.toUpperCase()}_SOURCE_UNAVAILABLE`); const guarded = {};
    for (const [name, records] of Object.entries(sources)) { guarded[name] = productionDataGuard.sanitize(records.filter((record) => record.schoolId === actor.schoolId), { productionOnly: true }); if (guarded[name].diagnostics.excludedCount) warnings.push(`${name.toUpperCase()}_NON_PRODUCTION_EXCLUDED`); }
    const scoped = Object.fromEntries(Object.entries(guarded).map(([name, result]) => [name, result.records.filter((record) => periodMatches(record, period))]));
    const unassigned = period.academicYearId || period.termId ? Object.values(guarded).flatMap((result) => result.records).filter((record) => !record.academicYearId || !record.termId).length : 0;
    if (unassigned) warnings.push('Some financial records have no complete reporting-period assignment and were not included.');
    const invoices = scoped.invoices.filter((record) => VALID.has(record.status)); const validPayments = scoped.payments.filter((record) => record.status === 'VALID'); const refunds = scoped.payments.filter((record) => record.status === 'REFUNDED'); const expenses = scoped.expenses.filter((record) => record.status === 'VALID'); const incomes = scoped.incomes.filter((record) => record.status === 'VALID' && !record.invoiceNumber && !record.receiptNumber);
    const expected = sum(invoices, 'total'); const collected = sum(validPayments); const expenseTotal = sum(expenses); const otherIncome = sum(incomes); const refundTotal = sum(refunds); const discountTotal = sum(invoices, 'discount'); const paidByInvoice = new Map(); for (const payment of validPayments) paidByInvoice.set(payment.invoiceNumber, (paidByInvoice.get(payment.invoiceNumber) ?? 0) + money(payment.amount));
    const outstanding = invoices.reduce((total, invoice) => total + Math.max(0, money(invoice.total) - (paidByInvoice.get(invoice.invoiceNumber) ?? 0)), 0); const today = generatedAt.slice(0, 10); const student = new Map(); for (const invoice of invoices) { const state = student.get(invoice.studentId) ?? { expected: 0, paid: 0 }; state.expected += money(invoice.total); state.paid += paidByInvoice.get(invoice.invoiceNumber) ?? 0; student.set(invoice.studentId, state); }
    const states = [...student.values()]; const sourceCount = Object.values(scoped).reduce((total, records) => total + records.length, 0); const excludedCount = Object.values(guarded).reduce((total, result) => total + result.diagnostics.excludedCount, 0); const sourceAvailable = loaded.unavailable.length === 0; const lastUpdatedAt = latest(Object.values(scoped).flat());
    const assessment = await dataQualityGuard.assess({ validated: true, valid: true, sourceAvailable, sourceCount, missingCount: excludedCount + unassigned, lastUpdatedAt, assessedAt: generatedAt, reportingPeriod: period, warnings });
    const metrics = Object.freeze({ expectedRevenue: amount(expected), totalCollected: amount(collected), outstanding: amount(outstanding), collectionRate: expected ? Math.round(collected / expected * 10000) / 100 : null, totalExpenses: amount(expenseTotal), otherIncome: amount(otherIncome), refunds: amount(refundTotal), adjustments: amount(discountTotal), netFinancialPosition: assessment.quality.verifiedComplete ? amount(collected + otherIncome - expenseTotal) : null, collectionsToday: amount(sum(validPayments.filter((record) => record.createdAt?.slice(0, 10) === today))), expensesToday: amount(sum(expenses.filter((record) => (record.date ?? record.createdAt)?.slice(0, 10) === today))), fullyPaidStudents: states.filter((state) => state.expected > 0 && state.paid >= state.expected).length, partiallyPaidStudents: states.filter((state) => state.paid > 0 && state.paid < state.expected).length, unpaidStudents: states.filter((state) => state.expected > 0 && state.paid === 0).length });
    const base = { reportingPeriod: period, metrics, sourceCounts: Object.freeze({ invoices: invoices.length, payments: validPayments.length, expenses: expenses.length, incomes: incomes.length, refunds: refunds.length, excluded: excludedCount }), generatedAt, dataQuality: assessment.quality, warnings: assessment.quality.warnings, revision: fees.revision?.() ?? 0 };
    let explanation = null; if (includeExplanation && explain) { const key = JSON.stringify([base.revision, period.academicYearId, period.termId, assessment.quality.status]); if (!narrationCache.has(key)) { try { narrationCache.set(key, await explain(publicSnapshot(base))); } catch { narrationCache.set(key, null); } } explanation = narrationCache.get(key); }
    return Object.freeze({ ...publicSnapshot(base), explanation });
  }
  async function compare({ actor, periods } = {}) { authorize(actor); if (!Array.isArray(periods) || periods.length !== 2) throw Object.assign(new Error('Exactly two reporting periods are required.'), { code: 'INVALID_REQUEST', status: 400 }); const snapshots = await Promise.all(periods.map((period) => snapshot({ actor, ...period, includeExplanation: false }))); return Object.freeze({ periods: snapshots, change: Object.freeze(Object.fromEntries(Object.keys(snapshots[0].metrics).filter((key) => typeof snapshots[0].metrics[key] === 'number' && typeof snapshots[1].metrics[key] === 'number').map((key) => [key, Math.round((snapshots[1].metrics[key] - snapshots[0].metrics[key]) * 100) / 100]))) }); }
  return Object.freeze({ snapshot, compare, allowedRoles: FINANCIAL_DASHBOARD_ROLES });
}

const metricProperties = Object.fromEntries(['expectedRevenue', 'totalCollected', 'outstanding', 'collectionRate', 'totalExpenses', 'otherIncome', 'refunds', 'adjustments', 'netFinancialPosition', 'collectionsToday', 'expensesToday', 'fullyPaidStudents', 'partiallyPaidStudents', 'unpaidStudents'].map((key) => [key, { type: ['number', 'null'] }]));
const snapshotSchema = { type: 'object', properties: { reportingPeriod: { type: 'object', properties: { academicYearId: { type: ['string', 'null'] }, termId: { type: ['string', 'null'] }, source: { type: 'string' } } }, metrics: { type: 'object', properties: metricProperties }, generatedAt: { type: 'string' }, dataQuality: { type: 'object', properties: { status: { type: 'string' }, verifiedComplete: { type: 'boolean' }, completenessPercent: { type: ['number', 'null'] }, warnings: { type: 'array', items: { type: 'string' } } } }, warnings: { type: 'array', items: { type: 'string' } }, provenance: { type: 'string' } } };
export function createFinancialIntelligenceTools(service) {
  const inputSchema = { type: 'object', properties: { schoolId: { type: 'string' }, academicYearId: { type: 'string' }, termId: { type: 'string' } }, additionalProperties: false };
  const definition = (name, operationType, select = (value) => value) => ({ name, capabilityId: 'finance', description: `Verified ${name.replace('finance.', '').replace('-', ' ')} financial intelligence.`, operationType, requiredPermission: 'finance.read', inputSchema, outputSchema: { type: 'object', properties: { records: { type: 'array', items: snapshotSchema } } }, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true, handler: async ({ input, authorization }) => ({ records: [{ ...select(await service.snapshot({ actor: { id: authorization.context.userId, schoolId: authorization.context.schoolId, roleKey: authorization.context.role, portal: authorization.context.portal, permissions: new Set(authorization.context.permissions) }, academicYearId: input.academicYearId, termId: input.termId, includeExplanation: false })), provenance: 'PRODUCTION' }] }) });
  const periodComparison = {
    name: 'finance.period-comparison', capabilityId: 'finance', description: 'Compare two verified financial reporting periods.', operationType: 'ANALYZE', requiredPermission: 'finance.read',
    inputSchema: { type: 'object', properties: { schoolId: { type: 'string' }, periods: { type: 'array', items: { type: 'object', properties: { academicYearId: { type: 'string' }, termId: { type: 'string' } } }, minItems: 2, maxItems: 2 } }, required: ['periods'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { records: { type: 'array', items: { type: 'object', properties: { comparison: { type: 'object', properties: { periods: { type: 'array', items: snapshotSchema }, change: { type: 'object', properties: metricProperties } } }, provenance: { type: 'string' } } } } } },
    productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true,
    handler: async ({ input, authorization }) => ({ records: [{ comparison: await service.compare({ actor: { id: authorization.context.userId, schoolId: authorization.context.schoolId, roleKey: authorization.context.role, portal: authorization.context.portal, permissions: new Set(authorization.context.permissions) }, periods: input.periods }), provenance: 'PRODUCTION' }] })
  };
  return Object.freeze([definition('finance.status', 'READ'), definition('finance.collections', 'ANALYZE', (snapshot) => ({ reportingPeriod: snapshot.reportingPeriod, metrics: snapshot.metrics, generatedAt: snapshot.generatedAt, dataQuality: snapshot.dataQuality, warnings: snapshot.warnings })), definition('finance.outstanding', 'ANALYZE'), definition('finance.expenses', 'ANALYZE'), periodComparison]);
}
