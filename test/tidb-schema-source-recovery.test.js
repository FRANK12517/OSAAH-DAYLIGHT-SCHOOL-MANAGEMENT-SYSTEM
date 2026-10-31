import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (name) => JSON.parse(await readFile(resolve(root, 'docs', name), 'utf8'));
const confidenceValues = new Set(['AUTHORITATIVE', 'CORROBORATED', 'INFERRED', 'UNKNOWN']);

test('Phase 2C source evidence preserves active and unresolved scope without promoting candidate DDL', async () => {
  const evidence = await json('tidb-schema-source-evidence.json');
  const canonical = await json('tidb-authoritative-schema.json');
  assert.equal(evidence.verifiedBaseline.commit, 'c89975d1306d7686adec12c3bbe20e177927570f');
  assert.equal(evidence.counts.originalApplicationTables, 159);
  assert.equal(evidence.activeTables.length, 66);
  assert.equal(evidence.counts.fullAuthoritativeActiveTiDBDefinitions, 0);
  assert.equal(evidence.counts.partiallyRecoveredActiveDefinitions, 66);
  assert.equal(evidence.unresolvedTableDispositions.length, 92);
  assert.equal(evidence.counts.compatibilityAlternatives, 1);
  assert.equal(evidence.counts.supportedHistoricalViews, 5);
  assert.equal(evidence.counts.unresolvedViews, 3);
  assert.equal(evidence.counts.runtimeWriteColumnPairs, 129);
  assert.equal(evidence.counts.confirmedPhysicalColumns, 0);
  assert.equal(evidence.counts.confirmedForeignKeys, 0);
  assert.equal(evidence.counts.runtimeModulesMapped, 115);
  assert.equal(evidence.counts.runtimeModulesWithCompleteContracts, 0);
  assert.equal(canonical.status, 'BLOCKED_NO_COMPLETE_AUTHORITATIVE_APPLICATION_CONTRACT');
  assert.equal(canonical.executable, false);
  assert.deepEqual(canonical.tables, []);
  assert.deepEqual(canonical.views, []);
  assert.deepEqual(canonical.constraints, []);
  assert.deepEqual(canonical.indexes, []);
});

test('each active table property has an explicit confidence grade and evidence boundary', async () => {
  const evidence = await json('tidb-schema-source-evidence.json');
  for (const table of evidence.activeTables) {
    assert.ok(table.name);
    assert.ok(table.sources.length > 0, `${table.name} must cite source evidence`);
    assert.equal(table.completeAuthoritativeTiDBDefinition, false);
    for (const [property, detail] of Object.entries(table.properties)) {
      assert.ok(confidenceValues.has(detail.confidence), `${table.name}.${property} confidence missing/invalid`);
      if (detail.confidence !== 'UNKNOWN') assert.ok(detail.sources?.length || detail.basis, `${table.name}.${property} needs provenance`);
    }
    assert.equal(table.properties.nullabilityDefaultsReferentialActionsCharsetsCollationsTimestampSemantics.confidence, 'UNKNOWN');
  }
});

test('required Phase 2C artifacts are present and PostgreSQL definitions remain non-authoritative', async () => {
  const names = [
    'tidb-schema-source-recovery.md',
    'tidb-schema-source-evidence.json',
    'tidb-authoritative-schema.md',
    'tidb-authoritative-schema.json',
    'tidb-schema-entity-inventory.json',
    'tidb-schema-relationship-map.md',
    'tidb-application-schema-coverage.md',
    'tidb-schema-recovery-blockers.md'
  ];
  for (const name of names) await readFile(resolve(root, 'docs', name), 'utf8');
  const evidence = await json('tidb-schema-source-evidence.json');
  for (const table of evidence.activeTables) {
    for (const source of table.parallelPostgresDefinitions) assert.equal(source.status, 'NOT_INDEPENDENT_AND_NOT_TIDB_AUTHORITY');
  }
});
