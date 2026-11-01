import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildTiDBSchemaEvidenceArtifacts } from '../scripts/publish-tidb-schema-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const normalizeLineEndings = (text) => text.replace(/\r\n?/g, '\n');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/tidb-schema-requirements-manifest.json'), 'utf8'));
const artifacts = buildTiDBSchemaEvidenceArtifacts(manifest);

test('schema publication preserves evidence-only status and maps every discovered entity', async () => {
  const inventory = JSON.parse(artifacts.get('docs/tidb-schema-entity-inventory.json'));
  assert.equal(inventory.status, 'EVIDENCE_ONLY_NOT_CANONICAL');
  assert.equal(inventory.entities.length, manifest.tables.length);
  assert.equal(inventory.entities.length, 164);
  assert.equal(inventory.entities.filter((entity) => entity.status === 'RUNTIME_TIDB_DDL_PRESENT_NOT_LIVE_VERIFIED').length, manifest.runtimeTiDBDefinitionTableCount);
  assert.ok(inventory.entities.some((entity) => entity.status === 'UNRESOLVED_NOT_CANONICAL'));
  assert.ok(inventory.entities.some((entity) => entity.name === 'users' && entity.sourceFiles.includes('src/auth.js')));
  assert.ok(inventory.entities.some((entity) => entity.name === 'portal_users' && entity.runtimeRequiredness !== undefined));
  assert.equal(inventory.views.length, manifest.historicalViews.length);
  assert.ok(inventory.views.every((view) => view.status === 'UNRESOLVED_NOT_CANONICAL'));
});

test('relationship publication labels historical keys as candidates and joins as observations', () => {
  const relationships = artifacts.get('docs/tidb-schema-relationship-map.md');
  assert.match(relationships, /Historical FK candidate entries:/);
  assert.match(relationships, /Runtime JOIN query observations:/);
  assert.match(relationships, /not verified relationships/i);
  assert.match(relationships, /participates in a runtime join/);
});

test('authoritative schema publication fails closed while domain contracts remain unresolved', () => {
  const schema = artifacts.get('docs/tidb-authoritative-schema.md');
  const coverage = artifacts.get('docs/tidb-application-schema-coverage.md');
  assert.match(schema, /NOT AUTHORITATIVE; fresh initialization is not enabled/);
  assert.match(schema, /No new canonical application DDL migration is published/);
  assert.match(coverage, /\*\*Status: INCOMPLETE\.\*\*/);
  assert.match(coverage, /No domain is schema-complete/);
});

test('published evidence docs match the deterministic source manifest', async () => {
  for (const [relativePath, expected] of artifacts) {
    assert.equal(normalizeLineEndings(await readFile(resolve(root, relativePath), 'utf8')), normalizeLineEndings(expected), `${relativePath} needs regeneration`);
  }
});

test('live schema report does not fabricate a comparison without connectivity or a canonical contract', async () => {
  const report = JSON.parse(await readFile(resolve(root, 'docs/tidb-live-schema-verification.json'), 'utf8'));
  assert.equal(report.status, 'NOT_VERIFIED');
  assert.equal(report.connection.connectionAttempted, false);
  assert.equal(report.expectedSchema.status, 'BLOCKED_NO_AUTHORITATIVE_TIDB_CONTRACT');
  assert.equal(report.actualSchema.tableCount, null);
  assert.equal(report.comparison.status, 'NOT_RUN');
  assert.equal(report.releaseGate, 'BLOCKED');
});
