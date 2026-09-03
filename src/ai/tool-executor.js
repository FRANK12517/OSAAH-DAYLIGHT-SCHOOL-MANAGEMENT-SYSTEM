import { createAIAuthorizationContext, createAIAuthorizationGuard, AIAuthorizationError } from './authorization-guard.js';
import { AIAuditPersistenceError, createAIAuditLogger } from './audit-logger.js';

function minimize(value, schema) {
  if (value === null || value === undefined) return value;
  if (schema?.type === 'array') return Array.isArray(value) ? value.map((item) => minimize(item, schema.items)) : [];
  if (schema?.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return value;
  const properties = schema.properties ?? {};
  return Object.freeze(Object.fromEntries(Object.entries(properties).filter(([key]) => Object.hasOwn(value, key)).map(([key, child]) => [key, minimize(value[key], child)])));
}

export async function executeAuthorizedAITool({ authenticatedUser, toolName, input = {}, capabilityRegistry, toolRegistry, productionDataGuard, auditLogger = createAIAuditLogger(), requestId = crypto.randomUUID(), correlationId = requestId, additionalCapabilityIds = [] }) {
  const startedAt = Date.now(); const requestedTool = toolRegistry?.get(toolName); let authorization; let toolStarted = false; let auditFailed = false;
  const identity = { userId: authenticatedUser?.id ?? null, schoolId: authenticatedUser?.schoolId ?? null, role: authenticatedUser?.roleKey ?? null };
  const base = () => ({ requestId, correlationId, ...identity, capabilityId: requestedTool?.capabilityId ?? null, toolName, operationType: requestedTool?.operationType ?? null, productionDataOnly: requestedTool?.productionDataOnly ?? null });
  async function audit(event, required = false) {
    if (!auditLogger) { if (required) throw new AIAuditPersistenceError(new Error('No AI audit logger configured')); return; }
    try { await auditLogger.record({ ...base(), ...event }); }
    catch (error) { auditFailed = true; if (required) throw error; }
  }
  await audit({ eventType: 'AI_REQUEST_RECEIVED', requestStatus: 'RECEIVED' });
  try {
    const context = createAIAuthorizationContext(authenticatedUser);
    const guard = createAIAuthorizationGuard({ capabilityRegistry, toolRegistry });
    authorization = guard.authorizeTool(context, toolName, input, { additionalCapabilityIds });
    await audit({ eventType: 'AI_AUTH_ALLOWED', authorizationResult: 'ALLOWED', requestStatus: 'ALLOWED', dataScope: authorization.scope });
    if (auditFailed && authorization.tool.auditRequired) throw new AIAuditPersistenceError(new Error('Required AI audit event failed'));
    if (typeof authorization.tool.handler !== 'function') throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    if (authorization.tool.productionDataOnly && !productionDataGuard) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
    await audit({ eventType: 'AI_TOOL_STARTED', requestStatus: 'STARTED', dataScope: authorization.scope }, authorization.tool.auditRequired);
    toolStarted = true;
    const raw = await authorization.tool.handler(Object.freeze({ input: Object.freeze({ ...input, schoolId: context.schoolId }), authorization, requestId, correlationId }));
    const sourceRecords = Array.isArray(raw) ? raw : raw?.records ?? [];
    const guarded = authorization.tool.productionDataOnly ? productionDataGuard.sanitize(sourceRecords, { productionOnly: true }) : null;
    if (guarded) await audit({ eventType: 'AI_DATA_FILTER_APPLIED', requestStatus: 'COMPLETED', dataQualityStatus: guarded.quality.status, dataScope: authorization.scope, metadata: { sourceRecordCount: sourceRecords.length, includedRecordCount: guarded.diagnostics.includedCount, excludedRecordCount: guarded.diagnostics.excludedCount, trustedLegacyCount: guarded.diagnostics.trustedLegacyCount, productionFilterApplied: true, provenanceViolationDetected: guarded.diagnostics.excludedCount > 0, continued: true } }, authorization.tool.auditRequired);
    const value = Array.isArray(raw) ? guarded.records : raw?.records ? { ...raw, records: guarded.records, quality: guarded.quality } : raw;
    const result = Object.freeze({ data: minimize(value, authorization.tool.outputSchema), quality: guarded?.quality ?? null, requestId, correlationId, authorization: Object.freeze({ capabilityId: authorization.capability.id, toolName: authorization.tool.name, scope: authorization.scope }) });
    await audit({ eventType: 'AI_TOOL_COMPLETED', requestStatus: 'COMPLETED', dataQualityStatus: guarded?.quality.status ?? null, durationMs: Date.now() - startedAt }, authorization.tool.auditRequired);
    await audit({ eventType: 'AI_REQUEST_COMPLETED', requestStatus: 'COMPLETED', dataQualityStatus: guarded?.quality.status ?? null, durationMs: Date.now() - startedAt }, authorization.tool.auditRequired);
    return result;
  } catch (error) {
    const provenanceBypass = error.message === 'PRODUCTION_DATA_POLICY_OVERRIDE_FORBIDDEN';
    const code = error.code ?? (provenanceBypass ? 'PRODUCTION_DATA_POLICY_OVERRIDE_FORBIDDEN' : 'AI_TOOL_EXECUTION_FAILED');
    const isAuth = error instanceof AIAuthorizationError;
    const specialEvent = code === 'WRITE_DISABLED' ? 'AI_WRITE_BLOCKED' : code === 'CAPABILITY_DISABLED' ? 'AI_CAPABILITY_UNAVAILABLE' : null;
    if (isAuth) {
      await audit({ eventType: specialEvent ?? 'AI_AUTH_DENIED', severity: code === 'TOOL_NOT_ALLOWED' || code === 'CAPABILITY_DISABLED' ? 'WARNING' : 'SECURITY', authorizationResult: 'DENIED', requestStatus: code === 'WRITE_DISABLED' ? 'BLOCKED' : 'DENIED', errorCode: code });
    } else if (toolStarted) await audit({ eventType: 'AI_TOOL_FAILED', severity: provenanceBypass ? 'SECURITY' : 'ERROR', requestStatus: 'FAILED', errorCode: code, durationMs: Date.now() - startedAt });
    await audit({ eventType: 'AI_REQUEST_FAILED', severity: isAuth || provenanceBypass ? 'SECURITY' : 'ERROR', authorizationResult: isAuth ? 'DENIED' : authorization ? 'ALLOWED' : null, requestStatus: 'FAILED', errorCode: code, durationMs: Date.now() - startedAt });
    throw error;
  }
}
