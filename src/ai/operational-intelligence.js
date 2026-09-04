import { createAIDataQualityGuard } from './data-quality-guard.js';
import { createProductionDataGuard } from './production-data-guard.js';

const READ_ONLY = new Set(['READ', 'ANALYZE']);
const TERMINAL_PROCUREMENT = new Set(['RECEIVED', 'INVOICED', 'PAID', 'REJECTED']);
const TERMINAL_MAINTENANCE = new Set(['COMPLETED', 'CANCELLED']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const actorCan = (actor, permission) => Boolean(actor?.id && actor?.schoolId && actor.permissions instanceof Set && (actor.permissions.has('*') || actor.permissions.has(permission)));
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };

function defineProvider(input) {
  if (!input?.moduleId || !input.capabilityId || !input.requiredPermissions?.length) throw new Error('Operational analytics provider requires module, capability, and permission metadata.');
  if (input.productionDataOnly !== true || typeof input.calculate !== 'function') throw new Error('Operational analytics providers must be production-only and deterministic.');
  if (!Array.isArray(input.supportedMetrics) || !input.supportedMetrics.length) throw new Error('Operational analytics provider requires supported metrics.');
  return Object.freeze({ aiEnabled: false, dashboardMetrics: [], exceptionRules: [], health: 'ACTIVE', dataQualityRules: [], ...input, requiredPermissions: Object.freeze([...input.requiredPermissions]), supportedMetrics: Object.freeze([...input.supportedMetrics]), dashboardMetrics: Object.freeze([...(input.dashboardMetrics ?? [])]), exceptionRules: Object.freeze([...(input.exceptionRules ?? [])]), dataQualityRules: Object.freeze([...(input.dataQualityRules ?? [])]) });
}

export function createOperationalAnalyticsRegistry({ modules = [] } = {}) {
  const moduleMap = new Map(modules.map((module) => [module.moduleId ?? module.moduleKey, module]));
  const providers = new Map();
  function register(input) {
    const provider = defineProvider(input);
    const module = moduleMap.get(provider.moduleId);
    if (!module) throw new Error(`Unknown OSAAH module: ${provider.moduleId}`);
    if (providers.has(provider.capabilityId)) throw new Error(`Operational analytics capability already registered: ${provider.capabilityId}`);
    const registered = module.enabled === false || provider.enabled === false ? Object.freeze({ ...provider, health: 'DISABLED', aiEnabled: false }) : provider;
    providers.set(provider.capabilityId, registered);
    return registered;
  }
  const get = (id) => providers.get(id) ?? null;
  return Object.freeze({ register, get, list: () => [...providers.values()], modules: () => [...moduleMap.values()] });
}

