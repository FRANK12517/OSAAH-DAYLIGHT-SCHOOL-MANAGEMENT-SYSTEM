import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { AIGatewayError, createAIAuditLogger, createAICapabilityRegistry, createAIDataQualityGuard, createAIGateway, createAIToolRegistry, createInMemoryAIAuditSink, createProductionDataGuard, createSchoolContextService } from '../src/ai/index.js';

const outputSchema = { type: 'object', properties: { records: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'number' } } } }, quality: { type: 'object', properties: { status: { type: 'string' } } } } };
const actor = (overrides = {}) => ({ id: 'user-1', schoolId: 'school-1', roleKey: 'HEADTEACHER', portal: 'school', permissions: new Set(['academics.read']), ...overrides });

function setup() {
  const capabilities = createAICapabilityRegistry();
  capabilities.register({ id: 'academic', moduleId: 'academic-test', moduleName: 'Academic Test', category: 'ACADEMICS', version: '1.0.0', enabled: true, description: 'Gateway test capability.', requiredPermissions: ['academics.read'], requiredRoles: ['HEADTEACHER'], dataDomain: 'ACADEMICS', tools: ['academic.summary'], metrics: [], productionDataOnly: true, provenanceAware: true, dataQualityAware: true, dataQualityRequirements: ['COMPLETENESS'], auditRequired: true });
  const tools = createAIToolRegistry();
  tools.register({ name: 'academic.summary', capabilityId: 'academic', description: 'Read a safe academic summary.', operationType: 'READ', requiredPermission: 'academics.read', inputSchema: { type: 'object' }, outputSchema, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true, handler: async () => ({ records: [{ id: 'production-row', value: 4, secret: 'remove', provenance: 'PRODUCTION' }, { id: 'test-row', value: 99, provenance: 'TEST' }] }) });
  const auditLogger = createAIAuditLogger({ sink: createInMemoryAIAuditSink(), environment: 'test', onFailure: () => {} });
  const productionDataGuard = createProductionDataGuard({ environment: 'production' });
  const dataQualityGuard = createAIDataQualityGuard({ auditLogger });
  const production = (record) => ({ schoolId: 'school-1', provenance: 'PRODUCTION', ...record });
  const schoolContextService = createSchoolContextService({ sources: { schoolProfile: [production({ id: 'school-1', name: 'OSAAH' })], academicYears: [production({ id: 'year-1', status: 'ACTIVE' })], terms: [production({ id: 'term-1', academicYearId: 'year-1', status: 'ACTIVE' })], calendarEvents: [] }, modules: [], capabilityRegistry: capabilities, productionDataGuard, dataQualityGuard, auditLogger, clock: () => '2026-09-04T12:00:00.000Z' });
  return { capabilities, tools, auditLogger, productionDataGuard, dataQualityGuard, schoolContextService, gateway: createAIGateway({ capabilityRegistry: capabilities, toolRegistry: tools, schoolContextService, productionDataGuard, dataQualityGuard, auditLogger }) };
}

