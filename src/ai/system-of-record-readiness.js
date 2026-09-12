const TRANSIENT_ONLY = 'TRANSIENT_ONLY';
const NOT_PRODUCTION_READY = 'NOT_PRODUCTION_READY';

// This is deliberately an inventory of the runtime, rather than an inventory of
// schema files.  A migration is not a system of record until a service uses a
// durable repository at runtime.
export const SYSTEM_OF_RECORD_DURABILITY = Object.freeze([
  ['Students', 'src/students.js', 'students, parentLinks', '003, 023', ['academics', 'attendance', 'admissions']],
  ['Parent/student linkage', 'src/students.js', 'parentLinks', '003', ['school-context']],
  ['Academic years, terms, classes, subjects', 'src/subjects.js', 'service-local collections', '001, 007, 020', ['school-context', 'academics']],
  ['Teacher assignments', 'src/staff.js', 'assignments', '009', ['academics', 'attendance']],
  ['Scores and results', 'src/academic-results.js', 'terminal, mocks, publications', '007, 017', ['academics']],
  ['Student and staff attendance', 'src/attendance.js', 'studentRecords, staffRecords', '006', ['attendance']],
  ['Admissions', 'src/admission-form.js, src/students.js', 'applications, admissions', '003, 015', ['admissions']],
  ['Staff and workforce', 'src/staff.js', 'staff, leave, assignments', '009', ['admissions-workforce', 'attendance']],
  ['Fee Hub, payments, expenses and income', 'src/fees.js', 'invoices, payments, expenses, income', '008, 015', ['finance']],
  ['Transport, hostel and welfare operations', 'src/operations.js', 'service-local arrays', '011', ['operations']],
  ['Inventory, assets, procurement and maintenance', 'src/resources.js', 'service-local arrays', '012', ['operations']],
  ['Communication and academic calendar', 'src/communication.js', 'service-local arrays', '010', ['knowledge']],
  ['Official documents', 'src/reporting.js', 'officialDocuments', '014', ['knowledge']],
  ['Admission prospectus', 'src/admission-prospectus.js', 'records', '016', ['knowledge']],
  ['School profile', 'runtime configuration', 'process-local configuration', '001', ['school-context', 'knowledge'], NOT_PRODUCTION_READY],
].map(([domain, module, authoritativeStore, schema, aiCapabilities, classification = TRANSIENT_ONLY]) => Object.freeze({
  domain, module, authoritativeStore, schema, aiCapabilities: Object.freeze(aiCapabilities),
  classification, restartPersistence: false, schoolIsolation: 'service-scoped only; not durable',
  transactionRequirement: 'Required when ported for multi-record workflows.'
})));

export const DURABLE_AI_INFRASTRUCTURE = Object.freeze([
  Object.freeze({ domain: 'AI audit', classification: 'DURABLE_PRODUCTION', module: 'src/ai/durable-stores.js', schema: '018' }),
  Object.freeze({ domain: 'Human-Controlled Actions', classification: 'DURABLE_PRODUCTION', module: 'src/ai/durable-stores.js', schema: '022' })
]);

export function systemOfRecordReadiness() {
  const transientDomains = SYSTEM_OF_RECORD_DURABILITY.map((item) => item.domain);
  return Object.freeze({
    ready: false,
    state: 'UNAVAILABLE',
    code: 'SYSTEM_OF_RECORD_PERSISTENCE_REQUIRED',
    transientDomains: Object.freeze(transientDomains),
    message: 'Production AI requires durable repositories for every authoritative domain it reads.'
  });
}

export function assertProductionAISystemOfRecordReady({ environment = process.env.NODE_ENV ?? 'development', aiEnabled = false } = {}) {
  if (environment !== 'production' || !aiEnabled) return systemOfRecordReadiness();
  const readiness = systemOfRecordReadiness();
  throw Object.assign(new Error(readiness.message), { code: readiness.code, status: 503 });
}
