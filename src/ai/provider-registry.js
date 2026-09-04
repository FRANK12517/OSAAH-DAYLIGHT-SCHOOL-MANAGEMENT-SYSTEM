import { AIProviderError, AI_PROVIDER_ERRORS, normalizeAIProviderResponse, validateAIProviderRequest } from './provider.js';
const HEALTH = new Set(['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']); const OPERATIONS = new Set(['generate', 'toolCall']);
function configError(message) { return new AIProviderError(AI_PROVIDER_ERRORS.CONFIGURATION, message); }
export function defineAIProviderRegistration(input) {
  if (!input?.providerId || !input?.modelId || !input.provider) throw configError('Provider registration requires providerId, modelId, and provider');
  if (typeof input.provider.generate !== 'function' || typeof input.provider.toolCall !== 'function' || typeof input.provider.healthCheck !== 'function') throw configError('Provider does not implement the AIProvider contract');
  const timeoutMs = input.timeoutMs ?? 30000, retryLimit = input.retryLimit ?? 0, maxOutputTokens = input.maxOutputTokens ?? 2048;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(retryLimit) || retryLimit < 0 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw configError('Provider limits must be positive integers');
  const healthState = input.healthState ?? 'UNKNOWN'; if (!HEALTH.has(healthState)) throw configError('Provider health state is invalid');
  return Object.freeze({ providerId: input.providerId, modelId: input.modelId, enabled: input.enabled === true, timeoutMs, retryLimit, maxOutputTokens, healthState, provider: input.provider });
}
function publicMetadata(item) { const { provider, ...metadata } = item; return Object.freeze(metadata); }
function normalizeFailure(error, item) { if (error instanceof AIProviderError) return error; if (error?.status === 429 || error?.statusCode === 429) return new AIProviderError(AI_PROVIDER_ERRORS.RATE_LIMITED, 'AI provider rate limit reached', { provider: item.providerId, model: item.modelId }); return new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'AI provider is unavailable', { provider: item.providerId, model: item.modelId }); }
function retryable(error) { return [AI_PROVIDER_ERRORS.TIMEOUT, AI_PROVIDER_ERRORS.RATE_LIMITED, AI_PROVIDER_ERRORS.UNAVAILABLE].includes(error.code); }
export function createAIProviderRegistry(initial = []) {
  const providers = new Map();
  function register(input) { const item = defineAIProviderRegistration(input); if (providers.has(item.providerId)) throw configError(`Provider already registered: ${item.providerId}`); providers.set(item.providerId, item); return publicMetadata(item); }
  function get(providerId) { const item = providers.get(providerId); return item ? publicMetadata(item) : null; }
  function list({ enabledOnly = false } = {}) { return [...providers.values()].filter((item) => !enabledOnly || item.enabled).map(publicMetadata); }
  function select(providerId) { const item = providers.get(providerId); if (!item) throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'AI provider is unavailable'); if (!item.enabled) throw new AIProviderError(AI_PROVIDER_ERRORS.DISABLED, 'AI provider is disabled', { provider: item.providerId, model: item.modelId }); if (item.healthState === 'UNAVAILABLE') throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'AI provider is unavailable', { provider: item.providerId, model: item.modelId }); return item; }
  async function invoke(providerId, operation, request, { timeoutMs: callerTimeoutMs = null } = {}) {
    if (!OPERATIONS.has(operation)) throw configError('Provider operation is not supported');
    const item = select(providerId), safeRequest = validateAIProviderRequest(request); if (callerTimeoutMs !== null && (!Number.isFinite(callerTimeoutMs) || callerTimeoutMs <= 0)) throw new AIProviderError(AI_PROVIDER_ERRORS.TIMEOUT, 'AI provider request timed out', { provider: item.providerId, model: item.modelId }); const limitedRequest = Object.freeze({ ...safeRequest, maxOutputTokens: Math.min(safeRequest.maxOutputTokens ?? item.maxOutputTokens, item.maxOutputTokens) }); const started = performance.now(), callerDeadline = callerTimeoutMs === null ? null : started + callerTimeoutMs;
    for (let attempt = 0; attempt <= item.retryLimit; attempt += 1) {
      const controller = new AbortController(); let timer; const attemptTimeoutMs = Math.min(item.timeoutMs, callerDeadline === null ? item.timeoutMs : callerDeadline - performance.now());
      if (attemptTimeoutMs <= 0) throw new AIProviderError(AI_PROVIDER_ERRORS.TIMEOUT, 'AI provider request timed out', { provider: item.providerId, model: item.modelId });
      try { const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AIProviderError(AI_PROVIDER_ERRORS.TIMEOUT, 'AI provider request timed out', { provider: item.providerId, model: item.modelId })); }, attemptTimeoutMs); }); const raw = await Promise.race([item.provider[operation](limitedRequest, { signal: controller.signal }), timeout]); return normalizeAIProviderResponse(raw, { provider: item.providerId, model: item.modelId, latencyMs: Math.max(0, performance.now() - started) }); }
      catch (error) { const normalized = normalizeFailure(error, item); if (attempt === item.retryLimit || !retryable(normalized)) throw normalized; }
      finally { clearTimeout(timer); }
    }
  }
  async function healthCheck(providerId) { const item = select(providerId), controller = new AbortController(); let timer; try { const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AIProviderError(AI_PROVIDER_ERRORS.TIMEOUT, 'AI provider health check timed out', { provider: item.providerId, model: item.modelId })); }, item.timeoutMs); }); return await Promise.race([item.provider.healthCheck({ signal: controller.signal }), timeout]); } catch (error) { throw normalizeFailure(error, item); } finally { clearTimeout(timer); } }
  for (const item of initial) register(item);
  return Object.freeze({ register, get, list, select: (id) => publicMetadata(select(id)), invoke, healthCheck });
}