export function createOperationalIntelligence({ registry, productionDataGuard = createProductionDataGuard({ environment: process.env.NODE_ENV }), dataQualityGuard = createAIDataQualityGuard(), now = () => new Date().toISOString(), explain = null } = {}) {
  if (!registry) throw new Error('Operational Intelligence requires an analytics registry.');
  async function snapshot({ actor, capabilityId, metricIds = null } = {}) {
    if (!actor?.id) fail('UNAUTHENTICATED', 'Authentication is required.', 401);
    const provider = registry.get(capabilityId);
    if (!provider) return Object.freeze({ capabilityId, status: 'UNSUPPORTED', metrics: {}, warnings: ['No validated analytics provider is registered for this module.'], indicators: [] });
    if (provider.health !== 'ACTIVE') return Object.freeze({ capabilityId, status: provider.health, metrics: {}, warnings: ['The operational capability is not currently active.'], indicators: [] });
    if (!provider.requiredPermissions.every((permission) => actorCan(actor, permission))) fail('PERMISSION_DENIED', 'Operational intelligence is unavailable for this role.', 403);
    const requested = metricIds ?? provider.supportedMetrics;
    if (!Array.isArray(requested) || requested.some((metric) => !provider.supportedMetrics.includes(metric))) fail('INVALID_REQUEST', 'Unknown operational metric requested.');
    const calculated = await provider.calculate({ actor, now: now() });
    const guarded = productionDataGuard.sanitize(calculated.records ?? [], { productionOnly: true });
    const scopedRecords = guarded.records.filter((row) => !row.schoolId || row.schoolId === actor.schoolId); const wrongSchoolCount = guarded.records.length - scopedRecords.length;
    const deterministic = provider.summarize(scopedRecords, { actor, now: now(), requestedMetrics: requested });
    const warnings = [...(deterministic.warnings ?? []), ...guarded.quality.issues, ...(wrongSchoolCount ? ['Records outside the authenticated school scope were excluded.'] : [])];
    const quality = (await dataQualityGuard.assess({ validated: true, valid: true, sourceAvailable: calculated.sourceAvailable !== false, sourceCount: scopedRecords.length, missingCount: (deterministic.missingCount ?? 0) + guarded.diagnostics.excludedCount + wrongSchoolCount, lastUpdatedAt: deterministic.lastUpdatedAt ?? null, assessedAt: now(), warnings })).quality;
    return Object.freeze({ capabilityId, moduleId: provider.moduleId, status: 'SUPPORTED', health: provider.health, metrics: Object.freeze(Object.fromEntries(Object.entries(deterministic.metrics ?? {}).filter(([key]) => requested.includes(key)))), generatedAt: now(), dataQuality: quality, warnings: quality.warnings, indicators: Object.freeze([...(deterministic.indicators ?? [])]), provider: Object.freeze({ productionDataOnly: true, deterministic: true, supportedMetrics: provider.supportedMetrics }) });
  }
  async function dashboard({ actor } = {}) {
    const cards = [];
    for (const provider of registry.list()) {
      if (provider.health !== 'ACTIVE' || !provider.dashboardMetrics.length || !provider.requiredPermissions.every((permission) => actorCan(actor, permission))) continue;
      const result = await snapshot({ actor, capabilityId: provider.capabilityId, metricIds: provider.dashboardMetrics });
      cards.push(result);
    }
    let explanation = null;
    try { explanation = explain ? await explain(cards) : null; } catch { explanation = null; }
    return Object.freeze({ cards: Object.freeze(cards), explanation, generatedAt: now() });
  }
  return Object.freeze({ snapshot, dashboard });
}

function countBy(records, field) { return Object.fromEntries([...new Set(records.map((row) => row[field] ?? 'UNSPECIFIED'))].map((value) => [value, records.filter((row) => (row[field] ?? 'UNSPECIFIED') === value).length])); }
function latest(records) { return records.map((row) => row.updatedAt ?? row.createdAt).filter(Boolean).sort().at(-1) ?? null; }

