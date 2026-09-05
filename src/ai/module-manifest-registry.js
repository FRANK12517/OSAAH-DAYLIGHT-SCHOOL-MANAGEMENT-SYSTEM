const VERSION = /^\d+\.\d+\.\d+$/;

function list(value) { return Object.freeze([...(value ?? [])]); }

export function defineOSAAHModuleManifest(input) {
  if (!input?.id || !input?.name || !input?.category || !input?.route) throw new Error('OSAAH module manifest requires id, name, category, and route');
  if (!VERSION.test(input.version ?? '')) throw new Error('OSAAH module version must use semantic versioning');
  if (!input.route.startsWith('/')) throw new Error('OSAAH module route must be absolute');
  if (!Array.isArray(input.permissions) || !input.permissions.length) throw new Error('OSAAH module manifest requires explicit permission metadata');
  if (!input.audit || typeof input.audit.required !== 'boolean') throw new Error('OSAAH module manifest requires an audit policy');
  if (!input.productionData || !input.productionData.classification) throw new Error('OSAAH module manifest requires a production-data policy');
  const ai = input.ai ?? { enabled: false, disabledReason: 'AI eligibility has not been evaluated.' };
  if (ai.enabled !== true && !ai.disabledReason) throw new Error('AI-disabled module requires a reason');
  if (ai.enabled === true) {
    if (!ai.capabilityId) throw new Error('AI-enabled module requires a capabilityId');
    if (!Array.isArray(ai.tools) || !ai.tools.length) throw new Error('AI-enabled module requires registered tools');
    if (ai.productionDataOnly !== true || ai.dataQualityAware !== true) throw new Error('AI-enabled module requires production-only and data-quality-aware metadata');
  }
  return Object.freeze({
    id: input.id,
    name: input.name,
    version: input.version,
    category: input.category,
    route: input.route,
    sidebarPlacement: Object.freeze({ order: input.sidebarPlacement?.order ?? 1000, parentModule: input.sidebarPlacement?.parentModule ?? null, visible: input.sidebarPlacement?.visible !== false, roles: list(input.sidebarPlacement?.roles) }),
    permissions: list(input.permissions),
    ai: Object.freeze({ enabled: false, health: ai.enabled === true ? 'ACTIVE' : 'DISABLED', tools: Object.freeze([]), reports: Object.freeze([]), metrics: Object.freeze([]), supportedActions: Object.freeze([]), dashboardMetrics: Object.freeze([]), exceptionProviders: Object.freeze([]), dataQualityRules: Object.freeze([]), knowledgeSources: Object.freeze([]), productionDataOnly: true, dataQualityAware: true, ...ai, tools: list(ai.tools), reports: list(ai.reports), metrics: list(ai.metrics), supportedActions: list(ai.supportedActions), dashboardMetrics: list(ai.dashboardMetrics), exceptionProviders: list(ai.exceptionProviders), dataQualityRules: list(ai.dataQualityRules), knowledgeSources: list(ai.knowledgeSources) }),
    metrics: list(input.metrics),
    audit: Object.freeze({ ...input.audit }),
    productionData: Object.freeze({ ...input.productionData }),
    dependencies: list(input.dependencies),
    regressionTests: list(input.regressionTests)
  });
}

export function createOSAAHModuleManifestRegistry({ onNavigation, onAI } = {}) {
  const manifests = new Map();
  function register(input) {
    const manifest = defineOSAAHModuleManifest(input);
    if (manifests.has(manifest.id)) throw new Error(`OSAAH module manifest already registered: ${manifest.id}`);
    manifests.set(manifest.id, manifest);
    onNavigation?.(manifest);
    if (manifest.ai.enabled) onAI?.(manifest);
    return manifest;
  }
  function get(id) { return manifests.get(id) ?? null; }
  function listManifests() { return [...manifests.values()]; }
  return Object.freeze({ register, get, list: listManifests });
}
