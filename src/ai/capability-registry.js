const VERSION = /^\d+\.\d+\.\d+$/;

function freezeList(value) { return Object.freeze([...(value ?? [])]); }

export function defineAICapability(input) {
  if (!input?.moduleId || !input?.moduleName || !input?.category || !input?.dataDomain) throw new Error('AI capability requires moduleId, moduleName, category, and dataDomain');
  if (!VERSION.test(input.version ?? '')) throw new Error('AI capability version must use semantic versioning');
  if (input.aiEnabled === false && !input.disabledReason) throw new Error('Disabled AI capability requires a reason');
  return Object.freeze({
    moduleId: input.moduleId,
    moduleName: input.moduleName,
    category: input.category,
    aiEnabled: input.aiEnabled !== false,
    disabledReason: input.disabledReason ?? null,
    version: input.version,
    requiredPermissions: freezeList(input.requiredPermissions),
    dataDomain: input.dataDomain,
    availableTools: freezeList(input.availableTools),
    supportedMetrics: freezeList(input.supportedMetrics),
    supportedReports: freezeList(input.supportedReports),
    supportedActions: freezeList(input.supportedActions),
    dashboardIntelligence: Boolean(input.dashboardIntelligence),
    productionDataRules: freezeList(input.productionDataRules),
    dataQualityRequirements: freezeList(input.dataQualityRequirements),
    auditRequirements: freezeList(input.auditRequirements)
  });
}

export function createAICapabilityRegistry(initial = []) {
  const capabilities = new Map();
  function register(input) { const capability = defineAICapability(input); if (capabilities.has(capability.moduleId)) throw new Error(`AI capability already registered: ${capability.moduleId}`); capabilities.set(capability.moduleId, capability); return capability; }
  function get(moduleId) { return capabilities.get(moduleId) ?? null; }
  function list({ enabledOnly = false } = {}) { return [...capabilities.values()].filter((item) => !enabledOnly || item.aiEnabled); }
  for (const capability of initial) register(capability);
  return Object.freeze({ register, get, list });
}