export function registerBuiltInOperationalProviders(registry, { operations, resources, communication } = {}) {
  const registered = [];
  const add = (provider) => { if (registry.modules().some((module) => (module.moduleId ?? module.moduleKey) === provider.moduleId && module.enabled !== false)) registered.push(registry.register(provider)); };
  if (operations) {
    add({ moduleId: 'transport', capabilityId: 'transport', requiredPermissions: ['transport.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['activeVehicles', 'activeRoutes', 'assignedStudents', 'unavailableVehicles', 'capacity', 'occupancy', 'serviceStatus'], dashboardMetrics: ['activeVehicles', 'activeRoutes', 'assignedStudents', 'unavailableVehicles'], dataQualityRules: ['PROVENANCE'], exceptionRules: ['VEHICLE_UNAVAILABLE', 'CAPACITY_EXCEEDED'], calculate: ({ actor }) => { const source = operations.list('TRANSPORT', actor); return { records: [...source.vehicles.map((row) => ({ ...row, recordType: 'VEHICLE' })), ...source.routes.map((row) => ({ ...row, recordType: 'ROUTE' })), ...source.assignments.map((row) => ({ ...row, recordType: 'ASSIGNMENT' }))] }; }, summarize: (records) => { const vehicles = records.filter((r) => r.recordType === 'VEHICLE'), routes = records.filter((r) => r.recordType === 'ROUTE'), assignments = records.filter((r) => r.recordType === 'ASSIGNMENT'); const unavailable = vehicles.filter((v) => v.status && v.status !== 'ACTIVE').length; return { metrics: { activeVehicles: vehicles.filter((v) => v.status === 'ACTIVE').length, activeRoutes: routes.filter((r) => r.status !== 'INACTIVE').length, assignedStudents: new Set(assignments.map((a) => a.studentId)).size, unavailableVehicles: unavailable, capacity: null, occupancy: null, serviceStatus: countBy(vehicles, 'status') }, warnings: ['Vehicle capacity is not configured; no occupancy conclusion is made.'], indicators: unavailable ? ['OPERATIONAL_REVIEW_REQUIRED'] : [], lastUpdatedAt: latest(records) }; } });
    add({ moduleId: 'hostel-residences', capabilityId: 'hostel', requiredPermissions: ['hostel.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['spaces', 'capacity', 'occupiedSpaces', 'availableSpace', 'unassignedResidents'], dashboardMetrics: ['spaces', 'capacity', 'occupiedSpaces', 'availableSpace'], dataQualityRules: ['PROVENANCE', 'CAPACITY'], exceptionRules: ['CAPACITY_EXCEEDED'], calculate: ({ actor }) => { const source = operations.list('HOSTEL', actor); return { records: [...source.spaces.map((row) => ({ ...row, recordType: 'SPACE' })), ...source.allocations.map((row) => ({ ...row, recordType: 'ALLOCATION' }))] }; }, summarize: (records) => { const spaces = records.filter((r) => r.recordType === 'SPACE'), allocations = records.filter((r) => r.recordType === 'ALLOCATION' && r.active !== false); const configured = spaces.every((s) => Number.isFinite(Number(s.capacity))); const capacity = configured ? spaces.reduce((sum, s) => sum + Number(s.capacity), 0) : null; const occupied = allocations.length; return { metrics: { spaces: spaces.length, capacity, occupiedSpaces: occupied, availableSpace: capacity === null ? null : Math.max(0, capacity - occupied), unassignedResidents: allocations.filter((a) => !a.spaceId).length }, warnings: configured ? [] : ['Hostel capacity is not configured; available space is unavailable.'], indicators: capacity !== null && occupied > capacity ? ['OPERATIONAL_REVIEW_REQUIRED'] : [], lastUpdatedAt: latest(records) }; } });
  }
  if (resources) {
    add({ moduleId: 'inventory', capabilityId: 'inventory', requiredPermissions: ['inventory.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['itemCount', 'stockQuantity', 'lowStockItems'], dashboardMetrics: ['itemCount', 'stockQuantity', 'lowStockItems'], dataQualityRules: ['PROVENANCE'], exceptionRules: ['LOW_STOCK'], calculate: ({ actor }) => ({ records: resources.list('INVENTORY', actor).inventory.map((row) => ({ ...row, recordType: 'INVENTORY' })) }), summarize: (records) => { const configured = records.filter((r) => Number.isFinite(Number(r.reorderLevel)) && Number(r.reorderLevel) > 0); const low = configured.filter((r) => Number(r.quantity) < Number(r.reorderLevel)).length; return { metrics: { itemCount: records.length, stockQuantity: records.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0), lowStockItems: configured.length ? low : null }, warnings: configured.length ? [] : ['Low-stock thresholds are not configured; no low-stock conclusion is made.'], indicators: low ? ['OPERATIONAL_REVIEW_REQUIRED'] : [], lastUpdatedAt: latest(records) }; } });
    add({ moduleId: 'assets', capabilityId: 'assets', requiredPermissions: ['assets.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['assetCount', 'assetStatus', 'damagedAssets', 'unserviceableAssets'], dashboardMetrics: ['assetCount', 'damagedAssets', 'unserviceableAssets'], dataQualityRules: ['PROVENANCE'], exceptionRules: ['ASSET_UNSERVICEABLE'], calculate: ({ actor }) => ({ records: resources.list('ASSETS', actor).assets.map((row) => ({ ...row, recordType: 'ASSET' })) }), summarize: (records) => { const damaged = records.filter((r) => String(r.condition).toUpperCase() === 'DAMAGED').length, unserviceable = records.filter((r) => ['UNSERVICEABLE', 'RETIRED'].includes(String(r.status).toUpperCase())).length; return { metrics: { assetCount: records.length, assetStatus: countBy(records, 'status'), damagedAssets: damaged, unserviceableAssets: unserviceable }, warnings: [], indicators: damaged || unserviceable ? ['OPERATIONAL_REVIEW_REQUIRED'] : [], lastUpdatedAt: latest(records) }; } });
    add({ moduleId: 'procurement', capabilityId: 'procurement', requiredPermissions: ['procurement.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['pendingItems', 'inProgressItems', 'completedItems', 'overdueItems'], dashboardMetrics: ['pendingItems', 'inProgressItems', 'completedItems'], dataQualityRules: ['PROVENANCE'], exceptionRules: ['STALLED_PROCUREMENT'], calculate: ({ actor }) => ({ records: resources.list('PROCUREMENT', actor).requests.map((row) => ({ ...row, recordType: 'PROCUREMENT' })) }), summarize: (records) => ({ metrics: { pendingItems: records.filter((r) => r.state === 'REQUESTED').length, inProgressItems: records.filter((r) => !TERMINAL_PROCUREMENT.has(r.state) && r.state !== 'REQUESTED').length, completedItems: records.filter((r) => TERMINAL_PROCUREMENT.has(r.state)).length, overdueItems: null }, warnings: ['No procurement due-date policy is configured; overdue items are not inferred.'], indicators: [], lastUpdatedAt: latest(records) }) });
    add({ moduleId: 'property', capabilityId: 'maintenance', requiredPermissions: ['property.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['openIssues', 'inProgressItems', 'completedItems', 'overdueItems'], dashboardMetrics: ['openIssues', 'inProgressItems', 'completedItems'], dataQualityRules: ['PROVENANCE'], exceptionRules: ['OVERDUE_MAINTENANCE'], calculate: ({ actor }) => ({ records: resources.list('PROPERTY', actor).maintenance.map((row) => ({ ...row, recordType: 'MAINTENANCE' })) }), summarize: (records) => ({ metrics: { openIssues: records.filter((r) => !TERMINAL_MAINTENANCE.has(r.status)).length, inProgressItems: records.filter((r) => r.status === 'IN_PROGRESS').length, completedItems: records.filter((r) => r.status === 'COMPLETED').length, overdueItems: null }, warnings: ['No maintenance due-date policy is configured; overdue items are not inferred.'], indicators: [], lastUpdatedAt: latest(records) }) });
  }
  if (communication) add({ moduleId: 'announcements', capabilityId: 'communication', requiredPermissions: ['communication.read'], productionDataOnly: true, aiEnabled: true, supportedMetrics: ['announcementCount', 'calendarEventCount'], dashboardMetrics: ['announcementCount', 'calendarEventCount'], dataQualityRules: ['PROVENANCE', 'AUTHORIZED_AUDIENCE'], exceptionRules: [], calculate: ({ actor }) => ({ records: [...communication.listAnnouncements(actor).map((row) => ({ ...row, recordType: 'ANNOUNCEMENT' })), ...communication.listCalendar(actor).map((row) => ({ ...row, recordType: 'CALENDAR' }))] }), summarize: (records) => ({ metrics: { announcementCount: records.filter((row) => row.recordType === 'ANNOUNCEMENT').length, calendarEventCount: records.filter((row) => row.recordType === 'CALENDAR').length }, warnings: [], indicators: [], lastUpdatedAt: latest(records) }) });
  return Object.freeze(registered);
}

export function createOperationalTools(service, registry) {
  return Object.freeze(registry.list().flatMap((provider) => ['READ', 'ANALYZE'].map((operationType) => ({ name: `${provider.capabilityId}.${operationType === 'READ' ? 'status' : 'analyze'}`, capabilityId: provider.capabilityId, description: `Read validated ${provider.capabilityId} operational intelligence.`, operationType, requiredPermissions: provider.requiredPermissions, inputSchema: { type: 'object', properties: { metricIds: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }, outputSchema: { type: 'object' }, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: READ_ONLY.has(operationType), handler: async ({ input, authorization }) => ({ records: [{ ...(await service.snapshot({ capabilityId: provider.capabilityId, metricIds: input.metricIds, actor: { id: authorization.context.userId, schoolId: authorization.context.schoolId, roleKey: authorization.context.role, permissions: new Set(authorization.context.permissions) } })), provenance: 'PRODUCTION' }] }) }))));
}