test('repository-native AI Gateway', async (t) => {
  await t.test('accepts an authenticated authorized server request', async () => {
    const { gateway } = setup(); const result = await gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary' });
    assert.equal(result.capabilityId, 'academic'); assert.equal(result.provider.invoked, false);
  });
  await t.test('rejects an unauthenticated request with a safe error', async () => {
    await assert.rejects(() => setup().gateway.execute({ capabilityId: 'academic', toolName: 'academic.summary' }), (error) => error instanceof AIGatewayError && error.code === 'UNAUTHENTICATED' && error.status === 401);
  });
  await t.test('rejects client-selected school scope', async () => {
    await assert.rejects(() => setup().gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary', input: { schoolId: 'school-2' } }), (error) => error.code === 'PERMISSION_DENIED');
  });
  await t.test('rejects unauthorized and unknown capabilities without enumeration', async () => {
    const gateway = setup().gateway;
    await assert.rejects(() => gateway.execute({ authenticatedUser: actor({ permissions: new Set() }), capabilityId: 'academic', toolName: 'academic.summary' }), (error) => error.code === 'PERMISSION_DENIED');
    await assert.rejects(() => gateway.execute({ authenticatedUser: actor(), capabilityId: 'unknown', toolName: 'academic.summary' }), (error) => error.code === 'PERMISSION_DENIED');
  });
  await t.test('rejects an unknown or mismatched tool', async () => {
    await assert.rejects(() => setup().gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'unknown' }), (error) => error.code === 'INVALID_REQUEST');
  });
  await t.test('preserves non-complete Data Quality state', async () => {
    const result = await setup().gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary' });
    assert.equal(result.quality.status, 'PARTIAL'); assert.equal(result.quality.verifiedComplete, false); assert.equal(result.quality.completenessPercent, 50);
  });
  await t.test('preserves Production Data Guard filtering and output minimization', async () => {
    const result = await setup().gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary' });
    assert.deepEqual(result.data.records, [{ id: 'production-row', value: 4 }]); assert.equal(JSON.stringify(result).includes('test-row'), false); assert.equal(JSON.stringify(result).includes('remove'), false);
  });
  await t.test('propagates request and correlation IDs through audit', async () => {
    const system = setup(); const result = await system.gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary', requestId: 'gateway-request', correlationId: 'gateway-correlation' });
    assert.equal(result.requestId, 'gateway-request'); assert.equal(result.correlationId, 'gateway-correlation');
    assert.ok(system.auditLogger.recent({ limit: 100 }).filter((event) => event.requestId === 'gateway-request').every((event) => event.correlationId === 'gateway-correlation'));
  });
  await t.test('denies WRITE before any handler can execute', async () => {
    const system = setup(); let called = false; const writeTool = { name: 'academic.write', capabilityId: 'academic', operationType: 'WRITE', requiredPermissions: ['academics.read'], enabled: true, handler: () => { called = true; } };
    const tools = { get: (name) => name === 'academic.write' ? writeTool : system.tools.get(name) };
    const capabilities = { get: (id) => id === 'academic' ? { ...system.capabilities.get(id), tools: ['academic.summary', 'academic.write'] } : system.capabilities.get(id) };
    const gateway = createAIGateway({ capabilityRegistry: capabilities, toolRegistry: tools, schoolContextService: system.schoolContextService, productionDataGuard: system.productionDataGuard, dataQualityGuard: system.dataQualityGuard, auditLogger: system.auditLogger });
    await assert.rejects(() => gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.write' }), (error) => error.code === 'WRITE_DISABLED'); assert.equal(called, false);
  });
  await t.test('reports provider unavailability without invoking a provider', async () => {
    await assert.rejects(() => setup().gateway.execute({ authenticatedUser: actor(), capabilityId: 'academic', toolName: 'academic.summary', providerRequired: true }), (error) => error.code === 'PROVIDER_UNAVAILABLE');
  });
});

test('HTTP AI Gateway route uses authenticated server identity and structured errors', async () => {
  const auth = createAuthService(); const aiGateway = { execute: async ({ authenticatedUser }) => { if (!authenticatedUser) throw new AIGatewayError('UNAUTHENTICATED', { requestId: 'route-request' }); return { requestId: 'route-request', userId: authenticatedUser.id }; } };
  const server = createServer(createApp({ auth, aiGateway })); await new Promise((resolve) => server.listen(0, resolve)); const port = server.address().port;
  const call = (token) => new Promise((resolve, reject) => { const req = httpRequest({ port, path: '/api/ai/gateway', method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) })); }); req.on('error', reject); req.write(JSON.stringify({ capabilityId: 'academic', toolName: 'academic.summary', authenticatedUser: { id: 'forged' } })); req.end(); });
  try { const denied = await call(); assert.equal(denied.status, 401); assert.equal(denied.body.error, 'UNAUTHENTICATED'); const login = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' }); const allowed = await call(login.token); assert.equal(allowed.status, 200); assert.notEqual(allowed.body.userId, 'forged'); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});
