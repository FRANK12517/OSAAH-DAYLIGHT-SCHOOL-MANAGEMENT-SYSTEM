import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIRegistryDiagnostics, createAIAuditLogger, createAICapabilityRegistry, createAIToolRegistry, createInMemoryAIAuditSink, createProductionDataGuard, executeAuthorizedAITool } from '../src/ai/index.js';
import { canAccess } from '../src/auth.js';

const schema = { type: 'object', properties: { records: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, amount: { type: 'number' } } } }, quality: { type: 'object', properties: { status: { type: 'string' } } } } };
function setup({ handler, sink } = {}) {
  const capabilities = createAICapabilityRegistry();
  capabilities.register({ id: 'finance', moduleId: 'finance', moduleName: 'Finance', category: 'FINANCE', version: '1.0.0', enabled: true, description: 'Test finance audit capability.', requiredPermissions: ['finance.read'], requiredRoles: ['PROPRIETOR'], dataDomain: 'FINANCE', tools: ['finance.summary'], metrics: [], reports: [], actions: [], dashboardWidgets: [], productionDataOnly: true, provenanceAware: true, dataQualityAware: true, dataQualityRequirements: [], auditRequired: true });
  const tools = createAIToolRegistry();
  tools.register({ name: 'finance.summary', capabilityId: 'finance', description: 'Test summary.', operationType: 'READ', requiredPermission: 'finance.read', inputSchema: { type: 'object' }, outputSchema: schema, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true, handler: handler ?? (async () => ({ records: [{ id: 'payment-1', amount: 20, password: 'never-log', accessToken: 'never-log', provenance: 'PRODUCTION' }, { id: 'payment-2', amount: 5000, parentPhone: 'never-log', provenance: 'TEST' }] })) });
  const auditSink = sink ?? createInMemoryAIAuditSink();
  const auditLogger = createAIAuditLogger({ sink: auditSink, environment: 'test', onFailure: () => {} });
  return { capabilities, tools, capabilityRegistry: capabilities, toolRegistry: tools, auditLogger, auditSink, productionDataGuard: createProductionDataGuard({ environment: 'production' }) };
}
const proprietor = (overrides = {}) => ({ id: 'user-1', schoolId: 'school-1', roleKey: 'PROPRIETOR', portal: 'school', permissions: new Set(['finance.read', 'ai.diagnostics.read']), ...overrides });

test('authorized request has correlated authorization, filtering and completion audit metadata', async () => {
  const system = setup();
  const result = await executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', input: { academicYearId: 'year-1', password: 'not-audit-data' }, requestId: 'request-1', correlationId: 'correlation-1', ...system });
  const events = [...system.auditLogger.recent({ limit: 20 })].reverse();
  assert.deepEqual(events.map((event) => event.eventType), ['AI_REQUEST_RECEIVED', 'AI_AUTH_ALLOWED', 'AI_TOOL_STARTED', 'AI_DATA_FILTER_APPLIED', 'AI_TOOL_COMPLETED', 'AI_REQUEST_COMPLETED']);
  assert.ok(events.every((event) => event.requestId === 'request-1' && event.correlationId === 'correlation-1'));
  assert.equal(events.find((event) => event.eventType === 'AI_DATA_FILTER_APPLIED').metadata.excludedRecordCount, 1);
  assert.equal(events.find((event) => event.eventType === 'AI_DATA_FILTER_APPLIED').dataQualityStatus, 'PARTIAL');
  assert.equal(result.requestId, 'request-1');
  const serialized = JSON.stringify(events);
  for (const secret of ['never-log', 'not-audit-data', 'parentPhone']) assert.equal(serialized.includes(secret), false);
});

test('denied cross-school and WRITE requests create safe security events', async () => {
  const system = setup();
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', input: { schoolId: 'school-2' }, requestId: 'scope-denied', ...system }), (error) => error.code === 'SCOPE_DENIED');
  assert.equal(system.auditLogger.recent().find((event) => event.requestId === 'scope-denied' && event.eventType === 'AI_AUTH_DENIED').severity, 'SECURITY');
  const writeTools = { get: () => ({ name: 'finance.write', capabilityId: 'finance', operationType: 'WRITE', enabled: true, requiredPermissions: ['finance.read'], productionDataOnly: true, auditRequired: true }) };
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.write', capabilityRegistry: system.capabilities, toolRegistry: writeTools, productionDataGuard: system.productionDataGuard, auditLogger: system.auditLogger, requestId: 'write-denied' }), (error) => error.code === 'WRITE_DISABLED');
  assert.equal(system.auditLogger.recent().find((event) => event.requestId === 'write-denied' && event.eventType === 'AI_WRITE_BLOCKED').severity, 'SECURITY');
});

test('tool failures are audited without storing raw financial records', async () => {
  const system = setup({ handler: async () => { const error = new Error('Backend failed'); error.code = 'BACKEND_FAILED'; throw error; } });
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', requestId: 'failed-tool', ...system }), /Backend failed/);
  const events = system.auditLogger.recent().filter((event) => event.requestId === 'failed-tool');
  assert.ok(events.some((event) => event.eventType === 'AI_TOOL_FAILED' && event.errorCode === 'BACKEND_FAILED'));
  assert.ok(events.some((event) => event.eventType === 'AI_REQUEST_FAILED'));
});

test('provider and controlled-action fields are optional and disabled by default', async () => {
  const system = setup();
  await executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', ...system });
  const event = system.auditLogger.recent()[0];
  assert.equal(event.provider, null); assert.equal(event.model, null); assert.equal(event.tokenUsage, null); assert.equal(event.estimatedCost, null);
  assert.equal(event.actionRequested, false); assert.equal(event.actionExecuted, false); assert.equal(event.approvalUserId, null);
});

test('AI audit diagnostics remain restricted and expose only safe metadata', async () => {
  const system = setup();
  await executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', ...system });
  assert.throws(() => buildAIRegistryDiagnostics({ actor: { schoolId: 'school-1', permissions: new Set() }, environment: 'production', canAccess, capabilityRegistry: system.capabilities, toolRegistry: system.tools, auditLogger: system.auditLogger }), /forbidden/);
  const diagnostics = buildAIRegistryDiagnostics({ actor: proprietor(), environment: 'production', canAccess, capabilityRegistry: system.capabilities, toolRegistry: system.tools, auditLogger: system.auditLogger });
  assert.ok(diagnostics.recentAudit.length > 0);
  assert.equal(JSON.stringify(diagnostics).includes('amount'), false);
});

test('audit persistence failure cannot bypass authorization and fails closed before tool execution', async () => {
  let executed = false; let persistenceFailures = 0;
  const sink = { append: async () => { throw new Error('storage unavailable'); }, list: () => [] };
  const system = setup({ sink, handler: async () => { executed = true; return { records: [] }; } });
  system.auditLogger = createAIAuditLogger({ sink, environment: 'test', onFailure: () => { persistenceFailures += 1; } });
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: proprietor({ permissions: new Set() }), toolName: 'finance.summary', ...system }), (error) => error.code === 'PERMISSION_DENIED');
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: proprietor(), toolName: 'finance.summary', ...system }), (error) => error.code === 'AI_AUDIT_UNAVAILABLE');
  assert.equal(executed, false); assert.ok(persistenceFailures >= 2);
});
