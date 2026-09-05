import { DisabledAIProvider, AIProviderError, AI_PROVIDER_ERRORS } from './provider.js';
import { OpenAIResponsesProvider } from './openai-provider.js';
import { createAIProviderRegistry } from './provider-registry.js';

export const OSAAH_AI_GLOBAL_ENABLE_ENV = 'OSAAH_AI_ENABLED';

export const OSAAH_AI_PROVIDER_ENV = Object.freeze(['OSAAH_AI_PROVIDER_ID', 'OSAAH_AI_MODEL_ID', 'OSAAH_AI_API_KEY', 'OSAAH_AI_PROVIDER_ENABLED', 'OSAAH_AI_PROVIDER_TIMEOUT_MS', 'OSAAH_AI_PROVIDER_RETRY_LIMIT', 'OSAAH_AI_MAX_OUTPUT_TOKENS']);
function integer(value, fallback, name, { minimum = 0 } = {}) { if (value === undefined || value === '') return fallback; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < minimum) throw new AIProviderError(AI_PROVIDER_ERRORS.CONFIGURATION, `${name} must be an integer of at least ${minimum}`); return parsed; }
function enabled(value) { return String(value ?? 'false').toLowerCase() === 'true'; }

export function createConfiguredAIProviderRegistry({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const providerId = env.OSAAH_AI_PROVIDER_ID ?? 'openai', modelId = env.OSAAH_AI_MODEL_ID ?? '';
  const globalEnabled = String(env.OSAAH_AI_ENABLED ?? 'true').toLowerCase() !== 'false';
  const isEnabled = globalEnabled && enabled(env.OSAAH_AI_PROVIDER_ENABLED), timeoutMs = integer(env.OSAAH_AI_PROVIDER_TIMEOUT_MS, 30000, 'OSAAH_AI_PROVIDER_TIMEOUT_MS', { minimum: 1 });
  const retryLimit = integer(env.OSAAH_AI_PROVIDER_RETRY_LIMIT, 1, 'OSAAH_AI_PROVIDER_RETRY_LIMIT'); const maxOutputTokens = integer(env.OSAAH_AI_MAX_OUTPUT_TOKENS, 1024, 'OSAAH_AI_MAX_OUTPUT_TOKENS', { minimum: 1 });
  if (providerId !== 'openai') throw new AIProviderError(AI_PROVIDER_ERRORS.CONFIGURATION, 'Configured AI provider is not approved');
  if (isEnabled && (!modelId || !env.OSAAH_AI_API_KEY)) throw new AIProviderError(AI_PROVIDER_ERRORS.CONFIGURATION, 'Enabled AI provider requires model and server credential');
  const provider = isEnabled ? new OpenAIResponsesProvider({ apiKey: env.OSAAH_AI_API_KEY, modelId, fetchImpl }) : new DisabledAIProvider({ providerId, modelId: modelId || 'unconfigured' });
  const registry = createAIProviderRegistry([{ providerId, modelId: modelId || 'unconfigured', enabled: isEnabled, timeoutMs, retryLimit, maxOutputTokens, healthState: isEnabled ? 'UNKNOWN' : 'UNAVAILABLE', provider }]);
  return Object.freeze({ registry, providerId, enabled: isEnabled, globalEnabled });
}
