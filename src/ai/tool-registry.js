import { AI_ACCESS_MODES } from './contracts.js';

export function defineAITool(input) {
  if (!input?.id || !input?.description || !input?.capabilityId) throw new Error('AI tool requires id, description, and capabilityId');
  if (!AI_ACCESS_MODES.includes(input.accessMode)) throw new Error(`Invalid AI tool access mode: ${input.accessMode}`);
  if (!input.inputSchema || !input.outputSchema) throw new Error('AI tool requires input and output schemas');
  return Object.freeze({
    id: input.id,
    description: input.description,
    capabilityId: input.capabilityId,
    requiredPermissions: Object.freeze([...(input.requiredPermissions ?? [])]),
    inputSchema: Object.freeze({ ...input.inputSchema }),
    outputSchema: Object.freeze({ ...input.outputSchema }),
    schoolScope: input.schoolScope ?? 'AUTHENTICATED_SCHOOL',
    productionDataRequired: input.productionDataRequired !== false,
    auditClassification: input.auditClassification ?? 'STANDARD',
    accessMode: input.accessMode,
    enabled: input.enabled === true,
    handler: input.handler ?? null
  });
}

export function createAIToolRegistry(initial = []) {
  const tools = new Map();
  function register(input) { const tool = defineAITool(input); if (tools.has(tool.id)) throw new Error(`AI tool already registered: ${tool.id}`); if (tool.accessMode === 'WRITE' && tool.enabled) throw new Error('AI write tools cannot be enabled before the Controlled Action phase'); tools.set(tool.id, tool); return tool; }
  function get(id) { return tools.get(id) ?? null; }
  function list({ enabledOnly = false } = {}) { return [...tools.values()].filter((tool) => !enabledOnly || tool.enabled); }
  for (const tool of initial) register(tool);
  return Object.freeze({ register, get, list });
}
