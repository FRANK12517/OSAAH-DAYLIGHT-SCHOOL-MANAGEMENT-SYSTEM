import { createAIAuthorizationContext, createAIAuthorizationGuard, AIAuthorizationError } from './authorization-guard.js';
import { executeAuthorizedAITool } from './tool-executor.js';
import { AIProviderError, providerAuditMetadata } from './provider.js';

const ERRORS = Object.freeze({
  UNAUTHENTICATED: [401, 'Authentication is required.'], PERMISSION_DENIED: [403, 'The requested AI operation is not authorized.'],
  CAPABILITY_UNAVAILABLE: [503, 'The requested AI capability is unavailable.'], INVALID_REQUEST: [400, 'The AI request is invalid.'],
  DATA_UNAVAILABLE: [503, 'Required verified data is unavailable.'], WRITE_DISABLED: [403, 'AI write operations are disabled.'],
  PROVIDER_UNAVAILABLE: [503, 'No AI provider is configured.']
});

export class AIGatewayError extends Error {
  constructor(code, { requestId = null, correlationId = requestId, cause } = {}) {
    const [status, message] = ERRORS[code] ?? ERRORS.INVALID_REQUEST;
    super(message, cause ? { cause } : undefined); this.name = 'AIGatewayError'; this.code = Object.hasOwn(ERRORS, code) ? code : 'INVALID_REQUEST'; this.status = status; this.requestId = requestId; this.correlationId = correlationId;
  }
  toJSON() { return { error: this.code, message: this.message, requestId: this.requestId, correlationId: this.correlationId }; }
}

function mapped(error, ids) {
  if (error instanceof AIGatewayError) return error;
  if (error instanceof AIProviderError) return new AIGatewayError('PROVIDER_UNAVAILABLE', { ...ids, cause: error });
  const code = error instanceof AIAuthorizationError ? ({ SCOPE_DENIED: 'PERMISSION_DENIED', CAPABILITY_DISABLED: 'CAPABILITY_UNAVAILABLE', TOOL_NOT_ALLOWED: 'INVALID_REQUEST' }[error.code] ?? error.code) : 'INVALID_REQUEST';
  return new AIGatewayError(code, { ...ids, cause: error });
}

