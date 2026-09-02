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
const SPECIAL_CASES = [['staff salary', 'FINANCE'], ['salary payment', 'FINANCE'], ['transport fee', 'FEE HUB'], ['fee collection', 'FEE HUB'], ['payment reconciliation', 'FINANCE'], ['supplier evaluation', 'PROCUREMENT'], ['parent appointment', 'COMMUNICATION HUB'], ['emergency communication', 'COMMUNICATION HUB'], ['academic transcript', 'EXAMINATIONS & RESULTS'], ['academic performance analytics', 'REPORTS & ANALYTICS'], ['student medical', 'HEALTH & WELFARE']];
const PARENT_KEYS = {
  administrative: ['settings'], students_management: ['student-profiles'], admissions: ['admissions'], academics: ['academics'], attendance_management: ['attendance-dashboard'],
  examinations_results: ['examinations'], fee_hub: ['fee-structure', 'fees'], finance: ['finance-reports', 'finance'], staff_management: ['staff-directory'], communication_hub: ['announcements'],
  library_management: ['library'], transport_management: ['transport'], hostel_management: ['hostel-residences'], health_welfare: ['health-records'], inventory_stores: ['inventory'],
  assets_property: ['assets', 'property'], procurement: ['procurement'], compliance_documents: ['compliance'], reports_analytics: ['reports'], system_security: ['settings', 'users']
};

const normalized = (value) => String(value ?? '').toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim();
function categoryByName(name) { return SIDEBAR_CATEGORY_REGISTRY.find((category) => category.categoryName === name); }
function categoryFromInput(value) { return CATEGORY_BY_ID.get(value) ?? categoryByName(value); }
function scoreCategory(source, categoryName) { return CLASSIFICATION_RULES.find(([name]) => name === categoryName)?.[1].reduce((score, keyword) => score + (source.includes(keyword) ? 1 : 0), 0) ?? 0; }

export function classifyComponent(metadata, { modules = SIDEBAR_MODULES, onDiagnostic = () => {} } = {}) {
  const moduleKey = metadata.moduleKey ?? metadata.module_key ?? metadata.moduleId ?? metadata.module_id;
  const moduleName = metadata.moduleName ?? metadata.module_name;
  const route = metadata.route;
  const featureDomain = metadata.featureDomain ?? metadata.feature_domain;
  const source = normalized([moduleKey, moduleName, featureDomain, route, metadata.description].filter(Boolean).join(' '));
  const explicitValue = featureDomain ?? metadata.categoryId ?? metadata.category_id ?? metadata.category;
  const explicit = categoryFromInput(explicitValue);
  if (explicitValue && !explicit) throw new Error(`Invalid sidebar category: ${explicitValue}`);
  const declaredParent = metadata.parentModuleKey ?? metadata.parent_module_key;
  const parent = declaredParent ? modules.find((module) => (module.moduleKey ?? module.moduleId) === declaredParent) : null;
  const parentCategory = parent && categoryFromInput(parent.categoryId ?? parent.category);
  const candidates = CLASSIFICATION_RULES.map(([categoryName]) => ({ category: categoryByName(categoryName), score: scoreCategory(source, categoryName) })).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  const special = SPECIAL_CASES.find(([phrase]) => source.includes(phrase));
  const selected = explicit ?? parentCategory ?? (special ? categoryByName(special[1]) : candidates[0]?.category) ?? categoryByName('ADMINISTRATIVE');
  const ambiguous = !explicit && !parentCategory && (!candidates.length || candidates.length > 1 && candidates[0].score === candidates[1].score);
  const inferredParent = declaredParent ?? PARENT_KEYS[selected.categoryId]?.find((key) => modules.some((module) => (module.moduleKey ?? module.moduleId) === key)) ?? null;
  const status = ambiguous && !special && !explicit && !parentCategory ? 'UNCLASSIFIED' : 'CLASSIFIED';
  if (ambiguous) onDiagnostic({ type: 'AMBIGUOUS_MODULE_CLASSIFICATION', moduleKey, candidates: candidates.map((candidate) => candidate.category.categoryId) });
  return { ...metadata, moduleKey, moduleName, route, featureDomain, category: selected.categoryName, categoryId: selected.categoryId, parentModuleKey: inferredParent, suggestedRoles: metadata.roles?.length ? [...metadata.roles] : suggestedRolesForCategory(selected.categoryId), classificationStatus: status, classificationSource: explicit ? 'FEATURE_DOMAIN' : parentCategory ? 'PARENT_MODULE' : special ? 'SPECIAL_CASE' : candidates.length ? 'RULES' : 'ADMINISTRATIVE_FALLBACK', classificationWarning: status === 'UNCLASSIFIED' ? 'Category requires authorized review before production publication.' : null };
}

function defaultPermission(moduleKey, metadata) { const permissions = metadata.permissions ?? metadata.requiredPermissions ?? metadata.required_permissions; if (permissions?.length || metadata.requiredPermission) return Array.isArray(permissions) ? permissions : [permissions ?? metadata.requiredPermission]; return [`${moduleKey}.view`]; }
function stablePriority(categoryId, modules, parentModuleKey) { const inCategory = modules.filter((module) => module.categoryId === categoryId || module.category === categoryId); const parent = parentModuleKey && inCategory.find((module) => (module.moduleKey ?? module.moduleId) === parentModuleKey); const siblings = inCategory.filter((module) => (module.parentModule ?? module.parent_module_key ?? null) === parentModuleKey); const baseline = parent ? Number(parent.priority ?? parent.displayOrder ?? 0) : 0; return Math.max(baseline, ...siblings.map((module) => Number(module.priority ?? module.displayOrder ?? 0))) + (parent ? 1 : 10); }

export function registerComponent(metadata, { modules = SIDEBAR_MODULES, onDiagnostic = () => {}, onDuplicate, environment = 'development' } = {}) {
  const classified = classifyComponent(metadata, { modules, onDiagnostic });
  if (!classified.moduleKey && !classified.moduleId) throw new Error('Module ID is required');
  if (!classified.route) throw new Error('Module route is required');
  if (environment === 'production' && classified.classificationStatus === 'UNCLASSIFIED') { onDiagnostic({ type: 'UNCLASSIFIED_MODULE_BLOCKED', moduleKey: classified.moduleKey, candidates: [] }); throw new Error(`Unclassified sidebar module: ${classified.moduleKey}`); }
  const permissions = defaultPermission(classified.moduleKey, classified);
  if (classified.roles?.length && !permissions) throw new Error('Protected modules require permissions');
  return registerModule({ ...classified, requiredPermissions: permissions, allowedRoles: classified.roles, parentModule: classified.parentModuleKey, priority: classified.priority ?? stablePriority(classified.categoryId, modules, classified.parentModuleKey), displayOrder: classified.displayOrder ?? classified.priority ?? stablePriority(classified.categoryId, modules, classified.parentModuleKey), mobileVisible: classified.mobileEnabled ?? classified.mobile_enabled, desktopVisible: classified.desktopEnabled ?? classified.desktop_enabled }, modules, { onDuplicate });
}

export function registerFutureModule(metadata, options = {}) { return registerComponent(metadata, { ...options, environment: options.environment ?? 'production' }); }
