import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIAuthorizationContext, createAIAuthorizationGuard, createAICapabilityRegistry, createAIToolRegistry, createProductionDataGuard, executeAuthorizedAITool } from '../src/ai/index.js';

const outputSchema = { type: 'object', properties: { records: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'number' } } } }, quality: { type: 'object', properties: { status: { type: 'string' } } } } };
const baseCapability = { moduleId: 'test', moduleName: 'Test', category: 'TEST', version: '1.0.0', enabled: true, description: 'Test-only authorization capability.', requiredRoles: [], metrics: [], reports: [], actions: [], dashboardWidgets: [], productionDataOnly: true, provenanceAware: true, dataQualityAware: true, dataQualityRequirements: [], auditRequired: true };

function setup() {
  const capabilities = createAICapabilityRegistry();
  capabilities.register({ ...baseCapability, id: 'academic', requiredPermissions: ['academics.read'], requiredRoles: ['HEADTEACHER', 'TEACHER'], dataDomain: 'ACADEMICS', tools: ['academic.summary'] });
  capabilities.register({ ...baseCapability, id: 'finance', requiredPermissions: ['finance.read'], requiredRoles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR'], dataDomain: 'FINANCE', tools: ['finance.summary'] });
  capabilities.register({ ...baseCapability, id: 'parent-student', requiredPermissions: ['children.read'], requiredRoles: ['PARENT'], dataDomain: 'STUDENTS', tools: ['parent.student-summary'] });
  const tools = createAIToolRegistry();
  const common = { inputSchema: { type: 'object' }, outputSchema, operationType: 'READ', productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true, handler: async () => ({ records: [{ id: 'visible', value: 4, secret: 'remove-me', provenance: 'PRODUCTION' }, { id: 'fixture', value: 99, secret: 'remove-me', provenance: 'TEST' }] }) };
  tools.register({ ...common, name: 'academic.summary', capabilityId: 'academic', description: 'Academic summary.', requiredPermission: 'academics.read' });
  tools.register({ ...common, name: 'finance.summary', capabilityId: 'finance', description: 'Finance summary.', requiredPermission: 'finance.read' });
  tools.register({ ...common, name: 'parent.student-summary', capabilityId: 'parent-student', description: 'Parent student summary.', requiredPermission: 'children.read' });
  const productionDataGuard = createProductionDataGuard({ environment: 'production' });
  return { capabilities, tools, productionDataGuard };
}

const user = (overrides = {}) => ({ id: 'user-1', schoolId: 'school-1', roleKey: 'HEADTEACHER', portal: 'school', sessionId: 'session-1', permissions: new Set(['academics.read']), ...overrides });

test('unauthenticated AI tool request is denied safely', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: null, toolName: 'academic.summary', capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'UNAUTHENTICATED' && !error.message.includes('database'));
});

test('authorized Headteacher request succeeds and Production Data Guard still runs', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  const result = await executeAuthorizedAITool({ authenticatedUser: user(), toolName: 'academic.summary', input: { classId: 'class-1' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard });
  assert.deepEqual(result.data.records, [{ id: 'visible', value: 4 }]);
  assert.equal(result.quality.status, 'PARTIAL');
  assert.equal('secret' in result.data.records[0], false);
});

test('unauthorized role and cross-capability access are denied', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: user({ roleKey: 'ACCOUNTANT_BURSAR', permissions: new Set(['finance.read']) }), toolName: 'academic.summary', capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'PERMISSION_DENIED');
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: user({ roleKey: 'TEACHER' }), toolName: 'academic.summary', additionalCapabilityIds: ['finance'], capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'PERMISSION_DENIED');
});

test('teacher assignment and object-level scope cannot be bypassed with IDs', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  const teacher = user({ roleKey: 'TEACHER', assignedClassIds: ['class-1'], assignedSubjectIds: ['subject-1'], assignedStudentIds: ['student-1'] });
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: teacher, toolName: 'academic.summary', input: { classId: 'class-2' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'SCOPE_DENIED');
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: teacher, toolName: 'academic.summary', input: { studentId: 'student-2' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'SCOPE_DENIED');
});

test('parent can retrieve only an explicitly linked child', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  const parent = user({ roleKey: 'PARENT', portal: 'parent', permissions: new Set(['children.read']), children: [{ id: 'student-1' }] });
  await assert.doesNotReject(() => executeAuthorizedAITool({ authenticatedUser: parent, toolName: 'parent.student-summary', input: { studentId: 'student-1' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }));
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: parent, toolName: 'parent.student-summary', input: { studentId: 'student-2' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'SCOPE_DENIED');
});

test('client school and role fields cannot change trusted authorization context', async () => {
  const { capabilities, tools, productionDataGuard } = setup();
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: user(), toolName: 'academic.summary', input: { schoolId: 'school-2' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'SCOPE_DENIED');
  await assert.rejects(() => executeAuthorizedAITool({ authenticatedUser: user(), toolName: 'finance.summary', input: { roleKey: 'PROPRIETOR', role: 'PROPRIETOR' }, capabilityRegistry: capabilities, toolRegistry: tools, productionDataGuard }), (error) => error.code === 'PERMISSION_DENIED');
});

test('unknown capabilities, tools, and missing permission metadata are denied', () => {
  const { capabilities, tools } = setup();
  const guard = createAIAuthorizationGuard({ capabilityRegistry: capabilities, toolRegistry: tools });
  const context = createAIAuthorizationContext(user());
  assert.throws(() => guard.authorizeCapability(context, 'unknown'), (error) => error.code === 'PERMISSION_DENIED');
  assert.throws(() => guard.authorizeTool(context, 'unknown', {}), (error) => error.code === 'TOOL_NOT_ALLOWED');
  const malformedTools = { get: () => ({ name: 'malformed', capabilityId: 'academic', operationType: 'READ', enabled: true, requiredPermissions: [] }) };
  assert.throws(() => createAIAuthorizationGuard({ capabilityRegistry: capabilities, toolRegistry: malformedTools }).authorizeTool(context, 'malformed'), (error) => error.code === 'TOOL_NOT_ALLOWED');
});

test('WRITE tools remain globally disabled', () => {
  const { capabilities } = setup();
  const writeTools = { get: () => ({ name: 'academic.write', capabilityId: 'academic', operationType: 'WRITE', enabled: true, requiredPermissions: ['academics.read'] }) };
  const guard = createAIAuthorizationGuard({ capabilityRegistry: capabilities, toolRegistry: writeTools });
  assert.throws(() => guard.authorizeTool(createAIAuthorizationContext(user()), 'academic.write'), (error) => error.code === 'WRITE_DISABLED');
});
