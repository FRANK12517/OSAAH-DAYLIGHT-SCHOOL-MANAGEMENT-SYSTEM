import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(root, 'docs/tidb-schema-requirements-manifest.json');
const docs = resolve(root, 'docs');
const sourceEvidence = JSON.parse(await readFile(resolve(docs, 'tidb-schema-source-evidence.json'), 'utf8'));
const authoritativeSchema = JSON.parse(await readFile(resolve(docs, 'tidb-authoritative-schema.json'), 'utf8'));

function historicalColumnEvidence(table) {
  return (table.historicalColumnCandidates ?? []).map((column) => ({
    ...column,
    evidenceStatus: 'HISTORICAL_CANDIDATE_NOT_CANONICAL'
  }));
}

function entityInventory(manifest) {
  const dispositions = new Map((manifest.runtimeContractReconciliation?.tableDispositions ?? []).map((item) => [item.name, item]));
  const viewDispositions = new Map((manifest.runtimeContractReconciliation?.viewDispositions ?? []).map((item) => [item.name, item]));
  return {
    formatVersion: 1,
    status: 'EVIDENCE_ONLY_NOT_CANONICAL',
    repositoryHead: manifest.repositoryHead,
    targetDatabase: manifest.targetDatabase,
    singleSchoolId: manifest.singleSchoolId,
    sourceInventory: manifest.sourceInventory,
    scope: {
      migrationFileCount: manifest.migrationFileCount,
      runtimeSourceFileCount: manifest.runtimeSourceFileCount,
      runtimeSqlEvidenceCount: manifest.runtimeSqlEvidenceCount,
      historicalTableNameCount: manifest.historicalTableNameCount,
      historicalViewCount: manifest.historicalViews.length,
      runtimeSqlConfirmedTableCount: manifest.evidenceCounts.runtimeSqlConfirmedTableCount,
      runtimeWriteColumnPairs: manifest.evidenceCounts.runtimeWriteColumnPairs,
      historicalColumnCandidatePairs: manifest.evidenceCounts.historicalColumnCandidatePairs,
      historicalForeignKeyEvidenceItems: manifest.evidenceCounts.historicalForeignKeyEvidenceItems,
      historicalPrimaryKeyEvidenceItems: manifest.evidenceCounts.historicalPrimaryKeyEvidenceItems,
      historicalUniqueEvidenceItems: manifest.evidenceCounts.historicalUniqueEvidenceItems,
      historicalSecondaryIndexEvidenceItems: manifest.evidenceCounts.historicalSecondaryIndexEvidenceItems
    },
    entities: manifest.tables.map((table) => ({
      name: table.name,
      status: (table.runtimeTiDBDefinitionEvidence ?? []).length ? 'RUNTIME_TIDB_DDL_PRESENT_NOT_LIVE_VERIFIED' : 'UNRESOLVED_NOT_CANONICAL',
      classification: table.classification,
      runtimeRequiredness: table.runtimeRequiredness,
      runtimeOperations: table.runtimeOperations,
      runtimeModules: table.runtimeModules,
      sourceFiles: table.sourceFiles,
      runtimeWriteColumns: table.runtimeWriteColumns,
      runtimeWriteColumnsWithoutSchemaEvidence: table.runtimeWriteColumnsWithoutSchemaEvidence,
      reconciliation: dispositions.get(table.name) ?? null,
      runtimeSqlEvidence: (table.runtimeSqlEvidence ?? []).map(({ table: tableName, operation, source, line, writeColumns, selectProjectionEvidence, parameterized, statementPrefix }) => ({
        table: tableName,
        operation,
        source,
        line,
        writeColumns,
        selectProjectionEvidence,
        parameterized,
        statementPrefix
      })),
      historical: {
        migrations: table.historicalMigrations,
        createOccurrences: table.historicalCreateOccurrences,
        alterOccurrences: table.historicalAlterOccurrences,
        columnEvidence: historicalColumnEvidence(table),
        primaryKeyCandidates: table.historicalPrimaryKeyEvidence,
        uniqueCandidates: table.historicalUniqueEvidence,
        foreignKeyCandidates: table.historicalForeignKeyEvidence,
        indexCandidates: table.historicalIndexEvidence,
        parallelPostgresDefinitionEvidence: table.parallelPostgresDefinitionEvidence,
        runtimeTiDBDefinitionEvidence: table.runtimeTiDBDefinitionEvidence
      },
      disposition: dispositions.get(table.name) ?? null,
      unresolvedDimensions: table.unresolvedDimensions,
      unresolved: table.unresolved
    })),
    views: manifest.historicalViews.map((view) => ({
      ...view,
      status: 'UNRESOLVED_NOT_CANONICAL',
      reconciliation: viewDispositions.get(view.name) ?? null
    })),
    unresolvedSummary: manifest.unresolvedSummary,
    sourceRecovery: { baselineCommit: sourceEvidence.verifiedBaseline.commit, status: sourceEvidence.status, confidenceLevels: { AUTHORITATIVE: 'AUTHORITATIVE', CORROBORATED: 'CORROBORATED', INFERRED: 'INFERRED', UNKNOWN: 'UNKNOWN' }, counts: sourceEvidence.counts, activeTables: sourceEvidence.activeTables.map(({ name, completeAuthoritativeTiDBDefinition, sources, properties }) => ({ name, completeAuthoritativeTiDBDefinition, sources, properties })), recoveryGeneratedFrom: 'docs/tidb-schema-requirements-manifest.json' },
    rule: 'Evidence records application observations and historical candidates. It does not define executable TiDB DDL.'
  };
}

