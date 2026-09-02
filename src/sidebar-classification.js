import { SIDEBAR_CATEGORY_REGISTRY, SIDEBAR_MODULES, registerModule, suggestedRolesForCategory } from './sidebar-registry.js';

const CATEGORY_BY_ID = new Map(SIDEBAR_CATEGORY_REGISTRY.map((category) => [category.categoryId, category]));
const CLASSIFICATION_RULES = [
  ['LIBRARY MANAGEMENT', ['book', 'borrow', 'return', 'library', 'catalogue', 'fine']],
  ['TRANSPORT MANAGEMENT', ['vehicle', 'bus', 'driver', 'route', 'stop', 'transport', 'trip']],
  ['HOSTEL MANAGEMENT', ['boarding', 'dormitory', 'dorm', 'hostel', 'house', 'bed', 'boarder']],
  ['HEALTH & WELFARE', ['health', 'medical', 'sick bay', 'welfare', 'discipline', 'counselling', 'safeguard', 'wellbeing']],
  ['INVENTORY & STORES', ['stock', 'store', 'consumable', 'inventory']],
  ['ASSETS & PROPERTY', ['asset', 'building', 'furniture', 'facility', 'maintenance', 'property']],
  ['PROCUREMENT', ['purchase request', 'quotation', 'purchase order', 'goods received', 'procurement']],
  ['COMPLIANCE & DOCUMENTS', ['nasia', 'ntc compliance', 'fire certificate', 'inspection', 'emis', 'census', 'regulatory', 'compliance', 'document repository']],
  ['ATTENDANCE MANAGEMENT', ['attendance', 'late', 'lateness', 'absence', 'register', 'biometric', 'qr attendance']],
  ['EXAMINATIONS & RESULTS', ['examination', 'exam', 'test', 'mark', 'grade', 'broadsheet', 'result', 'transcript', 'report card']],
  ['FEE HUB', ['school fee', 'fee structure', 'student charge', 'invoice', 'payment', 'receipt', 'arrear', 'discount', 'scholarship', 'fee statement', 'refund', 'payment plan']],
  ['FINANCE', ['accounting', 'income', 'expenditure', 'cashbook', 'budget', 'financial', 'reconciliation', 'general ledger', 'salary payment']],
  ['STAFF MANAGEMENT', ['staff', 'teacher', 'employee', 'human resource', 'hr', 'qualification', 'ntc record', 'leave', 'appraisal', 'contract', 'payroll']],
  ['COMMUNICATION HUB', ['announcement', 'messaging', 'message', 'sms', 'email', 'notification', 'parent communication', 'broadcast', 'chat']],
  ['ADMISSIONS', ['enquiry', 'enquiry', 'application', 'applicant', 'admission', 'interview', 'admission offer', 'enrollment pipeline']],
  ['STUDENTS MANAGEMENT', ['student directory', 'student profile', 'student id', 'student record', 'student transfer', 'student withdrawal', 'alumni', 'student enrollment']],
  ['ACADEMICS', ['curriculum', 'subject', 'class', 'stream', 'lesson', 'scheme', 'assignment', 'homework', 'timetable', 'academic', 'mock examination']],
  ['REPORTS & ANALYTICS', ['management report', 'dashboard', 'analytics', 'performance report', 'data visualization', 'statistics']],
  ['SYSTEM & SECURITY', ['user', 'role', 'permission', 'audit log', 'session', 'security', 'backup', 'privacy', 'integration']],
  ['ADMINISTRATIVE', ['school profile', 'school setting', 'calendar', 'configuration', 'official document', 'administration']]
];
const SPECIAL_CASES = [['staff salary', 'FINANCE'], ['salary payment', 'FINANCE'], ['transport fee', 'FEE HUB'], ['fee collection', 'FEE HUB'], ['academic transcript', 'EXAMINATIONS & RESULTS'], ['academic performance analytics', 'REPORTS & ANALYTICS'], ['student medical', 'HEALTH & WELFARE']];

const normalized = (value) => String(value ?? '').toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim();
function categoryByName(name) { return SIDEBAR_CATEGORY_REGISTRY.find((category) => category.categoryName === name); }
function categoryFromInput(value) { return CATEGORY_BY_ID.get(value) ?? categoryByName(value); }
function scoreCategory(source, categoryName) { return CLASSIFICATION_RULES.find(([name]) => name === categoryName)?.[1].reduce((score, keyword) => score + (source.includes(keyword) ? 1 : 0), 0) ?? 0; }

export function classifyComponent(metadata, { modules = SIDEBAR_MODULES, onDiagnostic = () => {} } = {}) {
  const source = normalized([metadata.moduleKey ?? metadata.moduleId, metadata.moduleName, metadata.featureDomain ?? metadata.feature_domain, metadata.route, metadata.description].filter(Boolean).join(' '));
  const explicitValue = metadata.featureDomain ?? metadata.feature_domain ?? metadata.categoryId ?? metadata.category_id ?? metadata.category;
  const explicit = categoryFromInput(explicitValue);
  if (explicitValue && !explicit) throw new Error(`Invalid sidebar category: ${explicitValue}`);
  const parent = metadata.parentModuleKey ?? metadata.parent_module_key ? modules.find((module) => module.moduleKey === (metadata.parentModuleKey ?? metadata.parent_module_key)) : null;
  const parentCategory = parent && categoryFromInput(parent.categoryId ?? parent.category);
  const candidates = CLASSIFICATION_RULES.map(([categoryName]) => ({ category: categoryByName(categoryName), score: scoreCategory(source, categoryName) })).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  const special = SPECIAL_CASES.find(([phrase]) => source.includes(phrase));
  const selected = explicit ?? parentCategory ?? (special ? categoryByName(special[1]) : candidates[0]?.category) ?? categoryByName('ADMINISTRATIVE');
  const ambiguous = !explicit && !parentCategory && (!candidates.length || candidates.length > 1 && candidates[0].score === candidates[1].score);
  if (ambiguous) onDiagnostic({ type: 'AMBIGUOUS_MODULE_CLASSIFICATION', moduleKey: metadata.moduleKey ?? metadata.moduleId, candidates: candidates.map((candidate) => candidate.category.categoryId) });
  return { ...metadata, category: selected.categoryName, categoryId: selected.categoryId, suggestedRoles: metadata.roles?.length ? [...metadata.roles] : suggestedRolesForCategory(selected.categoryId), classificationSource: explicit ? 'FEATURE_DOMAIN' : parentCategory ? 'PARENT_MODULE' : special ? 'SPECIAL_CASE' : candidates.length ? 'RULES' : 'ADMINISTRATIVE_FALLBACK', classificationWarning: ambiguous && !special ? 'Category requires review.' : null };
}

export function registerComponent(metadata, { modules = SIDEBAR_MODULES, onDiagnostic = () => {}, onDuplicate } = {}) {
  const classified = classifyComponent(metadata, { modules, onDiagnostic });
  if (!classified.moduleKey && !classified.moduleId) throw new Error('Module ID is required');
  if (!classified.route) throw new Error('Module route is required');
  if (classified.roles?.length && !(classified.permissions?.length || classified.requiredPermissions?.length || classified.requiredPermission)) throw new Error('Protected modules require permissions');
  return registerModule({ ...classified, requiredPermissions: classified.permissions ?? classified.requiredPermissions, allowedRoles: classified.roles, mobileVisible: classified.mobileEnabled ?? classified.mobile_enabled, desktopVisible: classified.desktopEnabled ?? classified.desktop_enabled }, modules, { onDuplicate });
}
