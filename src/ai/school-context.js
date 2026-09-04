import { createHash } from 'node:crypto';
import { createAIAuthorizationContext, AIAuthorizationError } from './authorization-guard.js';
import { dataQuality } from './contracts.js';
import { SIDEBAR_MODULES } from '../sidebar-registry.js';

export const SCHOOL_CONTEXT_TYPES = Object.freeze(['BASIC_SCHOOL', 'ACADEMIC', 'FINANCIAL', 'ADMISSIONS', 'STAFF', 'OPERATIONS', 'FULL_MANAGEMENT']);
const MANAGEMENT_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']);
const TYPE_PERMISSIONS = Object.freeze({ ACADEMIC: ['academics.read', 'subjects.read', 'children.read'], FINANCIAL: ['finance.read', 'fees.read'], ADMISSIONS: ['admissions.read', 'children.read'], STAFF: ['staff.read'], OPERATIONS: ['transport.read', 'hostel.read', 'attendance.read'], FULL_MANAGEMENT: ['*'] });
const SOURCE_SECTIONS = Object.freeze({
  BASIC_SCHOOL: ['schoolProfile', 'academicYears', 'terms', 'calendarEvents'],
  ACADEMIC: ['schoolProfile', 'academicYears', 'terms', 'calendarEvents', 'classes', 'subjects', 'teacherAssignments', 'assessmentConfig'],
  FINANCIAL: ['schoolProfile', 'academicYears', 'terms', 'feeStructures'],
  ADMISSIONS: ['schoolProfile', 'academicYears', 'terms', 'classes', 'admissionConfig'],
  STAFF: ['schoolProfile', 'academicYears', 'terms', 'teacherAssignments', 'roleAssignments'],
  OPERATIONS: ['schoolProfile', 'academicYears', 'terms', 'calendarEvents'],
  FULL_MANAGEMENT: ['schoolProfile', 'academicYears', 'terms', 'calendarEvents', 'classes', 'subjects', 'teacherAssignments', 'assessmentConfig', 'feeStructures', 'admissionConfig', 'roleAssignments']
});

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozen(child)])));
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 24); }
function stateForPeriod(record, date, activeName, beforeName, afterName) {
  if (record.status === 'ARCHIVED' || record.archived === true) return 'ARCHIVED';
  if (record.status === activeName || record.isCurrent === true || record.is_current === true) return activeName;
  const day = date.slice(0, 10); const starts = record.startsOn ?? record.starts_on ?? record.openingDate; const ends = record.endsOn ?? record.ends_on ?? record.closingDate;
  if (starts && day < starts) return beforeName;
  if (ends && day > ends) return afterName;
  return record.status ?? (starts && ends ? activeName : 'UNAVAILABLE');
}
function resolveSingle(records, date, type, warnings) {
  const activeName = 'ACTIVE'; const candidates = records.filter((record) => stateForPeriod(record, date, activeName, type === 'year' ? 'UPCOMING' : 'NOT_STARTED', type === 'year' ? 'CLOSED' : 'ENDED') === activeName);
  if (candidates.length === 1) return frozen({ ...candidates[0], state: activeName });
  warnings.push(candidates.length ? `MULTIPLE_ACTIVE_${type.toUpperCase()}S` : type === 'year' ? 'ACADEMIC_YEAR_MISSING' : 'ACTIVE_TERM_MISSING');
  return null;
}
function permitted(context, type) {
  if (type === 'BASIC_SCHOOL') return true;
  if (type === 'FULL_MANAGEMENT') return MANAGEMENT_ROLES.has(context.role) && context.permissions.includes('*');
  return (TYPE_PERMISSIONS[type] ?? []).some((permission) => context.permissions.includes('*') || context.permissions.includes(permission));
}
function visibleModules(modules, context, capabilityRegistry) {
  return modules.filter((module) => module.enabled !== false && module.status !== 'DISABLED' && module.visible !== false && (!module.roles?.length || module.roles.includes(context.role)) && (!module.requiredPermission || context.permissions.includes('*') || context.permissions.includes(module.requiredPermission))).map((module) => {
    const capability = capabilityRegistry?.list?.().find((item) => item.moduleId === (module.moduleId ?? module.moduleKey));
    return frozen({ moduleId: module.moduleId ?? module.moduleKey, name: module.moduleName ?? module.name, category: module.category, route: module.route, capabilityId: capability?.id ?? null, capabilityHealth: capability?.health ?? null });
  });
}
function minimizeAcademic(records, context) {
  const assignments = records.teacherAssignments.filter((item) => context.role !== 'TEACHER' || item.teacherId === context.userId);
  const classIds = context.role === 'TEACHER' ? new Set(context.assignedClassIds.length ? context.assignedClassIds : assignments.map((item) => item.classId)) : null;
  const subjectIds = context.role === 'TEACHER' ? new Set(context.assignedSubjectIds.length ? context.assignedSubjectIds : assignments.map((item) => item.subjectId)) : null;
  const classes = records.classes.filter((item) => item.active !== false && (!classIds || classIds.has(item.id)));
  const subjects = records.subjects.filter((item) => item.active !== false && (!subjectIds || subjectIds.has(item.id)) && (!classIds || !item.classIds?.length || item.classIds.some((id) => classIds.has(id))));
  return { classes, subjects, teacherAssignments: assignments.map((item) => ({ teacherId: item.teacherId, classId: item.classId, subjectId: item.subjectId, academicYearId: item.academicYearId ?? null, termId: item.termId ?? null })), assessmentConfig: records.assessmentConfig };
}

