import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIAuditLogger, createAICapabilityRegistry, createAIDataQualityGuard, createInMemoryAIAuditSink, createProductionDataGuard, validateAIDataQuality } from '../src/ai/index.js';

const now = '2026-09-04T12:00:00.000Z';
const base = { validated: true, valid: true, sourceAvailable: true, sourceCount: 10, missingCount: 0, lastUpdatedAt: now, reportingPeriod: { academicYearId: 'year-1', termId: 'term-1' }, assessedAt: now };

test('AI Data Quality Guard', async (t) => {
  await t.test('returns COMPLETE only for validated available evidence', async () => {
    const { quality } = await createAIDataQualityGuard().assess(base);
    assert.equal(quality.status, 'COMPLETE'); assert.equal(quality.verifiedComplete, true);
  });
  await t.test('returns PARTIAL when required items are missing', async () => {
    const { quality } = await createAIDataQualityGuard().assess({ ...base, missingCount: 2 });
    assert.equal(quality.status, 'PARTIAL'); assert.equal(quality.verifiedComplete, false);
  });
  await t.test('returns STALE when trusted source freshness expires', async () => {
    const guard = createAIDataQualityGuard({ staleAfterMs: 60_000 });
    const { quality } = await guard.assess({ ...base, lastUpdatedAt: '2026-09-04T11:00:00.000Z' });
    assert.equal(quality.status, 'STALE');
  });
  await t.test('returns UNAVAILABLE without claiming a definitive result', async () => {
    const { quality } = await createAIDataQualityGuard().assess({ ...base, sourceAvailable: false });
    assert.equal(quality.status, 'UNAVAILABLE'); assert.equal(quality.verifiedComplete, false);
  });
  await t.test('fails unknown or invalid evidence safely as INVALID', async () => {
    const guard = createAIDataQualityGuard();
    assert.equal((await guard.assess({ ...base, validated: false })).quality.status, 'INVALID');
    assert.throws(() => validateAIDataQuality({ status: 'UNKNOWN' }), (error) => error.code === 'QUALITY_UNVALIDATED');
  });
  await t.test('calculates completeness only from supplied expected counts', async () => {
    const guard = createAIDataQualityGuard();
    assert.equal((await guard.assess({ ...base, sourceCount: 8, missingCount: undefined, expectedCount: 10 })).quality.completenessPercent, 80);
    assert.equal((await guard.assess(base)).quality.completenessPercent, null);
  });
  await t.test('deduplicates and propagates safe warnings', async () => {
    const { quality } = await createAIDataQualityGuard().assess({ ...base, warnings: ['Register incomplete.', 'Register incomplete.'], missingCount: 1 });
    assert.equal(quality.warnings.filter((warning) => warning === 'Register incomplete.').length, 1);
  });
  await t.test('audits quality metadata without raw rows', async () => {
    const auditLogger = createAIAuditLogger({ sink: createInMemoryAIAuditSink(), environment: 'test' });
    const guard = createAIDataQualityGuard({ auditLogger });
    await guard.assess({ ...base, requestId: 'quality-request', correlationId: 'quality-correlation', capabilityId: 'attendance', userId: 'user-1', schoolId: 'school-1', role: 'HEADTEACHER', records: [{ id: 'private-row', provenance: 'PRODUCTION' }] });
    const event = auditLogger.recent()[0]; assert.equal(event.eventType, 'AI_DATA_QUALITY_ASSESSED'); assert.equal(event.dataQualityStatus, 'COMPLETE'); assert.equal(JSON.stringify(event).includes('private-row'), false);
  });
  await t.test('requires data-quality-aware capability metadata', () => {
    const registry = createAICapabilityRegistry();
    const capability = { id: 'quality-test', moduleId: 'quality-test', moduleName: 'Quality Test', category: 'TEST', version: '1.0.0', enabled: true, description: 'Quality metadata validation.', requiredPermissions: ['test.read'], requiredRoles: [], dataDomain: 'TEST', tools: ['test.summary'], metrics: [], productionDataOnly: true, provenanceAware: true, dataQualityAware: false };
    assert.throws(() => registry.register(capability), /data-quality protection/);
  });
  await t.test('keeps Production Data Guard enforcement in the quality path', async () => {
    const guard = createAIDataQualityGuard({ productionDataGuard: createProductionDataGuard({ environment: 'production' }) });
    const result = await guard.assess({ ...base, records: [{ id: 'real', provenance: 'PRODUCTION' }, { id: 'demo', provenance: 'DEMO' }], sourceCount: undefined, expectedCount: 2, missingCount: undefined });
    assert.deepEqual(result.records.map((record) => record.id), ['real']); assert.equal(result.quality.status, 'PARTIAL'); assert.equal(result.quality.sourceCount, 1); assert.equal(result.quality.completenessPercent, 50);
  });
});
