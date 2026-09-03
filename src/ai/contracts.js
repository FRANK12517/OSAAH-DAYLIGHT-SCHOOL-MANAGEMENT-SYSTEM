export const AI_DATA_PROVENANCE = Object.freeze(['PRODUCTION', 'TEST', 'DEMO', 'SEED', 'DEVELOPMENT', 'MIGRATION_VALIDATION']);
export const AI_DATA_QUALITY = Object.freeze(['COMPLETE', 'PARTIAL', 'STALE', 'UNAVAILABLE', 'INVALID']);
export const AI_ACCESS_MODES = Object.freeze(['READ', 'WRITE']);
export const AI_RESULT_STATUSES = Object.freeze(['SUCCEEDED', 'DENIED', 'DEGRADED', 'FAILED']);

export function dataQuality(status, input = {}) {
  if (!AI_DATA_QUALITY.includes(status)) throw new Error(`Invalid AI data-quality status: ${status}`);
  return Object.freeze({
    status,
    assessedAt: input.assessedAt ?? new Date().toISOString(),
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    completenessPercent: input.completenessPercent ?? null,
    issues: Object.freeze([...(input.issues ?? [])]),
    missing: Object.freeze([...(input.missing ?? [])])
  });
}

export function schoolContext(input) {
  if (!input?.school?.id || !input?.actor?.id || !input?.actor?.roleKey) throw new Error('School, actor, and role are required for AI context');
  return Object.freeze({
    requestId: input.requestId,
    school: Object.freeze({ ...input.school }),
    actor: Object.freeze({ ...input.actor, permissions: Object.freeze([...(input.actor.permissions ?? [])]) }),
    academicYear: input.academicYear ? Object.freeze({ ...input.academicYear }) : null,
    term: input.term ? Object.freeze({ ...input.term }) : null,
    levels: Object.freeze([...(input.levels ?? [])]),
    classes: Object.freeze([...(input.classes ?? [])]),
    subjects: Object.freeze([...(input.subjects ?? [])]),
    modules: Object.freeze([...(input.modules ?? [])]),
    calendar: Object.freeze([...(input.calendar ?? [])]),
    rules: Object.freeze([...(input.rules ?? [])]),
    quality: input.quality ?? dataQuality('UNAVAILABLE', { issues: ['Context quality was not assessed.'] })
  });
}

export function aiAuditEvent(input, clock = () => new Date().toISOString()) {
  for (const field of ['id', 'userId', 'schoolId', 'role', 'requestId', 'operation', 'resultStatus']) if (!input?.[field]) throw new Error(`AI audit field is required: ${field}`);
  if (!AI_RESULT_STATUSES.includes(input.resultStatus)) throw new Error(`Invalid AI result status: ${input.resultStatus}`);
  return Object.freeze({
    id: input.id,
    userId: input.userId,
    schoolId: input.schoolId,
    role: input.role,
    requestId: input.requestId,
    operation: input.operation,
    capability: input.capability ?? null,
    toolName: input.toolName ?? null,
    dataScope: Object.freeze({ ...(input.dataScope ?? {}) }),
    timestamp: input.timestamp ?? clock(),
    resultStatus: input.resultStatus,
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    usage: input.usage ? Object.freeze({ ...input.usage }) : null,
    actionRequested: Boolean(input.actionRequested),
    actionExecuted: Boolean(input.actionExecuted),
    errorCode: input.errorCode ?? null
  });
}
