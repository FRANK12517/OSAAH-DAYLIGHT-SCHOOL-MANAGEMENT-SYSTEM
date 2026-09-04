export const AI_PROVIDER_ERRORS = Object.freeze({ DISABLED: 'PROVIDER_DISABLED', UNAVAILABLE: 'PROVIDER_UNAVAILABLE', TIMEOUT: 'PROVIDER_TIMEOUT', RATE_LIMITED: 'PROVIDER_RATE_LIMITED', INVALID_RESPONSE: 'PROVIDER_INVALID_RESPONSE', CONFIGURATION: 'PROVIDER_CONFIGURATION_ERROR' });
const FINISH_STATUSES = new Set(['STOP', 'TOOL_REQUESTS', 'LENGTH', 'CONTENT_FILTER', 'ERROR']);
const REQUEST_FIELDS = new Set(['query', 'schoolContext', 'toolDefinitions', 'toolResults', 'requestId', 'correlationId', 'maxOutputTokens']);
const SECRET_KEY = /(^|_)(api_?key|password|secret|authorization|auth_?token|access_?token|refresh_?token|cookie|database_?url|db_?url|connection_?string|session|database|db_?handle)($|_)/i;

export class AIProviderError extends Error {
  constructor(code, message, { provider = null, model = null, cause } = {}) { super(message, cause ? { cause } : undefined); this.name = 'AIProviderError'; this.code = code; this.provider = provider; this.model = model; }
  toJSON() { return { error: this.code, message: this.message, provider: this.provider, model: this.model }; }
}
function configurationError(message) { return new AIProviderError(AI_PROVIDER_ERRORS.CONFIGURATION, message); }
function plain(value) { return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function safeClone(value, path = 'request') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item, index) => safeClone(item, `${path}[${index}]`)));
  if (!plain(value)) throw configurationError(`${path} must contain only serializable data`);
  const copy = {};
  for (const [key, item] of Object.entries(value)) { if (SECRET_KEY.test(key)) throw configurationError(`${path} contains a prohibited sensitive field`); if (item !== undefined) copy[key] = safeClone(item, `${path}.${key}`); }
  return Object.freeze(copy);
}
export function validateAIProviderRequest(input) {
  if (!plain(input)) throw configurationError('Provider request must be a plain object');
  for (const key of Object.keys(input)) if (!REQUEST_FIELDS.has(key)) throw configurationError(`Provider request field is not approved: ${key}`);
  if (typeof input.query !== 'string' || !input.query.trim()) throw configurationError('Provider request requires an authorized query');
  if (!input.requestId || !input.correlationId) throw configurationError('Provider request requires request and correlation IDs');
  return safeClone(input);
}
function normalizeUsage(value = {}) {
  if (!plain(value)) throw new AIProviderError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider usage metadata is invalid');
  const result = {}; for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) { if (value[key] != null && (!Number.isInteger(value[key]) || value[key] < 0)) throw new AIProviderError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider usage metadata is invalid'); result[key] = value[key] ?? null; }
  return Object.freeze(result);
}
export function normalizeAIProviderResponse(value, { provider, model, latencyMs = 0 } = {}) {
  if (!plain(value) || (value.text !== undefined && value.text !== null && typeof value.text !== 'string') || !Array.isArray(value.toolRequests ?? []) || (value.error !== undefined && value.error !== null && typeof value.error !== 'string')) throw new AIProviderError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider returned an invalid response', { provider, model });
  const finishStatus = value.finishStatus ?? ((value.toolRequests?.length ?? 0) ? 'TOOL_REQUESTS' : 'STOP');
  if (!FINISH_STATUSES.has(finishStatus) || !Number.isFinite(latencyMs) || latencyMs < 0) throw new AIProviderError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider returned an invalid response', { provider, model });
  return Object.freeze({ text: value.text ?? null, toolRequests: safeClone(value.toolRequests ?? [], 'toolRequests'), finishStatus, provider, model, usage: normalizeUsage(value.usage), latencyMs, error: value.error ?? null });
}
export function providerAuditMetadata(response, requestStatus = 'SUCCESS') { return Object.freeze({ provider: response.provider, model: response.model, latencyMs: response.latencyMs, requestStatus, tokenUsage: response.usage }); }

export class AIProvider {
  constructor({ providerId = 'disabled', modelId = 'none' } = {}) { this.providerId = providerId; this.modelId = modelId; }
  async generate() { throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'No AI provider is configured', { provider: this.providerId, model: this.modelId }); }
  async stream() { throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'No AI provider is configured', { provider: this.providerId, model: this.modelId }); }
  async toolCall() { throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'No AI provider is configured', { provider: this.providerId, model: this.modelId }); }
  async healthCheck() { return Object.freeze({ configured: false, healthy: false, reason: 'NO_PROVIDER_CONFIGURED' }); }
}
export class DisabledAIProvider extends AIProvider {
  async generate() { throw new AIProviderError(AI_PROVIDER_ERRORS.DISABLED, 'AI provider is disabled', { provider: this.providerId, model: this.modelId }); }
  async stream() { return this.generate(); } async toolCall() { return this.generate(); }
  async healthCheck() { return Object.freeze({ configured: true, healthy: false, reason: AI_PROVIDER_ERRORS.DISABLED }); }
}
export class DeterministicMockAIProvider extends AIProvider {
  constructor({ providerId = 'mock', modelId = 'deterministic-v1', response } = {}) { super({ providerId, modelId }); this.response = response ?? { text: 'Deterministic mock response.', toolRequests: [], finishStatus: 'STOP', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; }
  async generate(input) { validateAIProviderRequest(input); return normalizeAIProviderResponse(this.response, { provider: this.providerId, model: this.modelId, latencyMs: 0 }); }
  async toolCall(input) { return this.generate(input); }
  async *stream(input) { const result = await this.generate(input); if (result.text !== null) yield Object.freeze({ text: result.text }); }
  async healthCheck() { return Object.freeze({ configured: true, healthy: true, reason: null }); }
}
