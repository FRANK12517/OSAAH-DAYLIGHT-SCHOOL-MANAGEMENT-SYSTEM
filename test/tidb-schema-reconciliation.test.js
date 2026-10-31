import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const ledger = JSON.parse(await readFile(resolve(root, 'docs/tidb-schema-reconciliation.json'), 'utf8'));
const source = JSON.parse(await readFile(resolve(root, 'docs/tidb-schema-requirements-manifest.json'), 'utf8'));
const inventory = JSON.parse(await readFile(resolve(root, 'docs/tidb-schema-entity-inventory.json'), 'utf8'));

test('Phase 2B reconciliation retains all 159 original application tables with unique identities', () => {
  const tables = ledger.entries.filter((entry) => entry.objectType === 'TABLE');
  const sourceTables = source.tables.filter((table) => !(table.runtimeTiDBDefinitionEvidence ?? []).length);
  assert.equal(ledger.originalApplicationTableCount, 159);
  assert.equal(tables.length, 159);
  assert.equal(new Set(tables.map((entry) => entry.name)).size, 159);
  assert.deepEqual(tables.map((entry) => entry.name).sort(), sourceTables.map((entry) => entry.name).sort());
  assert.deepEqual(ledger.inventoryChanges.metadataTablesExcludedBecauseTheyArePlatformInfrastructureWithSourceTiDbDdl, source.tables.filter((table) => (table.runtimeTiDBDefinitionEvidence ?? []).length).map((table) => table.name).sort());
});

test('reconciliation counts distinguish active, compatibility, unresolved, and view entities', () => {
  assert.equal(ledger.classificationCounts.ACTIVE_APPLICATION_TABLE, 66);
  assert.equal(ledger.classificationCounts.ACTIVE_APPLICATION_VIEW, 5);
  assert.equal(ledger.classificationCounts.DUPLICATE_OR_ALTERNATIVE, 1);
  assert.equal(ledger.classificationCounts.HISTORICAL_OR_OBSOLETE, 0);
  assert.equal(ledger.classificationCounts.SUPERSEDED, 0);
  assert.equal(ledger.classificationCounts.UNRESOLVED, 95);
  assert.equal(ledger.entries.filter((entry) => entry.objectType === 'VIEW').length, 8);
  assert.equal(ledger.entries.filter((entry) => entry.objectType === 'TABLE' && entry.proposedClassification === 'UNRESOLVED').length, 92);
  assert.equal(ledger.entries.filter((entry) => entry.objectType === 'VIEW' && entry.proposedClassification === 'UNRESOLVED').length, 3);
});

test('active entities have direct evidence and unresolved entities are never promoted to DDL', () => {
  for (const entry of ledger.entries) {
    assert.ok(entry.evidenceSources.length > 0, `${entry.objectType} ${entry.name} needs evidence`);
    if (entry.proposedClassification === 'ACTIVE_APPLICATION_TABLE') assert.ok(entry.sqlQueries.length > 0, `${entry.name} needs a runtime SQL observation`);
    if (entry.proposedClassification === 'UNRESOLVED' && entry.objectType === 'TABLE') assert.equal(entry.canonicalDefinitionStatus, 'NO_APPROVED_CANONICAL_TIDB_DEFINITION');
    if (entry.proposedClassification === 'UNRESOLVED' && entry.objectType === 'VIEW') assert.equal(entry.historicalDefinitionStatus, 'HISTORICAL_CANDIDATE_NOT_CANONICAL');
    assert.ok(Array.isArray(entry.outstandingQuestions));
  }
  assert.equal(ledger.evidenceSummary.completeAuthoritativeApplicationDdlDefinitions, 0);
  assert.equal(ledger.evidenceSummary.confirmedRelationships, 0);
  assert.equal(ledger.evidenceSummary.confirmedApplicationIndexes, 0);
});

test('every object carries query, migration, test, and relationship evidence fields', () => {
  for (const entry of ledger.entries) {
    assert.ok(Array.isArray(entry.applicationModules));
    assert.ok(Array.isArray(entry.sqlQueries));
    assert.ok(Array.isArray(entry.migrationReferences));
    assert.ok(Array.isArray(entry.testReferences));
    assert.ok(Array.isArray(entry.relationships));
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(entry.confidence));
  }
  assert.ok(ledger.entries.some((entry) => entry.testReferences.length > 0));
  for (const entry of ledger.entries.filter((item) => item.objectType === 'TABLE')) {
    for (const query of entry.sqlQueries) {
      assert.equal(typeof query.source, 'string');
      assert.ok(Number.isInteger(query.line) && query.line > 0);
      assert.ok(Array.isArray(query.columnsWritten));
    }
  }
  assert.equal(ledger.evidenceSummary.queryDependencyValidation, 'BLOCKED_NO_APPROVED_COLUMN_CONTRACT');
  assert.equal(ledger.evidenceSummary.applicationModulesWithCompleteAuthoritativeContracts, 0);
});

test('published entity inventory includes object-level disposition evidence', () => {
  assert.equal(inventory.entities.length, 164);
  assert.ok(inventory.entities.every((entity) => entity.reconciliation));
  assert.ok(inventory.views.every((view) => view.reconciliation));
});

test('reconciliation artifacts are deterministic for the checked-in source manifest', async () => {
  const document = await readFile(resolve(root, 'docs/tidb-schema-reconciliation.md'), 'utf8');
  assert.match(document, /Original application\/historical tables: \*\*159\*\*/);
  assert.match(document, /domain-owner resolution/i);
  assert.match(ledger.status, /INCOMPLETE/);
  assert.equal(ledger.repositoryHead, source.repositoryHead);
});
