import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'docs/tidb-schema-requirements-manifest.json'), 'utf8'));
const metadataNames = new Set(manifest.tables.filter((table) => (table.runtimeTiDBDefinitionEvidence ?? []).length > 0).map((table) => table.name));
const tableFindings = new Map((manifest.runtimeContractReconciliation?.tableDispositions ?? []).map((item) => [item.name, item]));
const viewFindings = new Map((manifest.runtimeContractReconciliation?.viewDispositions ?? []).map((item) => [item.name, item]));
const originalTables = manifest.tables.filter((table) => !metadataNames.has(table.name));

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:test|spec)\.(?:mjs|cjs|js|ts)$/.test(item.name)) files.push(path);
  }
  return files.sort();
}
const testFiles = await walk(resolve(root, 'test'));
const testContents = await Promise.all(testFiles.map(async (path) => ({
  path: path.slice(root.length + 1).replaceAll('\\', '/'),
  lines: (await readFile(path, 'utf8')).split(/\r?\n/)
})));
function testReferences(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
  return testContents.flatMap((file) => {
    const lines = [];
    file.lines.forEach((line, index) => { if (pattern.test(line)) lines.push(index + 1); });
    return lines.length ? [{ source: file.path, lines }] : [];
  });
}

function classification(table, finding) {
  if (finding?.disposition === 'REQUIRED_CURRENT_RUNTIME') return 'ACTIVE_APPLICATION_TABLE';
  if (finding?.disposition === 'LEGACY_COMPATIBILITY_ONLY') return 'DUPLICATE_OR_ALTERNATIVE';
  return 'UNRESOLVED';
}

function confidenceFor(table, finding, kind) {
  if (kind === 'view') return finding?.disposition === 'REQUIRED_SUPPORTED_WORKFLOW' ? 'MEDIUM' : 'LOW';
  if (finding?.disposition === 'REQUIRED_CURRENT_RUNTIME' && (table.runtimeSqlEvidence ?? []).length) return 'HIGH';
  if (finding?.disposition === 'LEGACY_COMPATIBILITY_ONLY') return 'MEDIUM';
  return 'LOW';
}

function unresolvedQuestions(table, finding, kind) {
  const questions = [
    ...(finding?.unresolved ?? []),
    ...(finding?.missingEvidence ?? [])
  ];
  if (kind === 'table' && !metadataNames.has(table.name)) {
    questions.push('Canonical TiDB column types, nullability, defaults, encoding, keys, indexes, foreign-key actions, and target-version behavior are not approved.');
  }
  if (kind === 'view') questions.push('A complete active TiDB view definition and all canonical base-table dependencies are not approved.');
  return [...new Set(questions)];
}

function tableRecord(table) {
  const finding = tableFindings.get(table.name);
  const disposition = classification(table, finding);
  const runtimeSql = table.runtimeSqlEvidence ?? [];
  const related = (table.historicalForeignKeyEvidence ?? []).map((candidate) => ({ candidate, status: 'HISTORICAL_CANDIDATE_NOT_CANONICAL' }));
  return {
    name: table.name,
    objectType: 'TABLE',
    evidenceSources: [...new Set([
      ...(table.sourceFiles ?? []),
      ...(table.historicalMigrations ?? [])
    ])].sort(),
    applicationModules: table.runtimeModules ?? [],
    sqlQueries: runtimeSql.map((item) => ({
      operation: item.operation,
      source: item.source,
      line: item.line,
      columnsWritten: item.writeColumns ?? [],
      projectionEvidence: item.selectProjectionEvidence ?? null,
      statementPrefix: item.statementPrefix ?? null
    })),
    migrationReferences: [...new Set(table.historicalMigrations ?? [])].sort(),
    historicalCreateCount: table.historicalCreateOccurrences ?? 0,
    historicalAlterCount: table.historicalAlterOccurrences ?? 0,
    testReferences: testReferences(table.name),
    relationships: related,
    activelyRequired: disposition === 'ACTIVE_APPLICATION_TABLE',
    proposedClassification: disposition,
    confidence: confidenceFor(table, finding, 'table'),
    outstandingQuestions: unresolvedQuestions(table, finding, 'table'),
    finalDisposition: disposition === 'ACTIVE_APPLICATION_TABLE' ? 'ACTIVE_RUNTIME_DEPENDENCY_SCHEMA_CONTRACT_INCOMPLETE' : disposition === 'DUPLICATE_OR_ALTERNATIVE' ? 'LEGACY_COMPATIBILITY_ALTERNATIVE_FRESH_INSTALL_REQUIREMENT_UNRESOLVED' : 'UNRESOLVED_REQUIRES_WORKFLOW_OR_RETIREMENT_EVIDENCE',
    runtimeRequiredness: table.runtimeRequiredness ?? null,
    runtimeOperations: table.runtimeOperations ?? {},
    runtimeWriteColumns: table.runtimeWriteColumns ?? [],
    historicalColumns: table.historicalColumnCandidates ?? [],
    primaryKeyCandidates: table.historicalPrimaryKeyEvidence ?? [],
    uniqueCandidates: table.historicalUniqueEvidence ?? [],
    indexCandidates: table.historicalIndexEvidence ?? [],
    foreignKeyCandidates: table.historicalForeignKeyEvidence ?? [],
    dispositionEvidence: finding?.evidence ?? [],
    canonicalDefinitionStatus: (table.runtimeTiDBDefinitionEvidence ?? []).length ? 'SOURCE_TIDB_DDL_PRESENT_NOT_LIVE_VERIFIED' : 'NO_APPROVED_CANONICAL_TIDB_DEFINITION'
  };
}

