import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProvider, authorizeAITool, buildAIRegistry, createAICapabilityRegistry, createAIToolRegistry, dataQuality, enforceProductionData } from '../src/ai/index.js';
import { canAccess } from '../src/auth.js';

test('AI capability and tool registries are declarative and disabled by default', () => {
  const capabilities = createAICapabilityRegistry();
  capabilities.register({ id: 'fees', moduleId: 'fees', moduleName: 'Fees', category: 'FEE HUB', version: '1.0.0', enabled: true, description: 'Fee intelligence.', dataDomain: 'FINANCE', requiredPermissions: ['fees.read'], tools: ['finance.collection-summary'], metrics: [], productionDataRules: ['PRODUCTION_ONLY'], dataQualityRequirements: ['FRESHNESS'], auditRequirements: ['ACCESS'] });
  const tools = createAIToolRegistry();
  const tool = tools.register({ name: 'finance.collection-summary', description: 'Read an authoritative fee collection summary.', capabilityId: 'fees', requiredPermission: 'fees.read', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, operationType: 'READ' });
  assert.equal(capabilities.get('fees').aiEnabled, true);
  assert.equal(tool.enabled, false);
  assert.deepEqual(tools.list({ enabledOnly: true }), []);
});

test('AI manifests auto-discover existing modules without core switch logic', async () => {
  const registry = await buildAIRegistry();
  assert.deepEqual(registry.capabilities.list().map((item) => item.id), ['students', 'academics', 'attendance', 'admissions', 'finance', 'staff', 'transport', 'hostel', 'communication', 'documents']);
  assert.ok(registry.tools.list({ enabledOnly: true }).every((tool) => ['READ', 'ANALYZE'].includes(tool.operationType)));
  assert.ok(registry.capabilities.list().every((item) => item.productionDataOnly && item.auditRequired));
});

test('AI registry rejects duplicates, invalid modules, malformed schemas, and enabled writes', async () => {
  const capability = { id: 'future', moduleId: 'future', moduleName: 'Future', category: 'OPERATIONS', version: '1.0.0', enabled: true, description: 'Future intelligence.', requiredPermissions: ['future.read'], requiredRoles: [], dataDomain: 'FUTURE', tools: ['future.summary'], metrics: [], reports: [], actions: [], dashboardWidgets: [], productionDataOnly: true, dataQualityRequirements: [], auditRequired: true };
  const readTool = { name: 'future.summary', capabilityId: 'future', description: 'Read future data.', operationType: 'READ', requiredPermission: 'future.read', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, enabled: true };
  const registry = await buildAIRegistry({ modules: [{ moduleKey: 'future' }], manifests: [{ capability, tools: [readTool] }] });
  assert.equal(registry.capabilities.get('future').moduleId, 'future');
  assert.throws(() => registry.capabilities.register(capability), /already registered/);
  await assert.rejects(() => buildAIRegistry({ modules: [], manifests: [{ capability, tools: [readTool] }] }), /Unknown OSAAH module/);
  assert.throws(() => createAIToolRegistry().register({ ...readTool, name: 'bad.schema', inputSchema: {} }), /valid input and output schemas/);
  assert.throws(() => createAIToolRegistry().register({ ...readTool, name: 'future.write', operationType: 'WRITE' }), /cannot be enabled/);
});

test('disabled capability requires a reason and may intentionally expose no AI metadata', () => {
  const registry = createAICapabilityRegistry();
  const disabled = registry.register({ id: 'sensitive', moduleId: 'sensitive', moduleName: 'Sensitive', category: 'SYSTEM', version: '1.0.0', enabled: false, disabledReason: 'Not approved for AI access.', description: 'Sensitive module.', requiredPermissions: [], requiredRoles: [], dataDomain: 'SENSITIVE', tools: [], metrics: [], reports: [], actions: [], dashboardWidgets: [], dataQualityRequirements: [] });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(registry.list({ enabledOnly: true }), []);
});

test('AI authorization inherits existing permissions and production data defaults to production only', () => {
  const tool = { requiredPermissions: ['fees.read'] };
  assert.equal(authorizeAITool({ actor: { permissions: new Set(['fees.read']) }, tool, canAccess }).allowed, true);
  assert.equal(authorizeAITool({ actor: { permissions: new Set() }, tool, canAccess }).allowed, false);
  const result = enforceProductionData([{ id: 1, provenance: 'PRODUCTION' }, { id: 2, provenance: 'DEMO' }, { id: 3 }]);
  assert.deepEqual(result.accepted.map((item) => item.id), [1]);
  assert.deepEqual(result.rejected.map((item) => item.id), [2, 3]);
});

test('AI contracts report quality and no provider is active', async () => {
  assert.equal(dataQuality('PARTIAL', { completenessPercent: 75 }).status, 'PARTIAL');
  assert.deepEqual(await new AIProvider().healthCheck(), { configured: false, healthy: false, reason: 'NO_PROVIDER_CONFIGURED' });
  await assert.rejects(() => new AIProvider().generate(), /No AI provider is configured/);
});
