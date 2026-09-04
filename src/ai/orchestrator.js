import { createAIAuthorizationContext, createAIAuthorizationGuard, AIAuthorizationError } from './authorization-guard.js';
import { AIProviderError, providerAuditMetadata } from './provider.js';
import { executeAuthorizedAITool } from './tool-executor.js';

const DEFAULT_LIMITS = Object.freeze({ maxToolCalls: 6, maxRounds: 3, maxDurationMs: 15000, maxOutputTokens: 1024, maxContextChars: 50000 });
export const OSAAH_AI_ORCHESTRATION_ENV = Object.freeze(['OSAAH_AI_MAX_TOOL_CALLS', 'OSAAH_AI_MAX_ROUNDS', 'OSAAH_AI_MAX_DURATION_MS', 'OSAAH_AI_MAX_OUTPUT_TOKENS', 'OSAAH_AI_MAX_CONTEXT_CHARS']);
const QUALITY_RANK = Object.freeze({ COMPLETE: 0, PARTIAL: 1, STALE: 2, UNAVAILABLE: 3, INVALID: 4 });
const FORBIDDEN_ARGUMENT = /(sql|table|model|database|connection|collection)/i;
const SQL_TEXT = /\b(select|insert|update|delete|drop|alter|create)\b[\s\S]*\b(from|into|table|set)\b/i;

export class AIOrchestratorError extends Error {
  constructor(code, message, { cause } = {}) { super(message, cause ? { cause } : undefined); this.name = 'AIOrchestratorError'; this.code = code; }
  toJSON() { return { error: this.code, message: this.message }; }
}
function positiveInteger(value, name) { if (!Number.isInteger(value) || value < 1) throw new AIOrchestratorError('ORCHESTRATION_CONFIGURATION_ERROR', `${name} must be a positive integer`); return value; }
export function defineAIOrchestrationLimits(input = {}) { return Object.freeze(Object.fromEntries(Object.entries({ ...DEFAULT_LIMITS, ...input }).map(([key, value]) => [key, positiveInteger(value, key)]))); }
export function createAIOrchestrationLimits(env = process.env) { return defineAIOrchestrationLimits({ maxToolCalls: Number(env.OSAAH_AI_MAX_TOOL_CALLS ?? DEFAULT_LIMITS.maxToolCalls), maxRounds: Number(env.OSAAH_AI_MAX_ROUNDS ?? DEFAULT_LIMITS.maxRounds), maxDurationMs: Number(env.OSAAH_AI_MAX_DURATION_MS ?? DEFAULT_LIMITS.maxDurationMs), maxOutputTokens: Number(env.OSAAH_AI_MAX_OUTPUT_TOKENS ?? DEFAULT_LIMITS.maxOutputTokens), maxContextChars: Number(env.OSAAH_AI_MAX_CONTEXT_CHARS ?? DEFAULT_LIMITS.maxContextChars) }); }
function plain(value) { return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function inspectArguments(value) { if (typeof value === 'string' && SQL_TEXT.test(value)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', 'Provider tool arguments contain a prohibited query'); if (Array.isArray(value)) return value.forEach(inspectArguments); if (plain(value)) for (const [key, child] of Object.entries(value)) { if (FORBIDDEN_ARGUMENT.test(key)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', 'Provider tool arguments contain a prohibited field'); inspectArguments(child); } }
function validateSchema(value, schema, path = 'arguments') {
  const type = schema?.type;
  if (type === 'object') { if (!plain(value)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} must be an object`); for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} is missing a required field`); for (const [key, child] of Object.entries(value)) { const childSchema = schema.properties?.[key]; if (childSchema) validateSchema(child, childSchema, `${path}.${key}`); else if (schema.additionalProperties === false) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} contains an unknown field`); } }
  else if (type === 'array') { if (!Array.isArray(value)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} must be an array`); value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`)); }
  else if (type === 'string' && typeof value !== 'string' || type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) || type === 'integer' && !Number.isInteger(value) || type === 'boolean' && typeof value !== 'boolean') throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} has an invalid type`);
  if (schema?.enum && !schema.enum.includes(value)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', `${path} has an unsupported value`);
}
function aggregateQuality(results) {
  const qualities = results.map((item) => item.quality).filter(Boolean); if (!qualities.length) return null;
  const status = qualities.reduce((worst, item) => QUALITY_RANK[item.status] > QUALITY_RANK[worst] ? item.status : worst, 'COMPLETE');
  return Object.freeze({ status, verifiedComplete: status === 'COMPLETE', completenessPercent: qualities.every((item) => item.completenessPercent !== null) ? Math.min(...qualities.map((item) => item.completenessPercent)) : null, missingCount: qualities.reduce((sum, item) => sum + (item.missingCount ?? 0), 0), sourceCount: qualities.reduce((sum, item) => sum + (item.sourceCount ?? 0), 0), reportingPeriods: Object.freeze(qualities.map((item) => item.reportingPeriod).filter(Boolean)), warnings: Object.freeze([...new Set(qualities.flatMap((item) => item.warnings ?? item.issues ?? []))]) });
}
function scalarValues(value, values = new Set()) { if (value === null || value === undefined) return values; if (['string', 'number', 'boolean'].includes(typeof value)) values.add(String(value)); else if (Array.isArray(value)) value.forEach((item) => scalarValues(item, values)); else if (plain(value)) Object.values(value).forEach((item) => scalarValues(item, values)); return values; }
function groundedNarrative(text, results, quality) {
  if (!results.length || !text) return Object.freeze({ text: text ?? null, warning: null });
  const allowed = scalarValues(results.map((item) => ({ data: item.data, reportingPeriod: item.quality?.reportingPeriod }))); const numbers = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (numbers.some((number) => !allowed.has(number))) return Object.freeze({ text: null, warning: 'Provider narrative was withheld because it contained an ungrounded deterministic value.' });
  if (quality?.status !== 'COMPLETE' && /\b(complete|fully|definitive|verified)\b/i.test(text)) return Object.freeze({ text: null, warning: `Provider narrative was withheld because ${quality.status} data cannot be presented as verified complete.` });
  return Object.freeze({ text, warning: null });
}

