import { AIProvider, AIProviderError, AI_PROVIDER_ERRORS, normalizeAIProviderResponse, validateAIProviderRequest } from './provider.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';
function providerError(code, message, provider, model) { return new AIProviderError(code, message, { provider, model }); }
function parseArguments(value, provider, model) { try { const parsed = JSON.parse(value ?? '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw providerError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider returned invalid tool arguments', provider, model); } }
function toolDefinition(tool) { return { type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false }; }
function outputText(value) { if (typeof value.output_text === 'string') return value.output_text; return (value.output ?? []).flatMap((item) => item?.type === 'message' ? item.content ?? [] : []).filter((item) => item?.type === 'output_text').map((item) => item.text).join('') || null; }

export class OpenAIResponsesProvider extends AIProvider {
  #apiKey; #fetch;
  constructor({ apiKey, modelId, fetchImpl = globalThis.fetch } = {}) { super({ providerId: 'openai', modelId }); this.#apiKey = apiKey; this.#fetch = fetchImpl; }
  #configured() { return typeof this.#apiKey === 'string' && this.#apiKey.length > 0 && typeof this.modelId === 'string' && this.modelId.length > 0 && typeof this.#fetch === 'function'; }
  async generate(input, { signal } = {}) {
    const request = validateAIProviderRequest(input);
    if (!this.#configured()) throw providerError(AI_PROVIDER_ERRORS.CONFIGURATION, 'AI provider configuration is incomplete', this.providerId, this.modelId);
    const body = { model: this.modelId, store: false, max_output_tokens: request.maxOutputTokens, input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ query: request.query, schoolContext: request.schoolContext ?? null, toolResults: request.toolResults ?? [], requestId: request.requestId, correlationId: request.correlationId }) }] }], tools: (request.toolDefinitions ?? []).map(toolDefinition) };
    let response;
    try { response = await this.#fetch(ENDPOINT, { method: 'POST', signal, headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': request.requestId }, body: JSON.stringify(body) }); }
    catch (cause) { if (signal?.aborted) throw providerError(AI_PROVIDER_ERRORS.TIMEOUT, 'AI provider request timed out', this.providerId, this.modelId); throw new AIProviderError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'AI provider is unavailable', { provider: this.providerId, model: this.modelId, cause }); }
    if (response.status === 401 || response.status === 403) throw providerError(AI_PROVIDER_ERRORS.CONFIGURATION, 'AI provider credential was rejected', this.providerId, this.modelId);
    if (response.status === 429) { const error = providerError(AI_PROVIDER_ERRORS.RATE_LIMITED, 'AI provider rate limit reached', this.providerId, this.modelId); error.status = 429; throw error; }
    if (!response.ok) throw providerError(AI_PROVIDER_ERRORS.UNAVAILABLE, 'AI provider is unavailable', this.providerId, this.modelId);
    let value; try { value = await response.json(); } catch { throw providerError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider returned an invalid response', this.providerId, this.modelId); }
    const toolRequests = (value.output ?? []).filter((item) => item?.type === 'function_call').map((item) => Object.freeze({ id: item.call_id ?? item.id, name: item.name, arguments: parseArguments(item.arguments, this.providerId, this.modelId) }));
    const finishStatus = toolRequests.length ? 'TOOL_REQUESTS' : value.status === 'completed' ? 'STOP' : value.status === 'incomplete' ? 'LENGTH' : value.status === 'failed' ? 'ERROR' : null;
    if (!finishStatus) throw providerError(AI_PROVIDER_ERRORS.INVALID_RESPONSE, 'Provider returned an invalid response', this.providerId, this.modelId);
    return normalizeAIProviderResponse({ text: outputText(value), toolRequests, finishStatus, usage: { inputTokens: value.usage?.input_tokens, outputTokens: value.usage?.output_tokens, totalTokens: value.usage?.total_tokens }, error: value.error?.code ?? null }, { provider: this.providerId, model: this.modelId, latencyMs: 0 });
  }
  async toolCall(input, options) { return this.generate(input, options); }
  async healthCheck({ signal } = {}) {
    if (!this.#configured()) return Object.freeze({ configured: false, healthy: false, reason: AI_PROVIDER_ERRORS.CONFIGURATION });
    try { const response = await this.#fetch(`${ENDPOINT.replace('/responses', '/models')}/${encodeURIComponent(this.modelId)}`, { signal, headers: { Authorization: `Bearer ${this.#apiKey}` } }); return Object.freeze({ configured: true, healthy: response.ok, reason: response.ok ? null : response.status === 401 || response.status === 403 ? AI_PROVIDER_ERRORS.CONFIGURATION : AI_PROVIDER_ERRORS.UNAVAILABLE }); }
    catch { return Object.freeze({ configured: true, healthy: false, reason: AI_PROVIDER_ERRORS.UNAVAILABLE }); }
  }
}