function relationshipMap(manifest) {
  const fkRows = [];
  const joinRows = [];
  for (const table of manifest.tables) {
    for (const candidate of table.historicalForeignKeyEvidence ?? []) {
      fkRows.push({ table: table.name, candidate, migrations: table.historicalMigrations ?? [] });
    }
    for (const evidence of table.runtimeSqlEvidence ?? []) {
      if (evidence.operation === 'join') joinRows.push({
        table: table.name,
        source: evidence.source,
        line: evidence.line,
        projection: evidence.selectProjectionEvidence
      });
    }
  }
  const domains = manifest.runtimeContractReconciliation.domainCompletionMatrix ?? [];
  const lines = [
    '# TiDB schema relationship map',
    '',
    '> **Status: EVIDENCE ONLY.** Historical foreign-key candidates are not verified relationships. Runtime JOIN evidence proves tables participate in a query, not that a database constraint or delete action is required.',
    '',
    `Phase 2C source recovery reviewed ${sourceEvidence.counts.runtimeJoinObservations} runtime JOIN observations and ${sourceEvidence.counts.historicalForeignKeyCandidates} historical FK candidates. Confirmed canonical foreign keys/indexes remain 0.`,
    '',
    `- Historical FK candidate entries: ${fkRows.length}.`,
    '- Confirmed canonical application relationships: 0.',
    '- Confirmed canonical application indexes: 0.',
    `- Runtime JOIN query observations: ${joinRows.length}.`,
    `- Domain groups reviewed: ${domains.length}.`,
    '- No relationship is promoted to canonical until local and referenced column types, nullability, index coverage, lifecycle, referential actions, and TiDB version compatibility are verified.',
    '',
    '## Historical foreign-key candidates',
    ''
  ];
  for (const row of fkRows) lines.push(`- \`${row.table}\`: ${row.candidate} (historical evidence: ${row.migrations.join(', ') || 'migration source not resolved'})`);
  lines.push('', '## Runtime table joins', '');
  for (const row of joinRows) lines.push(`- \`${row.table}\` participates in a runtime join at [${row.source}](${row.source}:${row.line}); projection evidence: \`${String(row.projection ?? '').replaceAll('`', "'")}\`.`);
  lines.push('', '## Domain relationship decisions', '');
  for (const domain of domains) {
    lines.push(`### ${domain.domain}`, '');
    lines.push(`- State: **${domain.status}**.`, `- Tables: ${domain.coreTables.map((name) => `\`${name}\``).join(', ')}.`, `- Outstanding relationship/design decisions: ${domain.blockers.join('; ')}.`, '');
  }
  lines.push('## Promotion rule', '', 'A candidate in this map is not a schema declaration. The application must not initialize or report readiness from this map. Each approved relation must be encoded in the canonical TiDB contract and validated against TiDB metadata.');
  return { fkRows, joinRows, markdown: `${lines.join('\n')}\n` };
}

function coverageDocument(manifest) {
  const domains = manifest.runtimeContractReconciliation.domainCompletionMatrix ?? [];
  const counts = manifest.evidenceCounts;
  const history = manifest.historicalReconciliationCounts;
  const dispositions = new Map((manifest.runtimeContractReconciliation?.tableDispositions ?? []).map((item) => [item.name, item.disposition]));
  const moduleTables = new Map();
  for (const table of manifest.tables) {
    if (dispositions.get(table.name) !== 'REQUIRED_CURRENT_RUNTIME' || (table.runtimeTiDBDefinitionEvidence ?? []).length) continue;
    for (const module of table.runtimeModules ?? []) {
      if (!moduleTables.has(module)) moduleTables.set(module, []);
      moduleTables.get(module).push(table.name);
    }
  }
  const lines = [
    '# TiDB application-to-schema coverage',
    '',
    '> **Status: INCOMPLETE.** This is a source-coverage map, not proof of physical TiDB schema coverage.',
    '',
    '## Phase 2C source recovery',
    '',
    `- Active runtime tables assessed: ${sourceEvidence.counts.activeRuntimeTablesAssessed}; authoritative complete TiDB contracts: ${sourceEvidence.counts.fullAuthoritativeActiveTiDBDefinitions}; unresolved tables: ${sourceEvidence.counts.unresolvedTables}; unresolved views: ${sourceEvidence.counts.unresolvedViews}.`,
    `- Runtime write-column expectations: ${sourceEvidence.counts.runtimeWriteColumnPairs}; confirmed physical columns: ${sourceEvidence.counts.confirmedPhysicalColumns}. Complete runtime module contracts: ${sourceEvidence.counts.runtimeModulesWithCompleteContracts}.`,
    '',
    '## Repository evidence',
    '',
    `- Numbered SQL migration files: ${manifest.migrationFileCount}.`,
    `- Runtime source files scanned: ${manifest.runtimeSourceFileCount}.`,
    `- Extracted runtime SQL observations: ${manifest.runtimeSqlEvidenceCount}.`,
    `- Runtime-SQL-confirmed table names: ${counts.runtimeSqlConfirmedTableCount}.`,
    `- Runtime write-column observations: ${counts.runtimeWriteColumnPairs}.`,
    `- Native platform metadata definitions in TiDB source: ${manifest.runtimeTiDBDefinitionTableCount}; these are not live-verified application schema.`,
    `- Historical table-name candidates: ${history.historicalNamesTotal}.`,
    `- Historical names with extracted runtime SQL: ${history.historicalNamesWithExtractedRuntimeSql}.`,
    `- Runtime-linked names whose SQL was not statically extracted: ${history.historicalNamesWithRuntimeFileLinksButNoExtractedSql}.`,
    `- Historical names without an extracted runtime operation: ${history.historicalNamesWithoutExtractedRuntimeOperation}.`,
    `- Historical views: ${manifest.historicalViews.length}.`,
    `- Original application tables: ${manifest.tables.filter((table) => !(table.runtimeTiDBDefinitionEvidence ?? []).length).length}.`,
    `- Source-classified active runtime tables: ${(manifest.runtimeContractReconciliation?.tableDispositions ?? []).filter((item) => item.disposition === 'REQUIRED_CURRENT_RUNTIME' && !(manifest.tables.find((table) => table.name === item.name)?.runtimeTiDBDefinitionEvidence ?? []).length).length}.`,
    `- Legacy compatibility alternatives: ${(manifest.runtimeContractReconciliation?.tableDispositions ?? []).filter((item) => item.disposition === 'LEGACY_COMPATIBILITY_ONLY').length}.`,
    `- Application tables with unresolved disposition: ${(manifest.runtimeContractReconciliation?.tableDispositions ?? []).filter((item) => item.disposition === 'UNRESOLVED' && !(manifest.tables.find((table) => table.name === item.name)?.runtimeTiDBDefinitionEvidence ?? []).length).length}.`,
    `- Supported-workflow historical views: ${(manifest.runtimeContractReconciliation?.viewDispositions ?? []).filter((item) => item.disposition === 'REQUIRED_SUPPORTED_WORKFLOW').length}; unresolved views: ${(manifest.runtimeContractReconciliation?.viewDispositions ?? []).filter((item) => item.disposition === 'UNRESOLVED').length}.`,
    '- Complete authoritative application DDL definitions: 0.',
    '',
    'These counts overlap by design. Static query extraction can miss dynamic SQL and does not establish requiredness, DDL, data lifecycle, or transaction semantics.',
    '',
    '## Domain coverage',
    ''
  ];
  for (const domain of domains) {
    lines.push(`### ${domain.domain}`, '', `- Status: **${domain.status}**.`, `- Core tables: ${domain.coreTables.map((name) => `\`${name}\``).join(', ')}.`, `- Evidence modules: ${domain.evidence.map((name) => `\`${name}\``).join(', ')}.`, `- Unresolved requirements: ${domain.blockers.join('; ')}.`, '');
    if (domain.views?.length) lines.push(`- Views: ${domain.views.map((name) => `\`${name}\``).join(', ')}.`, '');
  }
  lines.push(
    '## Cross-cutting coverage gaps',
    '',
    '- Exact active columns, types, nullability, defaults, physical keys, and TiDB-specific definitions are not established for all runtime entities.',
    '- Historical SQL, PostgreSQL-only schema evidence, and generated source scans remain candidates; they are not merged into an executable TiDB schema.',
    '- The target TiDB server version, SQL mode, default charset/collation, timezone, and foreign-key policy are not configured in repository deployment files.',
    '- `portal_users` is referenced by the separate Proprietor authentication path but has no TiDB DDL or secure bootstrap writer in the inspected migrations.',
    '- Historical fee views conflict; their exact output and financial semantics require owner review.',
    '- The full disposition of historical entities and dynamic query dependencies is not complete.',
    '',
    '## Release rule',
    '',
    'No domain is schema-complete until its required entities, query columns, constraints, relationships, indexes, and TiDB compatibility checks are approved and tested. The fresh initializer must continue to reject any plan with unresolved requirements.'
  );
  lines.splice(lines.indexOf('## Cross-cutting coverage gaps'), 0, '## Active runtime module-to-entity trace', '', `- Modules mapped to directly used application tables: ${moduleTables.size}.`, '- Complete authoritative schema contracts for these modules: 0.', '');
  for (const [module, tables] of [...moduleTables].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...new Set(tables)].sort().map((name) => '`' + name + '`').join(', ');
    lines.splice(lines.indexOf('## Cross-cutting coverage gaps'), 0, '- `' + module + '`: ' + names + '.');
  }
  return `${lines.join('\n')}\n`;
}

function authoritativeSchemaDocument(manifest, inventory, relations) {
  const counts = manifest.evidenceCounts;
  const domains = manifest.runtimeContractReconciliation.domainCompletionMatrix ?? [];
  const blockers = [...new Set(domains.flatMap((domain) => domain.blockers))];
  const lines = [
    '# OSAAH Daylight authoritative TiDB schema',
    '',
    '> **Release status: NOT AUTHORITATIVE; fresh initialization is not enabled.** No complete canonical TiDB DDL plan is present in this repository state. This document records confirmed runtime facts and the evidence required before DDL can be approved.',
    '',
    '## Confirmed application constraints',
    '',
    `- Database: \`${manifest.targetDatabase}\`.`,
    `- Single-school identity: \`${manifest.singleSchoolId}\`; no additional school scope is introduced by this schema work.`,
    '- Production adapter: explicit TiDB selection through mysql2 with TLS verification enabled.',
    `- Runtime source scan: ${manifest.runtimeSourceFileCount} source files, ${manifest.runtimeSqlEvidenceCount} SQL observations, ${counts.runtimeSqlConfirmedTableCount} statically SQL-confirmed table names, and ${counts.runtimeWriteColumnPairs} write-column observations.`,
    `- Current numbered repository SQL: ${manifest.migrationFileCount} files. These historical migrations are not, by themselves, a reviewed fresh-install plan.`,
    '',
    '## Evidence status',
    '',
    `The entity inventory contains ${inventory.entities.length} historical/runtime table names and ${inventory.views.length} historical view names. Runtime query evidence, historical DDL, and parallel PostgreSQL definitions are kept in separate evidence fields. ${inventory.entities.filter((entity) => entity.status === 'RUNTIME_TIDB_DDL_PRESENT_NOT_LIVE_VERIFIED').length} platform metadata tables have native TiDB DDL in source but are not live-verified; ${inventory.entities.filter((entity) => entity.status === 'UNRESOLVED_NOT_CANONICAL').length} application/historical objects remain unresolved for canonical DDL.`,
    '',
    `The relationship map contains ${relations.fkRows.length} historical foreign-key candidates and ${relations.joinRows.length} runtime JOIN observations. Neither set is treated as a TiDB constraint without field-level and lifecycle review.`,
    '',
    '## Required artifacts',
    '',
    '- [Entity inventory](tidb-schema-entity-inventory.json) keeps source-linked runtime observations and historical definitions separate.',
    '- [Per-object reconciliation ledger](tidb-schema-reconciliation.json) records every original application table and historical view.',
    '- [Relationship map](tidb-schema-relationship-map.md) distinguishes historical FK candidates from runtime joins.',
    '- [Application coverage](tidb-application-schema-coverage.md) tracks domain requirements and unresolved work.',
    '- [Fresh initialization safety](tidb-fresh-initialization.md) documents the fail-closed runner and current absence of an approved plan.',
    '',
    '## Decisions still required before an authoritative schema can be published',
    ''
  ];
  for (const blocker of blockers) lines.push(`- ${blocker}.`);
  lines.push(
    '- Confirm the actual TiDB target version and the deployment SQL mode, charset/collation, time zone, and foreign-key enforcement policy.',
    '- Reconcile every active repository query with its current table/column contract, including dynamic SQL and query paths not captured by static extraction.',
    '- Approve incompatible historical definitions only after tracing current writers, readers, test expectations, and data-retention behavior.',
    '- Verify DDL, indexes, constraints, views, timestamp behavior, JSON, generated-column indexes, and transaction/recovery behavior on the target TiDB release.',
    '',
    '## Phase 2C source recovery',
    '',
    `- Verified source-review baseline: \`${sourceEvidence.verifiedBaseline.commit}\`.`,
    `- Active runtime application tables assessed: ${sourceEvidence.counts.activeRuntimeTablesAssessed}; complete authoritative active TiDB definitions: ${sourceEvidence.counts.fullAuthoritativeActiveTiDBDefinitions}; partial evidence records: ${sourceEvidence.counts.partiallyRecoveredActiveDefinitions}.`,
    '- The executable canonical schema remains empty and fail-closed; no inferred or PostgreSQL-derived definition is promoted.',
    `- Machine-readable canonical status: \`${authoritativeSchema.status}\`.`,
    '',
    '## Migration policy',
    '',
    'No new canonical application DDL migration is published from this evidence set. Do not replay historical migrations against an empty TiDB database or use the unresolved inventory as DDL. The next schema version is intentionally unassigned until an approved, complete manifest and its postcondition tests exist.',
    '',
    'The code in `src/platform/tidb-fresh-initializer.js` remains a safety mechanism for a future reviewed canonical plan; it is not itself proof that the application schema is complete.'
  );
  return `${lines.join('\n')}\n`;
}

export function buildTiDBSchemaEvidenceArtifacts(manifest) {
  if (manifest?.status !== 'EVIDENCE_ONLY_NOT_CANONICAL' || manifest?.targetDatabase !== 'osaahdaylightschool' || manifest?.singleSchoolId !== 'sch_default_01') {
    throw new Error('Expected the preserved single-school TiDB evidence manifest.');
  }
  const inventory = entityInventory(manifest);
  const relations = relationshipMap(manifest);
  return new Map([
    ['docs/tidb-authoritative-schema.md', authoritativeSchemaDocument(manifest, inventory, relations)],
    ['docs/tidb-schema-entity-inventory.json', `${JSON.stringify(inventory, null, 2)}\n`],
    ['docs/tidb-schema-relationship-map.md', relations.markdown],
    ['docs/tidb-application-schema-coverage.md', coverageDocument(manifest)]
  ]);
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifacts = buildTiDBSchemaEvidenceArtifacts(manifest);
  for (const [relativePath, contents] of artifacts) await writeFile(resolve(root, relativePath), contents, 'utf8');
  process.stdout.write(`${JSON.stringify({ generated: [...artifacts.keys()], status: manifest.status, entityCount: manifest.tableCount, viewCount: manifest.historicalViews.length })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
