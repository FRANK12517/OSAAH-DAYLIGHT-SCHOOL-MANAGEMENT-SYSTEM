import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIRegistry, createProductionDataGuard, createRecordProvenance, provenanceForCreation } from '../src/ai/index.js';

const productionGuard = () => createProductionDataGuard({ environment: 'production' });

function records(domain, nonProduction) {
  return [
    { id: `${domain}-production`, domain, provenance: 'PRODUCTION' },
    { id: `${domain}-${nonProduction.toLowerCase()}`, domain, provenance: nonProduction }
  ];
}

for (const [domain, excluded] of [['ACADEMIC_SCORE', 'TEST'], ['ACADEMIC_SCORE_SEED', 'SEED'], ['PAYMENT', 'TEST'], ['EXPENSE', 'DEMO'], ['ATTENDANCE', 'TEST'], ['ADMISSION_APPLICATION', 'DEMO'], ['STAFF', 'DEVELOPMENT']]) {
  test(`Production Data Guard includes production and excludes ${excluded} ${domain} records`, () => {
    const result = productionGuard().sanitize(records(domain, excluded));
    assert.deepEqual(result.records.map((record) => record.id), [`${domain}-production`]);
    assert.equal(result.excluded[0].reason, `PROVENANCE_${excluded}`);
    assert.equal(result.quality.status, 'PARTIAL');
  });
}

test('Production Data Guard excludes uncertain legacy records by default', () => {
  const result = productionGuard().sanitize([{ id: 'unknown-legacy' }]);
  assert.equal(result.records.length, 0);
  assert.equal(result.excluded[0].reason, 'UNCERTAIN_LEGACY_PROVENANCE');
});

test('approved server legacy policy preserves reviewed operational records', () => {
  const guard = createProductionDataGuard({ environment: 'production', legacyClassifier: (record) => record.verifiedOperationalRecord === true ? 'PRODUCTION' : null });
  const result = guard.sanitize([{ id: 'reviewed-legacy', verifiedOperationalRecord: true }, { id: 'uncertain-legacy' }]);
  assert.deepEqual(result.records.map((record) => record.id), ['reviewed-legacy']);
  assert.equal(result.diagnostics.trustedLegacyCount, 1);
  assert.equal(result.quality.status, 'PARTIAL');
});

test('production clients cannot request non-production data', () => {
  const guard = productionGuard();
  assert.throws(() => guard.sanitize([], { includeTestData: true }), /POLICY_OVERRIDE_FORBIDDEN/);
  assert.throws(() => guard.sanitize([], { productionOnly: false }), /POLICY_OVERRIDE_FORBIDDEN/);
  assert.throws(() => guard.sanitize([], { requestedProvenance: 'TEST' }), /POLICY_OVERRIDE_FORBIDDEN/);
});

test('controlled test environment can inspect fixtures without weakening production policy', () => {
  const guard = createProductionDataGuard({ environment: 'test' });
  assert.equal(guard.sanitize([{ id: 'fixture', provenance: 'TEST' }], { productionOnly: false }).records.length, 1);
  assert.deepEqual(productionGuard().queryCondition(), { provenance: 'PRODUCTION' });
});

test('record creation provenance is derived from trusted runtime and source', () => {
  assert.equal(provenanceForCreation({ environment: 'production' }), 'PRODUCTION');
  assert.equal(provenanceForCreation({ environment: 'production', source: 'fixture' }), 'TEST');
  assert.equal(createRecordProvenance({ environment: 'development' }).provenance, 'DEVELOPMENT');
});

test('enabled operational capabilities cannot bypass provenance enforcement', async () => {
  const registry = await buildAIRegistry();
  assert.ok(registry.capabilities.list({ enabledOnly: true }).every((capability) => capability.productionDataOnly && capability.provenanceAware && capability.dataQualityAware));
  assert.ok(registry.tools.list({ enabledOnly: true }).every((tool) => tool.productionDataOnly && tool.dataQualityAware && tool.schoolScoped));
});