export function createSchoolContextService({ sources = {}, modules = SIDEBAR_MODULES, capabilityRegistry, productionDataGuard, auditLogger, clock = () => new Date().toISOString() } = {}) {
  if (!productionDataGuard) throw new Error('School Context Service requires Production Data Guard');
  async function load(name, actor) {
    const source = sources[name]; const value = typeof source === 'function' ? await source(actor) : source ?? [];
    const records = Array.isArray(value) ? value : value ? [value] : [];
    return productionDataGuard.sanitize(records, { productionOnly: true });
  }
  async function generate({ authenticatedUser, type = 'BASIC_SCHOOL', requestId = crypto.randomUUID(), correlationId = requestId } = {}) {
    const generatedAt = clock(); let context;
    try { context = createAIAuthorizationContext(authenticatedUser); }
    catch (error) { await auditLogger?.record({ eventType: 'AI_CONTEXT_FAILED', severity: 'SECURITY', requestStatus: 'DENIED', requestId, correlationId, userId: authenticatedUser?.id, schoolId: authenticatedUser?.schoolId, role: authenticatedUser?.roleKey, authorizationResult: 'DENIED', errorCode: error.code, metadata: { contextType: type } }); throw error; }
    if (!SCHOOL_CONTEXT_TYPES.includes(type) || !permitted(context, type)) {
      const error = new AIAuthorizationError('PERMISSION_DENIED');
      await auditLogger?.record({ eventType: 'AI_CONTEXT_FAILED', severity: 'SECURITY', requestStatus: 'DENIED', requestId, correlationId, userId: context.userId, schoolId: context.schoolId, role: context.role, authorizationResult: 'DENIED', errorCode: error.code, metadata: { contextType: type } });
      throw error;
    }
    const records = {}; const warnings = []; let excludedCount = 0;
    for (const name of SOURCE_SECTIONS[type]) {
      const guarded = await load(name, authenticatedUser); records[name] = guarded.records.filter((item) => item.schoolId === context.schoolId);
      excludedCount += guarded.diagnostics.excludedCount;
      if (guarded.diagnostics.excludedCount) warnings.push(`${name.toUpperCase()}_NON_PRODUCTION_EXCLUDED`);
    }
    const academicYear = resolveSingle(records.academicYears ?? [], generatedAt, 'year', warnings);
    const eligibleTerms = (records.terms ?? []).filter((term) => !academicYear || (term.academicYearId ?? term.academic_year_id) === academicYear.id);
    const term = academicYear ? resolveSingle(eligibleTerms, generatedAt, 'term', warnings) : null;
    const calendar = (records.calendarEvents ?? []).filter((event) => !term || !event.termId || event.termId === term.id).map((event) => ({ id: event.id, type: event.type, name: event.name, startsOn: event.startsOn ?? event.starts_on ?? null, endsOn: event.endsOn ?? event.ends_on ?? null }));
    const base = { schoolId: context.schoolId, schoolName: records.schoolProfile?.[0]?.name ?? null, schoolProfile: records.schoolProfile?.[0] ? { id: records.schoolProfile[0].id, name: records.schoolProfile[0].name, timezone: records.schoolProfile[0].timezone ?? null } : null, academicYear, term, academicPeriodStatus: academicYear && term ? 'ACTIVE' : 'CONFIGURATION_INCOMPLETE', currentDate: generatedAt.slice(0, 10), schoolCalendarState: { inSession: Boolean(term), events: calendar }, schoolOperationalStatus: term ? 'IN_SESSION' : 'OUT_OF_SESSION', enabledModules: visibleModules(modules, context, capabilityRegistry), roleContext: { userId: context.userId, role: context.role, assignedClassIds: context.assignedClassIds, assignedSubjectIds: context.assignedSubjectIds }, contextType: type };
    if (!base.schoolProfile) warnings.push('SCHOOL_PROFILE_MISSING');
    if (['ACADEMIC', 'FULL_MANAGEMENT'].includes(type)) Object.assign(base, minimizeAcademic({ classes: records.classes ?? [], subjects: records.subjects ?? [], teacherAssignments: records.teacherAssignments ?? [], assessmentConfig: records.assessmentConfig ?? [] }, context));
    if (type === 'ADMISSIONS') base.classes = (records.classes ?? []).filter((item) => item.active !== false);
    if (base.classes) base.classLevels = [...new Set(base.classes.map((item) => item.level).filter(Boolean))];
    if (type === 'FINANCIAL' || type === 'FULL_MANAGEMENT') base.feeContextSummary = (records.feeStructures ?? []).filter((item) => (!academicYear || !item.academicYearId || item.academicYearId === academicYear.id) && (!term || !item.termId || item.termId === term.id) && (item.status === 'ACTIVE' || item.status === 'PUBLISHED' || item.isPublished === true)).map((item) => ({ id: item.id, academicYearId: item.academicYearId ?? null, termId: item.termId ?? null, classId: item.classId ?? null, status: item.status ?? 'PUBLISHED' }));
    if (type === 'ADMISSIONS' || type === 'FULL_MANAGEMENT') base.admissionContextSummary = (records.admissionConfig ?? []).filter((item) => (!academicYear || !item.academicYearId || item.academicYearId === academicYear.id) && (!term || !item.termId || item.termId === term.id) && (item.open === true || item.status === 'OPEN' || item.status === 'ACTIVE')).map((item) => ({ id: item.id, academicYearId: item.academicYearId ?? null, termId: item.termId ?? null, status: item.status ?? null, open: item.open === true, classIds: item.classIds ?? [] }));
    if (type === 'STAFF' || type === 'FULL_MANAGEMENT') base.staffRoleSummary = (records.roleAssignments ?? []).map((item) => ({ userId: item.userId, role: item.roleKey ?? item.role }));
    if (type === 'ACADEMIC' && (!base.classes.length || !base.subjects.length || !base.assessmentConfig.length)) warnings.push('CONFIGURATION_INCOMPLETE');
    const versionInput = { ...base, currentDate: undefined, generatedAt: undefined }; const contextVersion = fingerprint(versionInput);
    const status = !base.schoolProfile ? 'CONTEXT_UNAVAILABLE' : warnings.length ? 'CONTEXT_PARTIAL' : 'CONTEXT_READY';
    const quality = dataQuality(status === 'CONTEXT_READY' ? 'COMPLETE' : status === 'CONTEXT_UNAVAILABLE' ? 'UNAVAILABLE' : 'PARTIAL', { assessedAt: generatedAt, issues: warnings });
    const result = frozen({ ...base, contextVersion, generatedAt, status, warnings: [...new Set(warnings)], quality, productionData: { filterApplied: true, excludedCount } });
    await auditLogger?.record({ eventType: 'AI_CONTEXT_GENERATED', requestStatus: 'COMPLETED', requestId, correlationId, userId: context.userId, schoolId: context.schoolId, role: context.role, authorizationResult: 'ALLOWED', dataQualityStatus: quality.status, productionDataOnly: true, metadata: { contextType: type, contextVersion, warningCount: result.warnings.length, excludedRecordCount: excludedCount, productionFilterApplied: true } });
    return result;
  }
  return Object.freeze({ generate, contextTypes: SCHOOL_CONTEXT_TYPES });
}
