import { createAIAuthorizationContext, createAIAuthorizationGuard, AIAuthorizationError } from './authorization-guard.js';

function minimize(value, schema) {
  if (value === null || value === undefined) return value;
  if (schema?.type === 'array') return Array.isArray(value) ? value.map((item) => minimize(item, schema.items)) : [];
  if (schema?.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return value;
  const properties = schema.properties ?? {};
  return Object.freeze(Object.fromEntries(Object.entries(properties).filter(([key]) => Object.hasOwn(value, key)).map(([key, child]) => [key, minimize(value[key], child)])));
}

export async function executeAuthorizedAITool({ authenticatedUser, toolName, input = {}, capabilityRegistry, toolRegistry, productionDataGuard, additionalCapabilityIds = [] }) {
  const context = createAIAuthorizationContext(authenticatedUser);
  const guard = createAIAuthorizationGuard({ capabilityRegistry, toolRegistry });
  const authorization = guard.authorizeTool(context, toolName, input, { additionalCapabilityIds });
  if (typeof authorization.tool.handler !== 'function') throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
  if (authorization.tool.productionDataOnly && !productionDataGuard) throw new AIAuthorizationError('TOOL_NOT_ALLOWED');
  const raw = await authorization.tool.handler(Object.freeze({ input: Object.freeze({ ...input, schoolId: context.schoolId }), authorization }));
  const guarded = authorization.tool.productionDataOnly ? productionDataGuard.sanitize(Array.isArray(raw) ? raw : raw?.records ?? [], { productionOnly: true }) : null;
  const value = Array.isArray(raw) ? guarded.records : raw?.records ? { ...raw, records: guarded.records, quality: guarded.quality } : raw;
  return Object.freeze({ data: minimize(value, authorization.tool.outputSchema), quality: guarded?.quality ?? null, authorization: Object.freeze({ capabilityId: authorization.capability.id, toolName: authorization.tool.name, scope: authorization.scope }) });
}
