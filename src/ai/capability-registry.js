const VERSION = /^\d+\.\d+\.\d+$/;

function freezeList(value) { return Object.freeze([...(value ?? [])]); }
function assertStringList(name, value) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`AI capability ${name} must be a list of non-empty strings`); }

export function defineAICapability(input, { knownModuleIds } = {}) {
  if (!input?.id || !input?.moduleId || !input?.moduleName || !input?.category || !input?.dataDomain || !input?.description) throw new Error('AI capability requires id, moduleId, moduleName, category, dataDomain, and description');
  if (!VERSION.test(input.version ?? '')) throw new Error('AI capability version must use semantic versioning');
  const enabled = input.enabled ?? input.aiEnabled ?? false;
  if (!enabled && !(input.disabledReason ?? input.reason)) throw new Error('Disabled AI capability requires a reason');
  if (knownModuleIds && !knownModuleIds.has(input.moduleId)) throw new Error(`Unknown OSAAH module reference: ${input.moduleId}`);
  const tools = input.tools ?? input.availableTools ?? [];
  const metrics = input.metrics ?? input.supportedMetrics ?? [];
  const reports = input.reports ?? input.supportedReports ?? [];
  const actions = input.actions ?? input.supportedActions ?? [];
  for (const [field, value] of Object.entries({ requiredPermissions: input.requiredPermissions ?? [], requiredRoles: input.requiredRoles ?? [], tools, metrics, reports, actions, dashboardWidgets: input.dashboardWidgets ?? [], dataQualityRequirements: input.dataQualityRequirements ?? [] })) assertStringList(field, value);
  if (enabled && !(tools.length || metrics.length)) throw new Error('Enabled AI capability requires at least one tool or metric');
  if (enabled && !(input.requiredPermissions?.length)) throw new Error('Enabled AI capability requires permission metadata');
  return Object.freeze({
    id: input.id,
    moduleId: input.moduleId,
    moduleName: input.moduleName,
    category: input.category,
    enabled,
    aiEnabled: enabled,
    disabledReason: input.disabledReason ?? input.reason ?? null,
    version: input.version,
    description: input.description,
    requiredPermissions: freezeList(input.requiredPermissions),
    requiredRoles: freezeList(input.requiredRoles),
    dataDomain: input.dataDomain,
    tools: freezeList(tools),
    metrics: freezeList(metrics),
    reports: freezeList(reports),
    actions: freezeList(actions),
    dashboardWidgets: freezeList(input.dashboardWidgets),
    availableTools: freezeList(tools),
    supportedMetrics: freezeList(metrics),
    supportedReports: freezeList(reports),
    supportedActions: freezeList(actions),
    dashboardIntelligence: Boolean(input.dashboardIntelligence ?? input.dashboardWidgets?.length),
    productionDataOnly: input.productionDataOnly !== false,
    productionDataRules: freezeList(input.productionDataRules),
    dataQualityRequirements: freezeList(input.dataQualityRequirements),
    auditRequired: input.auditRequired !== false,
    auditRequirements: freezeList(input.auditRequirements)
  });
}

export function createAICapabilityRegistry(initial = [], options = {}) {
  const capabilities = new Map();
  const moduleIds = new Set();
  function register(input) { const capability = defineAICapability(input, options); if (capabilities.has(capability.id)) throw new Error(`AI capability already registered: ${capability.id}`); if (moduleIds.has(capability.moduleId)) throw new Error(`OSAAH module already has an AI capability: ${capability.moduleId}`); capabilities.set(capability.id, capability); moduleIds.add(capability.moduleId); return capability; }
  function get(id) { return capabilities.get(id) ?? null; }
  function getByModule(moduleId) { return [...capabilities.values()].find((item) => item.moduleId === moduleId) ?? null; }
  function list({ enabledOnly = false } = {}) { return [...capabilities.values()].filter((item) => !enabledOnly || item.enabled); }
  for (const capability of initial) register(capability);
  return Object.freeze({ register, get, getByModule, list });
}
