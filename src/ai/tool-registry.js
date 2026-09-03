import { AI_ACCESS_MODES, AI_ENABLED_ACCESS_MODES } from './contracts.js';

function validSchema(schema) { return schema && typeof schema === 'object' && !Array.isArray(schema) && typeof schema.type === 'string'; }

export function defineAITool(input) {
  const name = input?.name ?? input?.id;
  const operationType = input?.operationType ?? input?.accessMode;
  if (!name || !input?.description || !input?.capabilityId) throw new Error('AI tool requires name, description, and capabilityId');
  if (!AI_ACCESS_MODES.includes(operationType)) throw new Error(`Invalid AI tool operation type: ${operationType}`);
  if (!validSchema(input.inputSchema) || !validSchema(input.outputSchema)) throw new Error('AI tool requires valid input and output schemas');
  const requiredPermissions = input.requiredPermissions ?? (input.requiredPermission ? [input.requiredPermission] : []);
  if (!requiredPermissions.length) throw new Error('AI tool requires permission metadata');
  const enabled = input.enabled === true;
  if (enabled && !AI_ENABLED_ACCESS_MODES.includes(operationType)) throw new Error(`AI ${operationType} tools cannot be enabled at this stage`);
  if (enabled && !['productionDataOnly', 'schoolScoped', 'dataQualityAware', 'auditRequired'].every((field) => typeof input[field] === 'boolean')) throw new Error('Enabled AI tool requires explicit production, school, data-quality, and audit policies');
  if (enabled && input.productionDataOnly !== true) throw new Error('Enabled operational AI tool must be production-only');
  return Object.freeze({
    id: name,
    name,
    description: input.description,
    capabilityId: input.capabilityId,
    requiredPermission: requiredPermissions[0],
    requiredPermissions: Object.freeze([...requiredPermissions]),
    inputSchema: Object.freeze({ ...input.inputSchema }),
    outputSchema: Object.freeze({ ...input.outputSchema }),
    operationType,
    accessMode: operationType,
    schoolScoped: input.schoolScoped !== false,
    schoolScope: input.schoolScoped === false ? 'NONE' : input.schoolScope ?? 'AUTHENTICATED_SCHOOL',
    productionDataOnly: input.productionDataOnly ?? input.productionDataRequired ?? true,
    productionDataRequired: input.productionDataOnly ?? input.productionDataRequired ?? true,
    dataQualityAware: input.dataQualityAware !== false,
    auditRequired: input.auditRequired !== false,
    auditClassification: input.auditClassification ?? 'STANDARD',
    enabled,
    handler: input.handler ?? null
  });
}

export function createAIToolRegistry(initial = []) {
  const tools = new Map();
  function register(input) { const tool = defineAITool(input); if (tools.has(tool.name)) throw new Error(`AI tool already registered: ${tool.name}`); tools.set(tool.name, tool); return tool; }
  function get(id) { return tools.get(id) ?? null; }
  function list({ enabledOnly = false } = {}) { return [...tools.values()].filter((tool) => !enabledOnly || tool.enabled); }
  for (const tool of initial) register(tool);
  return Object.freeze({ register, get, list });
}
