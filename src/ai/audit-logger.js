const EVENT_TYPES = new Set([
  'AI_REQUEST_RECEIVED', 'AI_AUTH_ALLOWED', 'AI_AUTH_DENIED', 'AI_TOOL_STARTED',
  'AI_TOOL_COMPLETED', 'AI_TOOL_FAILED', 'AI_DATA_FILTER_APPLIED', 'AI_DATA_QUALITY_ASSESSED',
  'AI_CAPABILITY_UNAVAILABLE', 'AI_WRITE_BLOCKED', 'AI_REQUEST_COMPLETED',
  'AI_REQUEST_FAILED', 'AI_CONTEXT_GENERATED', 'AI_CONTEXT_FAILED', 'AI_PROVIDER_REQUEST', 'AI_PROVIDER_RESPONSE',
  'AI_GATEWAY_REQUEST', 'AI_GATEWAY_COMPLETED', 'AI_GATEWAY_REJECTED',
  'AI_ACTION_PREPARED', 'AI_ACTION_APPROVED', 'AI_ACTION_REJECTED', 'AI_ACTION_EXECUTED'
]);
const SEVERITIES = new Set(['INFO', 'WARNING', 'SECURITY', 'ERROR']);
const QUALITY = new Set(['COMPLETE', 'PARTIAL', 'STALE', 'UNAVAILABLE', 'INVALID']);
const STATUSES = new Set(['RECEIVED', 'ALLOWED', 'DENIED', 'STARTED', 'COMPLETED', 'FAILED', 'BLOCKED']);
const SECRET_KEY = /(password|passphrase|secret|token|authorization|cookie|api.?key|database.?url|credential|private.?key)/i;
const SAFE_METADATA = new Set(['recordCount', 'sourceRecordCount', 'includedRecordCount', 'excludedRecordCount', 'trustedLegacyCount', 'productionFilterApplied', 'provenanceViolationDetected', 'continued', 'academicYearId', 'termId', 'reportingCutoff', 'calculationReference', 'providerRequestStatus', 'latencyMs', 'targetRecordId', 'rollbackReferenceId', 'approvalUserId', 'rejectionUserId', 'decisionAt', 'contextType', 'contextVersion', 'warningCount']);

export class AIAuditPersistenceError extends Error {
  constructor(cause) { super('AI audit persistence is unavailable.'); this.name = 'AIAuditPersistenceError'; this.code = 'AI_AUDIT_UNAVAILABLE'; this.cause = cause; }
}

export function redactAuditValue(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 256)}…` : value;
  if (Array.isArray(value)) return Object.freeze(value.slice(0, 100).map((item) => redactAuditValue(item)));
  if (typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactAuditValue(child, childKey)])));
  return String(value);
}

function safeMetadata(metadata = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(metadata).filter(([key]) => SAFE_METADATA.has(key)).map(([key, value]) => [key, redactAuditValue(value, key)])));
}
function safeTokenUsage(value) { return Object.freeze(Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens'].map((key) => [key, Number.isInteger(value?.[key]) && value[key] >= 0 ? value[key] : null]))); }

function createEvent(input, clock, environment) {
  if (!EVENT_TYPES.has(input?.eventType)) throw new Error(`Unsupported AI audit event type: ${input?.eventType}`);
  if (!input.requestId || !input.correlationId) throw new Error('AI audit request and correlation IDs are required');
  if (!SEVERITIES.has(input.severity ?? 'INFO')) throw new Error(`Invalid AI audit severity: ${input.severity}`);
  if (!STATUSES.has(input.requestStatus ?? 'RECEIVED')) throw new Error(`Invalid AI audit request status: ${input.requestStatus}`);
  if (input.dataQualityStatus && !QUALITY.has(input.dataQualityStatus)) throw new Error(`Invalid AI audit data quality: ${input.dataQualityStatus}`);
  return Object.freeze({
    id: input.id ?? crypto.randomUUID(), requestId: input.requestId, correlationId: input.correlationId,
    timestamp: input.timestamp ?? clock(), eventType: input.eventType, severity: input.severity ?? 'INFO',
    userId: input.userId ?? null, schoolId: input.schoolId ?? null, role: input.role ?? null,
    capabilityId: input.capabilityId ?? null, toolName: input.toolName ?? null, operationType: input.operationType ?? null,
    authorizationResult: input.authorizationResult ?? null, dataScope: redactAuditValue(input.dataScope ?? {}),
    productionDataOnly: input.productionDataOnly ?? null, dataQualityStatus: input.dataQualityStatus ?? null,
    requestStatus: input.requestStatus ?? 'RECEIVED', durationMs: input.durationMs ?? null,
    provider: input.provider ?? null, model: input.model ?? null,
    tokenUsage: input.tokenUsage ? safeTokenUsage(input.tokenUsage) : null, estimatedCost: input.estimatedCost ?? null,
    errorCode: input.errorCode ?? null, actionRequested: Boolean(input.actionRequested), actionExecuted: Boolean(input.actionExecuted),
    approvalUserId: input.approvalUserId ?? null, rejectionUserId: input.rejectionUserId ?? null,
    actionDecisionAt: input.actionDecisionAt ?? null, targetRecordId: input.targetRecordId ?? null,
    rollbackReferenceId: input.rollbackReferenceId ?? null, environment: input.environment ?? environment,
    metadata: safeMetadata(input.metadata)
  });
}

export function createInMemoryAIAuditSink(initialEvents = []) {
  const events = [...initialEvents];
  return Object.freeze({ append: async (event) => { events.push(event); }, list: () => Object.freeze([...events]) });
}

export function createAIAuditLogger({ sink = createInMemoryAIAuditSink(), clock = () => new Date().toISOString(), environment = process.env.NODE_ENV ?? 'development', retention = {}, onFailure = (error) => console.error('AI_AUDIT_PERSISTENCE_FAILED', error.code) } = {}) {
  async function record(input) {
    const event = createEvent(input, clock, environment);
    try { await sink.append(event); return event; }
    catch (cause) { const error = new AIAuditPersistenceError(cause); onFailure(error); throw error; }
  }
  function recent({ limit = 50, schoolId } = {}) {
    const events = typeof sink.list === 'function' ? sink.list() : [];
    return Object.freeze(events.filter((event) => !schoolId || event.schoolId === schoolId).slice(-Math.max(0, Math.min(limit, 100))).reverse());
  }
  return Object.freeze({ record, recent, retention: Object.freeze({ policyName: retention.policyName ?? 'CENTRALLY_MANAGED', retentionDays: retention.retentionDays ?? null, hardDeleteDuringRequest: false }), eventTypes: Object.freeze([...EVENT_TYPES]) });
}
