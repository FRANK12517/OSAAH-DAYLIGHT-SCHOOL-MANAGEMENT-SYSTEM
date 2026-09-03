const ERROR_MESSAGES = Object.freeze({ UNAUTHENTICATED: 'Authentication is required.', CAPABILITY_DISABLED: 'The requested capability is unavailable.', PERMISSION_DENIED: 'You are not authorized to use this capability.', SCOPE_DENIED: 'The requested information is outside your authorized scope.', TOOL_NOT_ALLOWED: 'The requested tool is unavailable.', WRITE_DISABLED: 'AI write operations are disabled.' });
const ALLOWED_OPERATIONS = new Set(['READ', 'ANALYZE']);

export class AIAuthorizationError extends Error {
  constructor(code) { super(ERROR_MESSAGES[code] ?? 'AI authorization failed.'); this.name = 'AIAuthorizationError'; this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; }
  toJSON() { return { error: this.code, message: this.message }; }
}

function ids(values) { return Object.freeze([...(values ?? [])].filter(Boolean)); }
function includesAll(allowed, requested) { return !requested.length || requested.every((id) => allowed.includes(id)); }
function requestedIds(input, singular, plural) { return ids([input?.[singular], ...(input?.[plural] ?? [])]); }

export function createAIAuthorizationContext(authenticatedUser, { academicYearId = null, termId = null } = {}) {
  if (!authenticatedUser?.id || !authenticatedUser?.schoolId || !authenticatedUser?.roleKey || !(authenticatedUser.permissions instanceof Set)) throw new AIAuthorizationError('UNAUTHENTICATED');
  return Object.freeze({
    userId: authenticatedUser.id,
    schoolId: authenticatedUser.schoolId,
    role: authenticatedUser.roleKey,
    permissions: Object.freeze([...authenticatedUser.permissions]),
    assignedClassIds: ids(authenticatedUser.assignedClassIds),
    assignedSubjectIds: ids(authenticatedUser.assignedSubjectIds),
    assignedDepartmentIds: ids(authenticatedUser.assignedDepartmentIds),
    assignedStudentIds: ids(authenticatedUser.assignedStudentIds),
    linkedStudentIds: ids(authenticatedUser.children?.map((child) => child.id)),
    portal: authenticatedUser.portal,
    academicYearId,
    termId,
    sessionId: authenticatedUser.sessionId ?? null
  });
}

export function createAIAuthorizationGuard({ capabilityRegistry, toolRegistry } = {}) {
  if (!capabilityRegistry || !toolRegistry) throw new Error('AI authorization requires capability and tool registries');
  function hasPermission(context, permission) { return context.permissions.includes('*') || context.permissions.includes(permission); }
  function authorizeCapability(context, capabilityId) {
    const capability = capabilityRegistry.get(capabilityId);
    if (!capability) throw new AIAuthorizationError('PERMISSION_DENIED');
    if (!capability.enabled || capability.health !== 'ACTIVE') throw new AIAuthorizationError('CAPABILITY_DISABLED');
    if (!capability.requiredPermissions?.length || !capability.requiredPermissions.every((permission) => hasPermission(context, permission))) throw new AIAuthorizationError('PERMISSION_DENIED');
    if (capability.requiredRoles?.length && !capability.requiredRoles.includes(context.role)) throw new AIAuthorizationError('PERMISSION_DENIED');
    return capability;
  }
  function authorizeScope(context, input = {}) {
    if (input.schoolId && input.schoolId !== context.schoolId) throw new AIAuthorizationError('SCOPE_DENIED');
    const classes = requestedIds(input, 'classId', 'classIds');
    const subjects = requestedIds(input, 'subjectId', 'subjectIds');
    const departments = requestedIds(input, 'departmentId', 'departmentIds');
    const students = requestedIds(input, 'studentId', 'studentIds');
    if (context.assignedClassIds.length && !includesAll(context.assignedClassIds, classes)) throw new AIAuthorizationError('SCOPE_DENIED');
    if (context.assignedSubjectIds.length && !includesAll(context.assignedSubjectIds, subjects)) throw new AIAuthorizationError('SCOPE_DENIED');
    if (context.assignedDepartmentIds.length && !includesAll(context.assignedDepartmentIds, departments)) throw new AIAuthorizationError('SCOPE_DENIED');
    if (context.role === 'TEACHER' && context.assignedStudentIds.length && !includesAll(context.assignedStudentIds, students)) throw new AIAuthorizationError('SCOPE_DENIED');
    if (context.portal === 'parent' || context.role === 'PARENT') {
      if (!students.length || !includesAll(context.linkedStudentIds, students)) throw new AIAuthorizationError('SCOPE_DENIED');
    }
    return Object.freeze({ schoolId: context.schoolId, classIds: classes, subjectIds: subjects, departmentIds: departments, studentIds: students, academicYearId: context.academicYearId, termId: context.termId });
  }
  function authorizeTool(context, toolName, input = {}, { additionalCapabilityIds = [] } = {}) {
    const tool = toolRegistry.get(toolName);
    if (!tool || !tool.requiredPermissions?.length || !tool.capabilityId) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    if (tool.operationType === 'WRITE') throw new AIAuthorizationError('WRITE_DISABLED');
    if (!tool.enabled) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    const capability = authorizeCapability(context, tool.capabilityId);
    for (const capabilityId of additionalCapabilityIds) authorizeCapability(context, capabilityId);
    if (!capability.tools.includes(tool.name)) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    if (!ALLOWED_OPERATIONS.has(tool.operationType)) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    if (!tool.requiredPermissions.every((permission) => hasPermission(context, permission))) throw new AIAuthorizationError('PERMISSION_DENIED');
    const scope = authorizeScope(context, input);
    return Object.freeze({ context, capability, tool, scope });
  }
  return Object.freeze({ authorizeCapability, authorizeScope, authorizeTool });
}