function viewRecord(view) {
  const finding = viewFindings.get(view.name);
  const active = finding?.disposition === 'REQUIRED_SUPPORTED_WORKFLOW';
  const classification = active ? 'ACTIVE_APPLICATION_VIEW' : 'UNRESOLVED';
  return {
    name: view.name,
    objectType: 'VIEW',
    evidenceSources: [...new Set([...(view.migrations ?? []), ...(finding?.evidence ?? []), ...(finding?.affectedWorkflowEvidence ?? [])])].sort(),
    applicationModules: finding?.affectedWorkflowEvidence ?? [],
    sqlQueries: [],
    migrationReferences: view.migrations ?? [],
    testReferences: testReferences(view.name),
    relationships: [],
    activelyRequired: active,
    proposedClassification: classification,
    confidence: confidenceFor(view, finding, 'view'),
    outstandingQuestions: unresolvedQuestions(view, finding, 'view'),
    finalDisposition: active ? 'SUPPORTED_WORKFLOW_REFERENCE_VIEW_DEFINITION_NOT_CANONICAL' : 'UNRESOLVED_REQUIRES_CURRENT_CONSUMER_OR_RETIREMENT_EVIDENCE',
    historicalDefinitionStatus: 'HISTORICAL_CANDIDATE_NOT_CANONICAL',
    dispositionEvidence: finding?.evidence ?? []
  };
}

const entries = [...originalTables.map(tableRecord), ...manifest.historicalViews.map(viewRecord)];
const counts = Object.fromEntries(['ACTIVE_APPLICATION_TABLE', 'ACTIVE_APPLICATION_VIEW', 'HISTORICAL_OR_OBSOLETE', 'SUPERSEDED', 'DUPLICATE_OR_ALTERNATIVE', 'UNRESOLVED'].map((name) => [name, entries.filter((entry) => entry.proposedClassification === name).length]));
const originalNames = new Set(originalTables.map((table) => table.name));
const uniqueNames = new Set(entries.map((entry) => `${entry.objectType}:${entry.name}`));
if (originalTables.length !== 159 || uniqueNames.size !== entries.length || originalNames.size !== 159) {
  throw new Error(`Expected 159 distinct original application tables, found ${originalTables.length}; duplicate identities: ${entries.length - uniqueNames.size}`);
}