export function createAIOrchestrator({ providerRegistry, providerId, capabilityRegistry, toolRegistry, productionDataGuard, dataQualityGuard, auditLogger, toolExecutor = executeAuthorizedAITool, limits = DEFAULT_LIMITS, clock = () => Date.now() } = {}) {
  if (!providerRegistry || !providerId || !capabilityRegistry || !toolRegistry || !productionDataGuard || !dataQualityGuard || !auditLogger) throw new Error('AI Orchestrator requires provider, registries, guards, and audit logging.');
  const bounded = defineAIOrchestrationLimits(limits); const selected = providerRegistry.select(providerId);
  async function execute({ authenticatedUser, authorizationContext, schoolContext, capabilityIds, query, requestId, correlationId }) {
    const started = clock(); let rounds = 0, requestedCount = 0, executedCount = 0, deniedCount = 0; const toolResults = []; const capabilities = [...new Set(capabilityIds ?? [])];
    const identity = { userId: authenticatedUser?.id ?? null, schoolId: authenticatedUser?.schoolId ?? null, role: authenticatedUser?.roleKey ?? null };
    const audit = (event) => auditLogger.record({ requestId, correlationId, ...identity, provider: selected.providerId, model: selected.modelId, ...event });
    const metadata = (finalStatus) => ({ rounds, toolsRequested: requestedCount, toolsExecuted: executedCount, toolsDenied: deniedCount, capabilities, finalStatus });
    const remaining = () => bounded.maxDurationMs - (clock() - started);
    async function withinDeadline(promise) { const wait = remaining(); if (wait <= 0) throw new AIOrchestratorError('ORCHESTRATION_TIMEOUT', 'AI orchestration timed out'); let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new AIOrchestratorError('ORCHESTRATION_TIMEOUT', 'AI orchestration timed out')), wait); })]); } finally { clearTimeout(timer); } }
    await audit({ eventType: 'AI_ORCHESTRATION_STARTED', requestStatus: 'STARTED', metadata: metadata('STARTED') });
    try {
      if (typeof query !== 'string' || !query.trim() || !capabilities.length) throw new AIOrchestratorError('INVALID_REQUEST', 'Orchestration requires a query and authorized capabilities');
      const context = authorizationContext ?? createAIAuthorizationContext(authenticatedUser); const guard = createAIAuthorizationGuard({ capabilityRegistry, toolRegistry });
      for (const capabilityId of capabilities) guard.authorizeCapability(context, capabilityId);
      const toolDefinitions = toolRegistry.list({ enabledOnly: true }).filter((tool) => capabilities.includes(tool.capabilityId) && ['READ', 'ANALYZE'].includes(tool.operationType)).map((tool) => Object.freeze({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, operationType: tool.operationType, capabilityId: tool.capabilityId }));
      if (JSON.stringify({ query, schoolContext, toolDefinitions }).length > bounded.maxContextChars) throw new AIOrchestratorError('ORCHESTRATION_CONTEXT_LIMIT', 'AI orchestration context exceeds its configured limit');
      let providerResponse;
      while (rounds < bounded.maxRounds) {
        rounds += 1;
        if (JSON.stringify({ query, schoolContext, toolDefinitions, toolResults }).length > bounded.maxContextChars) throw new AIOrchestratorError('ORCHESTRATION_CONTEXT_LIMIT', 'AI orchestration context exceeds its configured limit');
        providerResponse = await withinDeadline(providerRegistry.invoke(providerId, 'generate', { query, schoolContext, toolDefinitions, toolResults, requestId, correlationId, maxOutputTokens: bounded.maxOutputTokens }, { timeoutMs: remaining() }));
        if (requestedCount + providerResponse.toolRequests.length > bounded.maxToolCalls) throw new AIOrchestratorError('ORCHESTRATION_LIMIT', 'AI orchestration tool-call limit reached');
        requestedCount += providerResponse.toolRequests.length;
        await audit({ eventType: 'AI_ORCHESTRATION_ROUND', requestStatus: 'COMPLETED', tokenUsage: providerResponse.usage, durationMs: clock() - started, metadata: metadata(providerResponse.toolRequests.length ? 'TOOLS_REQUESTED' : 'ANSWER_READY') });
        if (!providerResponse.toolRequests.length) break;
        for (const request of providerResponse.toolRequests) {
          try {
            if (!request?.name || !plain(request.arguments)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', 'Provider returned malformed tool arguments');
            const tool = toolRegistry.get(request.name); if (!tool) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', 'Provider requested an unknown tool');
            if (tool.operationType === 'WRITE') throw new AIOrchestratorError('WRITE_DISABLED', 'AI write operations are disabled');
            if (!['READ', 'ANALYZE'].includes(tool.operationType) || !capabilities.includes(tool.capabilityId)) throw new AIOrchestratorError('INVALID_TOOL_REQUEST', 'Provider requested an unauthorized tool');
            inspectArguments(request.arguments); validateSchema(request.arguments, tool.inputSchema); guard.authorizeTool(context, request.name, request.arguments);
            const executed = await withinDeadline(toolExecutor({ authenticatedUser, toolName: request.name, input: request.arguments, capabilityRegistry, toolRegistry, productionDataGuard, auditLogger, requestId, correlationId }));
            const diagnostics = executed.productionData ?? {}, sourceCount = diagnostics.includedCount ?? (Array.isArray(executed.data?.records) ? executed.data.records.length : 0), missingCount = diagnostics.excludedCount ?? 0;
            const assessed = await withinDeadline(dataQualityGuard.assess({ validated: true, valid: true, status: executed.quality?.status, sourceAvailable: executed.quality?.status !== 'UNAVAILABLE', sourceCount, missingCount, expectedCount: sourceCount + missingCount, lastUpdatedAt: executed.quality?.sourceUpdatedAt ?? null, reportingPeriod: executed.quality?.reportingPeriod ?? null, warnings: executed.quality?.issues ?? [], requestId, correlationId, capabilityId: tool.capabilityId, ...identity }));
            toolResults.push(Object.freeze({ requestId: request.id ?? null, toolName: tool.name, capabilityId: tool.capabilityId, status: 'SUCCEEDED', data: executed.data, quality: assessed.quality, sourceMetadata: Object.freeze({ sourceCount, missingCount, lastUpdatedAt: assessed.quality.lastUpdatedAt, reportingPeriod: assessed.quality.reportingPeriod, productionDataOnly: true }) })); executedCount += 1;
          } catch (error) {
            if (error?.code === 'ORCHESTRATION_TIMEOUT') throw error;
            if (error instanceof AIAuthorizationError || ['INVALID_TOOL_REQUEST', 'WRITE_DISABLED'].includes(error.code)) { deniedCount += 1; await audit({ eventType: 'AI_ORCHESTRATION_TOOL_DENIED', severity: 'SECURITY', requestStatus: error.code === 'WRITE_DISABLED' ? 'BLOCKED' : 'DENIED', toolName: request?.name ?? null, errorCode: error.code ?? 'INVALID_TOOL_REQUEST', metadata: metadata('DENIED') }); throw error; }
            const assessed = await dataQualityGuard.assess({ validated: true, valid: true, sourceAvailable: false, sourceCount: 0, missingCount: 0, warnings: ['A registered tool failed; its data is unavailable.'], requestId, correlationId, capabilityId: toolRegistry.get(request?.name)?.capabilityId ?? null, ...identity });
            toolResults.push(Object.freeze({ requestId: request?.id ?? null, toolName: request?.name ?? null, capabilityId: toolRegistry.get(request?.name)?.capabilityId ?? null, status: 'FAILED', error: 'TOOL_EXECUTION_FAILED', data: null, quality: assessed.quality }));
          }
        }
      }
      if (providerResponse?.toolRequests.length) throw new AIOrchestratorError('ORCHESTRATION_LIMIT', 'AI orchestration round limit reached');
      const quality = aggregateQuality(toolResults), failedTools = toolResults.filter((item) => item.status === 'FAILED').length;
      const finalStatus = failedTools || quality && quality.status !== 'COMPLETE' ? 'DEGRADED' : 'SUCCEEDED'; const screened = groundedNarrative(providerResponse?.text, toolResults, quality); const warnings = Object.freeze([...(quality?.warnings ?? []), ...(screened.warning ? [screened.warning] : [])]);
      const result = Object.freeze({ requestId, correlationId, status: finalStatus, narrative: screened.text, grounding: Object.freeze({ grounded: toolResults.length > 0, authoritativeToolResults: Object.freeze([...toolResults]), quality, warnings }), provider: Object.freeze(providerAuditMetadata(providerResponse)), orchestration: Object.freeze({ rounds, toolsRequested: requestedCount, toolsExecuted: executedCount, toolsDenied: deniedCount, durationMs: clock() - started, limits: bounded }) });
      await audit({ eventType: 'AI_ORCHESTRATION_COMPLETED', requestStatus: 'COMPLETED', dataQualityStatus: quality?.status ?? null, tokenUsage: providerResponse.usage, durationMs: clock() - started, metadata: metadata(finalStatus) }); return result;
    } catch (cause) {
      const code = cause instanceof AIProviderError ? 'PROVIDER_UNAVAILABLE' : cause.code ?? 'ORCHESTRATION_FAILED';
      await audit({ eventType: 'AI_ORCHESTRATION_FAILED', severity: code === 'WRITE_DISABLED' ? 'SECURITY' : 'WARNING', requestStatus: code === 'WRITE_DISABLED' ? 'BLOCKED' : 'FAILED', errorCode: code, durationMs: clock() - started, metadata: metadata('FAILED') });
      if (cause instanceof AIProviderError) throw cause; throw cause instanceof AIOrchestratorError || cause instanceof AIAuthorizationError ? cause : new AIOrchestratorError('ORCHESTRATION_FAILED', 'AI orchestration failed safely', { cause });
    }
  }
  return Object.freeze({ execute, limits: bounded, provider: Object.freeze({ providerId: selected.providerId, modelId: selected.modelId }) });
}
