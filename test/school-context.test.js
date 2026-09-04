import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIAuditLogger, createInMemoryAIAuditSink, createProductionDataGuard, createSchoolContextService } from '../src/ai/index.js';
import { DEFAULT_GRADING } from '../src/examinations.js';

const schoolId = 'school-1';
const production = (record) => ({ schoolId, provenance: 'PRODUCTION', ...record });
function fixture() {
  const records = {
    schoolProfile: [production({ id: schoolId, name: 'Osaah Daylight School Complex', timezone: 'Africa/Accra' })],
    academicYears: [production({ id: 'year-2026', name: '2026/2027', status: 'ACTIVE', startsOn: '2026-09-01', endsOn: '2027-07-31' }), production({ id: 'year-2027', name: '2027/2028', status: 'UPCOMING', startsOn: '2027-09-01' })],
    terms: [production({ id: 'term-1', academicYearId: 'year-2026', name: 'Opening Term', status: 'ACTIVE', startsOn: '2026-09-01', endsOn: '2026-12-18' })],
    calendarEvents: [production({ id: 'calendar-1', termId: 'term-1', type: 'REOPENING', name: 'School reopens', startsOn: '2026-09-01' })],
    classes: [production({ id: 'class-jhs2', name: 'JHS 2', level: 'JHS', active: true }), production({ id: 'class-demo', name: 'Demo Class', provenance: 'TEST' })],
    subjects: [production({ id: 'subject-math', name: 'Mathematics', classIds: ['class-jhs2'], active: true })],
    teacherAssignments: [production({ id: 'assignment-1', teacherId: 'teacher-1', classId: 'class-jhs2', subjectId: 'subject-math', academicYearId: 'year-2026', termId: 'term-1' })],
    assessmentConfig: [production({ id: 'assessment-1', academicYearId: 'year-2026', termId: 'term-1', caMax: 50, examinationMax: 50, grading: DEFAULT_GRADING, publicationStates: ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'PUBLISHED', 'LOCKED'] })],
    feeStructures: [production({ id: 'fee-1', academicYearId: 'year-2026', termId: 'term-1', classId: 'class-jhs2', status: 'PUBLISHED', amount: 1000 })],
    admissionConfig: [production({ id: 'admission-1', academicYearId: 'year-2026', termId: 'term-1', status: 'OPEN', open: true, classIds: ['class-jhs2'], applicantNames: ['must-not-appear'] })],
    roleAssignments: [production({ id: 'role-1', userId: 'teacher-1', roleKey: 'TEACHER', salary: 999 })]
  };
  const auditLogger = createAIAuditLogger({ sink: createInMemoryAIAuditSink(), environment: 'test', onFailure: () => {} });
  const service = createSchoolContextService({ sources: Object.fromEntries(Object.entries(records).map(([key, value]) => [key, () => value])), modules: [{ moduleKey: 'academics', moduleName: 'Academics', category: 'ACADEMICS', route: '/academics', requiredPermission: 'academics.read', roles: ['HEADTEACHER', 'TEACHER'], enabled: true }, { moduleKey: 'disabled', moduleName: 'Disabled', category: 'SYSTEM', route: '/disabled', requiredPermission: null, roles: [], enabled: false }], productionDataGuard: createProductionDataGuard({ environment: 'production' }), auditLogger, clock: () => '2026-09-03T12:00:00.000Z' });
  return { records, auditLogger, service };
}
const manager = (overrides = {}) => ({ id: 'manager-1', schoolId, roleKey: 'HEADTEACHER', portal: 'school', permissions: new Set(['academics.read', 'subjects.read', 'finance.read', 'admissions.read', 'staff.read', 'transport.read']), ...overrides });

test('active academic year and configurable term resolve deterministically', async () => {
  const { service } = fixture(); const context = await service.generate({ authenticatedUser: manager(), type: 'ACADEMIC' });
  assert.equal(context.academicYear.id, 'year-2026'); assert.equal(context.term.id, 'term-1'); assert.equal(context.term.name, 'Opening Term'); assert.equal(context.academicPeriodStatus, 'ACTIVE');
});

