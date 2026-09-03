const VERSION = /^\d+\.\d+\.\d+$/;
const HEALTH = new Set(['ACTIVE', 'DISABLED', 'DEGRADED', 'UNAVAILABLE']);

function freezeList(value) { return Object.freeze([...(value ?? [])]); }
function assertStringList(name, value) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`AI capability ${name} must be a list of non-empty strings`); }

export function defineAICapability(input, { knownModuleIds, knownRoleIds } = {}) {
  if (!input?.id || !input?.moduleId || !input?.moduleName || !input?.category || !input?.dataDomain || !input?.description) throw new Error('AI capability requires id, moduleId, moduleName, category, dataDomain, and description');
  if (!VERSION.test(input.version ?? '')) throw new Error('AI capability version must use semantic versioning');
  const enabled = input.enabled ?? input.aiEnabled ?? false;
  const health = input.health ?? (enabled ? 'ACTIVE' : 'DISABLED');
  if (!HEALTH.has(health)) throw new Error(`Invalid AI capability health: ${health}`);
  if (!enabled && health === 'ACTIVE') throw new Error('Disabled AI capability cannot be ACTIVE');
  if (!enabled && !(input.disabledReason ?? input.reason)) throw new Error('Disabled AI capability requires a reason');
  if (knownModuleIds && !knownModuleIds.has(input.moduleId)) throw new Error(`Unknown OSAAH module reference: ${input.moduleId}`);
  const tools = input.tools ?? input.availableTools ?? [];
  const metrics = input.metrics ?? input.supportedMetrics ?? [];
  const reports = input.reports ?? input.supportedReports ?? [];
  const actions = input.actions ?? input.supportedActions ?? [];
  for (const [field, value] of Object.entries({ requiredPermissions: input.requiredPermissions ?? [], requiredRoles: input.requiredRoles ?? [], tools, metrics, reports, actions, dashboardWidgets: input.dashboardWidgets ?? [], dataQualityRequirements: input.dataQualityRequirements ?? [] })) assertStringList(field, value);
  if (knownRoleIds) for (const role of input.requiredRoles ?? []) if (!knownRoleIds.has(role)) throw new Error(`Unsupported AI capability role: ${role}`);
  if (enabled && !(tools.length || metrics.length)) throw new Error('Enabled AI capability requires at least one tool or metric');
  if (enabled && !(input.requiredPermissions?.length)) throw new Error('Enabled AI capability requires permission metadata');
  if (enabled && input.productionDataOnly !== false && (input.provenanceAware !== true || input.dataQualityAware !== true)) throw new Error('Enabled production AI capability requires provenance and data-quality protection');
  return Object.freeze({
    id: input.id,
    moduleId: input.moduleId,
    moduleName: input.moduleName,
    category: input.category,
    enabled,
    aiEnabled: enabled,
    health,
    healthReason: input.healthReason ?? input.disabledReason ?? input.reason ?? null,
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
    provenanceAware: input.provenanceAware === true,
    dataQualityAware: input.dataQualityAware === true,
    productionDataRules: freezeList(input.productionDataRules),
    dataQualityRequirements: freezeList(input.dataQualityRequirements),
    auditRequired: input.auditRequired !== false,
    auditRequirements: freezeList(input.auditRequirements)
  });
}

export function createAICapabilityRegistry(initial = [], options = {}) {
  const capabilities = new Map();
  function key(capability) { return `${capability.id}@${capability.version.split('.')[0]}`; }
  function register(input) { const capability = defineAICapability(input, options); const registrationKey = key(capability); if (capabilities.has(registrationKey)) throw new Error(`AI capability version already registered: ${registrationKey}`); capabilities.set(registrationKey, capability); return capability; }
  function versionsFor(id) { return [...capabilities.values()].filter((item) => item.id === id).sort((a, b) => Number(b.version.split('.')[0]) - Number(a.version.split('.')[0])); }
  function get(id) { if (id.includes('@')) return capabilities.get(id) ?? null; return versionsFor(id)[0] ?? null; }
  function getByModule(moduleId, { version } = {}) { const matches = [...capabilities.values()].filter((item) => item.moduleId === moduleId); return version ? matches.find((item) => item.version === version) ?? null : matches.sort((a, b) => Number(b.version.split('.')[0]) - Number(a.version.split('.')[0]))[0] ?? null; }
  function setHealth(id, health, reason = null) { if (!HEALTH.has(health)) throw new Error(`Invalid AI capability health: ${health}`); const current = get(id); if (!current) throw new Error(`AI capability not found: ${id}`); const updated = Object.freeze({ ...current, health, healthReason: reason }); capabilities.set(key(current), updated); return updated; }
  function list({ enabledOnly = false } = {}) { return [...capabilities.values()].filter((item) => !enabledOnly || item.enabled); }
  for (const capability of initial) register(capability);
  return Object.freeze({ register, get, getByModule, list, setHealth });
}