export function createAIGateway({ capabilityRegistry, toolRegistry, schoolContextService, productionDataGuard, dataQualityGuard, auditLogger, toolExecutor = executeAuthorizedAITool, providerRegistry = null, providerId = null } = {}) {
  if (!capabilityRegistry || !toolRegistry || !schoolContextService || !productionDataGuard || !dataQualityGuard || !auditLogger) throw new Error('AI Gateway requires registries, guards, School Context, and audit logging.');
  async function execute({ authenticatedUser, capabilityId, toolName, input = {}, query = null, requestId = crypto.randomUUID(), correlationId = requestId, providerRequired = false } = {}) {
    const ids = { requestId, correlationId }; const identity = { userId: authenticatedUser?.id ?? null, schoolId: authenticatedUser?.schoolId ?? null, role: authenticatedUser?.roleKey ?? null };
    const audit = (event) => auditLogger.record({ requestId, correlationId, ...identity, capabilityId: capabilityId ?? null, toolName: toolName ?? null, ...event });
    await audit({ eventType: 'AI_GATEWAY_REQUEST', requestStatus: 'RECEIVED' });
    try {
      const context = createAIAuthorizationContext(authenticatedUser);
      if (typeof capabilityId !== 'string' || !capabilityId || typeof toolName !== 'string' || !toolName || !input || typeof input !== 'object' || Array.isArray(input)) throw new AIGatewayError('INVALID_REQUEST', ids);
      const schoolContext = await schoolContextService.generate({ authenticatedUser, type: 'BASIC_SCHOOL', requestId, correlationId });
      if (schoolContext.quality.status === 'UNAVAILABLE' || schoolContext.quality.status === 'INVALID') throw new AIGatewayError('DATA_UNAVAILABLE', ids);
      const authorization = createAIAuthorizationGuard({ capabilityRegistry, toolRegistry });
      const capability = authorization.authorizeCapability(context, capabilityId);
      const tool = toolRegistry.get(toolName);
      if (!tool || tool.capabilityId !== capability.id) throw new AIGatewayError('INVALID_REQUEST', ids);
      if (tool.operationType === 'WRITE') throw new AIGatewayError('WRITE_DISABLED', ids);
      if (providerRequired && (!providerRegistry || !providerId)) throw new AIGatewayError('PROVIDER_UNAVAILABLE', ids);
      if (providerRequired && (typeof query !== 'string' || !query.trim())) throw new AIGatewayError('INVALID_REQUEST', ids);
      const executed = await toolExecutor({ authenticatedUser, toolName, input, capabilityRegistry, toolRegistry, productionDataGuard, auditLogger, requestId, correlationId });
      const diagnostics = executed.productionData ?? {}; const sourceCount = diagnostics.includedCount ?? (Array.isArray(executed.data?.records) ? executed.data.records.length : 0); const missingCount = diagnostics.excludedCount ?? 0;
      const assessed = await dataQualityGuard.assess({ validated: true, valid: true, status: executed.quality?.status, sourceAvailable: executed.quality?.status !== 'UNAVAILABLE', sourceCount, missingCount, expectedCount: sourceCount + missingCount, lastUpdatedAt: executed.quality?.sourceUpdatedAt ?? null, warnings: executed.quality?.issues ?? [], requestId, correlationId, capabilityId, ...identity });
      if (assessed.quality.status === 'UNAVAILABLE' || assessed.quality.status === 'INVALID') throw new AIGatewayError('DATA_UNAVAILABLE', ids);
      let provider = Object.freeze({ configured: false, invoked: false });
      if (providerRequired) {
        const selected = providerRegistry.select(providerId);
        await audit({ eventType: 'AI_PROVIDER_REQUEST', requestStatus: 'STARTED', provider: selected.providerId, model: selected.modelId, metadata: { providerRequestStatus: 'STARTED' } });
        let response;
        try { response = await providerRegistry.invoke(providerId, 'generate', { query, schoolContext, toolDefinitions: [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, operationType: tool.operationType }], toolResults: [{ toolName, data: executed.data, quality: assessed.quality }], requestId, correlationId, maxOutputTokens: selected.maxOutputTokens }); }
        catch (error) { await audit({ eventType: 'AI_PROVIDER_RESPONSE', severity: 'WARNING', requestStatus: 'FAILED', provider: selected.providerId, model: selected.modelId, errorCode: error.code ?? 'PROVIDER_UNAVAILABLE', metadata: { providerRequestStatus: 'FAILED' } }); throw error; }
        const authorization = createAIAuthorizationGuard({ capabilityRegistry, toolRegistry });
        const toolRequests = response.toolRequests.map((request) => { if (request.name !== tool.name) throw new AIGatewayError('INVALID_REQUEST', ids); const requestedTool = toolRegistry.get(request.name); if (!requestedTool || !['READ', 'ANALYZE'].includes(requestedTool.operationType)) throw new AIGatewayError(requestedTool?.operationType === 'WRITE' ? 'WRITE_DISABLED' : 'INVALID_REQUEST', ids); authorization.authorizeTool(context, request.name, request.arguments); return request; });
        provider = Object.freeze({ configured: true, invoked: true, text: response.text, toolRequests: Object.freeze(toolRequests), finishStatus: response.finishStatus, ...providerAuditMetadata(response) });
        await audit({ eventType: 'AI_PROVIDER_RESPONSE', requestStatus: 'COMPLETED', provider: response.provider, model: response.model, tokenUsage: response.usage, durationMs: response.latencyMs, metadata: { providerRequestStatus: 'COMPLETED', latencyMs: response.latencyMs } });
      }
      const result = Object.freeze({ requestId, correlationId, capabilityId, toolName, schoolContext, quality: assessed.quality, data: executed.data, provider });
      await audit({ eventType: 'AI_GATEWAY_COMPLETED', requestStatus: 'COMPLETED', dataQualityStatus: result.quality.status, productionDataOnly: true, metadata: { warningCount: result.quality.warnings.length } });
      return result;
    } catch (cause) {
      const error = mapped(cause, ids);
      await audit({ eventType: 'AI_GATEWAY_REJECTED', severity: ['INVALID_REQUEST', 'CAPABILITY_UNAVAILABLE', 'DATA_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'].includes(error.code) ? 'WARNING' : 'SECURITY', requestStatus: error.code === 'WRITE_DISABLED' ? 'BLOCKED' : 'DENIED', authorizationResult: 'DENIED', errorCode: error.code });
      throw error;
    }
  }
  return Object.freeze({ execute, providerConfigured: Boolean(providerRegistry && providerId) });
}
