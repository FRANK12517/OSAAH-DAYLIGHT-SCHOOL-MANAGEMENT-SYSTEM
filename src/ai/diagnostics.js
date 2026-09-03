function diagnosticAccess({ actor, environment, canAccess }) {
  if (!actor) return false;
  if (environment === 'development' || environment === 'test') return true;
  return typeof canAccess === 'function' && canAccess(actor, 'ai.diagnostics.read');
}

export function buildAIRegistryDiagnostics({ actor, environment = process.env.NODE_ENV ?? 'development', canAccess, modules = [], capabilityRegistry, toolRegistry, validationErrors = [] }) {
  if (!diagnosticAccess({ actor, environment, canAccess })) throw new Error('AI registry diagnostics are forbidden');
  return Object.freeze({
    environment,
    modules: Object.freeze(modules.map((module) => Object.freeze({ id: module.moduleId ?? module.moduleKey ?? module.id, name: module.moduleName ?? module.name, category: module.category, route: module.route, requiredPermissions: Object.freeze([...(module.requiredPermissions ?? (module.requiredPermission ? [module.requiredPermission] : module.permissions ?? []))]) }))),
    capabilities: Object.freeze((capabilityRegistry?.list() ?? []).map((capability) => Object.freeze({ id: capability.id, moduleId: capability.moduleId, version: capability.version, enabled: capability.enabled, health: capability.health, healthReason: capability.healthReason }))),
    enabledTools: Object.freeze((toolRegistry?.list({ enabledOnly: true }) ?? []).map((tool) => Object.freeze({ name: tool.name, capabilityId: tool.capabilityId, operationType: tool.operationType, requiredPermission: tool.requiredPermission }))),
    validationErrors: Object.freeze(validationErrors.map((error) => Object.freeze({ code: error.code ?? 'REGISTRATION_ERROR', message: error.message ?? String(error) })))
  });
}
