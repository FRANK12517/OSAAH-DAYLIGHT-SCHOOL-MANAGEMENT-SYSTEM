import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProvider, authorizeAITool, createAICapabilityRegistry, createAIToolRegistry, dataQuality, enforceProductionData } from '../src/ai/index.js';
import { canAccess } from '../src/auth.js';

test('AI capability and tool registries are declarative and disabled by default', () => {
  const capabilities = createAICapabilityRegistry();
  capabilities.register({ moduleId: 'fees', moduleName: 'Fees', category: 'FEE HUB', version: '1.0.0', dataDomain: 'FINANCE', requiredPermissions: ['fees.read'], availableTools: ['finance.collection-summary'], productionDataRules: ['PRODUCTION_ONLY'], dataQualityRequirements: ['FRESHNESS'], auditRequirements: ['ACCESS'] });
  const tools = createAIToolRegistry();
  const tool = tools.register({ id: 'finance.collection-summary', description: 'Read an authoritative fee collection summary.', capabilityId: 'fees', requiredPermissions: ['fees.read'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, accessMode: 'READ' });
  assert.equal(capabilities.get('fees').aiEnabled, true);
  assert.equal(tool.enabled, false);
  assert.deepEqual(tools.list({ enabledOnly: true }), []);
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