test('classes, subjects, assignments and actual assessment rules are dynamic and production-safe', async () => {
  const { service, records } = fixture(); let context = await service.generate({ authenticatedUser: manager(), type: 'ACADEMIC' });
  assert.deepEqual(context.classes.map((item) => item.id), ['class-jhs2']); assert.deepEqual(context.classLevels, ['JHS']); assert.equal(context.subjects[0].id, 'subject-math'); assert.equal(context.teacherAssignments[0].teacherId, 'teacher-1');
  assert.equal(context.assessmentConfig[0].caMax, 50); assert.deepEqual(context.assessmentConfig[0].grading, DEFAULT_GRADING); assert.equal(context.productionData.excludedCount, 1);
  const version = context.contextVersion; records.classes.push(production({ id: 'class-basic6', name: 'Basic 6', level: 'PRIMARY', active: true }));
  context = await service.generate({ authenticatedUser: manager(), type: 'ACADEMIC' }); assert.ok(context.classes.some((item) => item.id === 'class-basic6')); assert.notEqual(context.contextVersion, version);
});

test('teacher context is limited to current assigned classes and subjects', async () => {
  const { service } = fixture();
  const teacher = manager({ id: 'teacher-1', roleKey: 'TEACHER', permissions: new Set(['academics.read']), assignedClassIds: ['class-jhs2'], assignedSubjectIds: ['subject-math'] });
  const context = await service.generate({ authenticatedUser: teacher, type: 'ACADEMIC' });
  assert.deepEqual(context.classes.map((item) => item.id), ['class-jhs2']); assert.deepEqual(context.subjects.map((item) => item.id), ['subject-math']); assert.ok(context.teacherAssignments.every((item) => item.teacherId === 'teacher-1'));
  assert.equal('feeContextSummary' in context, false); assert.equal('staffRoleSummary' in context, false);
});

test('module discovery excludes disabled and unauthorized modules', async () => {
  const { service } = fixture(); const context = await service.generate({ authenticatedUser: manager(), type: 'BASIC_SCHOOL' });
  assert.deepEqual(context.enabledModules.map((item) => item.moduleId), ['academics']);
});

test('financial and admissions context contain configuration references but no transactions or applicants', async () => {
  const { service } = fixture(); const finance = await service.generate({ authenticatedUser: manager(), type: 'FINANCIAL' }); const admissions = await service.generate({ authenticatedUser: manager(), type: 'ADMISSIONS' });
  assert.deepEqual(finance.feeContextSummary, [{ id: 'fee-1', academicYearId: 'year-2026', termId: 'term-1', classId: 'class-jhs2', status: 'PUBLISHED' }]);
  assert.equal(JSON.stringify(finance).includes('1000'), false); assert.equal(JSON.stringify(admissions).includes('must-not-appear'), false);
});

test('missing active term returns structured warning without guessing', async () => {
  const { service, records } = fixture(); records.terms[0].status = 'ENDED'; records.terms[0].endsOn = '2026-08-31';
  const context = await service.generate({ authenticatedUser: manager(), type: 'ACADEMIC' });
  assert.equal(context.term, null); assert.equal(context.status, 'CONTEXT_PARTIAL'); assert.ok(context.warnings.includes('ACTIVE_TERM_MISSING')); assert.equal(context.quality.status, 'PARTIAL');
});

test('unauthenticated and unauthorized context requests are denied', async () => {
  const { service } = fixture();
  await assert.rejects(() => service.generate({ authenticatedUser: null, type: 'ACADEMIC' }), (error) => error.code === 'UNAUTHENTICATED');
  await assert.rejects(() => service.generate({ authenticatedUser: manager({ roleKey: 'TEACHER', permissions: new Set() }), type: 'FINANCIAL' }), (error) => error.code === 'PERMISSION_DENIED');
});

test('context generation is audited with version and warning count, not raw context', async () => {
  const { service, auditLogger } = fixture(); const context = await service.generate({ authenticatedUser: manager(), type: 'ACADEMIC', requestId: 'context-request', correlationId: 'context-correlation' });
  const event = auditLogger.recent().find((item) => item.eventType === 'AI_CONTEXT_GENERATED');
  assert.equal(event.requestId, 'context-request'); assert.equal(event.correlationId, 'context-correlation'); assert.equal(event.metadata.contextVersion, context.contextVersion); assert.equal(event.metadata.contextType, 'ACADEMIC');
  assert.equal(JSON.stringify(event).includes('Mathematics'), false);
  const qualityEvent = auditLogger.recent().find((item) => item.eventType === 'AI_DATA_QUALITY_ASSESSED');
  assert.equal(qualityEvent.capabilityId, 'school-context'); assert.equal(qualityEvent.dataQualityStatus, context.quality.status);
  assert.equal(context.quality.sourceCount, 9); assert.equal(context.quality.reportingPeriod.termId, 'term-1');
});