const active = entries.filter((entry) => entry.activelyRequired);
const candidateRelationships = entries.flatMap((entry) => entry.relationships ?? []);
const indexes = entries.flatMap((entry) => entry.indexCandidates ?? []);
const completeDdlCount = entries.filter((entry) => entry.canonicalDefinitionStatus === 'APPROVED_COMPLETE').length;
const modules = [...new Set(active.flatMap((entry) => entry.applicationModules))].sort();
const ledger = {
  formatVersion: 1,
  status: 'INCOMPLETE_EVIDENCE_RECONCILIATION_NOT_CANONICAL',
  repositoryHead: manifest.repositoryHead,
  targetDatabase: manifest.targetDatabase,
  singleSchoolId: manifest.singleSchoolId,
  originalApplicationTableCount: originalTables.length,
  historicalViewCount: manifest.historicalViews.length,
  platformMetadataExcludedFromOriginalCount: [...metadataNames].sort(),
  classificationCounts: counts,
  evidenceSummary: {
    runtimeSqlObservations: manifest.runtimeSqlEvidenceCount,
    runtimeSqlConfirmedApplicationTables: originalTables.filter((table) => (table.runtimeSqlEvidence ?? []).length > 0).length,
    historicalRelationshipCandidates: candidateRelationships.length,
    confirmedRelationships: 0,
    historicalIndexCandidates: indexes.length,
    confirmedApplicationIndexes: 0,
    completeAuthoritativeApplicationDdlDefinitions: completeDdlCount,
    activeModulesMappedToEntities: modules.length,
    applicationModulesWithCompleteAuthoritativeContracts: 0,
    queryDependencyValidation: 'BLOCKED_NO_APPROVED_COLUMN_CONTRACT',
    modules
  },
  inventoryChanges: {
    originalTableNamesPreserved: true,
    originalApplicationTableNames: originalTables.map((table) => table.name).sort(),
    metadataTablesExcludedBecauseTheyArePlatformInfrastructureWithSourceTiDbDdl: [...metadataNames].sort(),
    viewsTrackedSeparately: manifest.historicalViews.map((view) => view.name).sort()
  },
  rules: [
    'Historical DDL, PostgreSQL definitions, and inferred relationships are evidence candidates only.',
    'No object is called obsolete solely because a static scan found no runtime SQL.',
    'No historical relationship or index candidate is counted as a confirmed canonical constraint.',
    'Unresolved production dependencies are not promoted to executable DDL.'
  ],
  entries
};

const md = [
  '# TiDB schema reconciliation — Phase 2B', '',
  '> **Status: INCOMPLETE.** This repository evidence ledger does not authorize production initialization or claim live TiDB compatibility.', '',
  `- Original application/historical tables: **${originalTables.length}** (the five source-defined platform metadata tables are tracked outside this original count).`,
  `- Historical views tracked separately: **${manifest.historicalViews.length}**.`,
  `- Table classifications: ${JSON.stringify(counts)}.`,
  `- Views: ${counts.ACTIVE_APPLICATION_VIEW} supported-workflow candidates and ${manifest.historicalViews.length - counts.ACTIVE_APPLICATION_VIEW} unresolved.`,
  `- Confirmed canonical application relationships: **0**; historical FK candidates: **${candidateRelationships.length}**.`,
  `- Confirmed canonical application indexes: **0**; historical index candidates: **${indexes.length}**.`,
  `- Complete authoritative application DDL definitions: **${completeDdlCount}**.`,
  `- Application modules mapped to active entities: **${modules.length}**; modules with complete authoritative contracts: **0**.`,
  '- Runtime query references are traceable in the JSON ledger, but full dependency validation is blocked because no canonical column contract exists.', '',
  'The classifications distinguish direct runtime dependencies, one legacy compatibility alternative, and objects for which current workflow evidence is insufficient. Historical candidates are preserved in the ledger. The required next decisions are domain-owner resolution of unresolved workflows and conflicts, approval of exact physical contracts and target TiDB version, then live comparison against a verified database.', '',
  'The five metadata tables (`osaah_fresh_installations`, `schema_baselines`, `schema_migration_lock`, `schema_migration_runs`, `schema_migrations`) have source TiDB DDL, but have not been live-verified. They are platform infrastructure rather than members of the original 159 application/historical table set.', '',
  '## Artifacts', '',
  '- [Authoritative schema status](tidb-authoritative-schema.md)',
  '- [Entity inventory](tidb-schema-entity-inventory.json)',
  '- [Relationship evidence](tidb-schema-relationship-map.md)',
  '- [Application coverage](tidb-application-schema-coverage.md)', '',
  'The JSON ledger contains one entry for every original table and every historical view, with runtime modules, SQL references, migration provenance, lexical test references, relationship candidates, confidence, questions, and disposition. Test references identify literal object-name mentions and do not alone prove complete workflow coverage.', ''
].join('\n');

await writeFile(resolve(root, 'docs/tidb-schema-reconciliation.json'), `${JSON.stringify(ledger, null, 2)}\n`);
await writeFile(resolve(root, 'docs/tidb-schema-reconciliation.md'), `${md}\n`);
console.log(JSON.stringify({ status: ledger.status, originalApplicationTableCount: originalTables.length, classificationCounts: counts, views: manifest.historicalViews.length, activeModules: modules.length, completeAuthoritativeApplicationDdlDefinitions: completeDdlCount }));
