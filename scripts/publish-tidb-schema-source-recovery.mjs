import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docs = resolve(root, 'docs');
const readJson = async (name) => JSON.parse(await readFile(resolve(docs, name), 'utf8'));
const manifest = await readJson('tidb-schema-requirements-manifest.json');
const reconciliation = await readJson('tidb-schema-reconciliation.json');
const baseline = 'c89975d1306d7686adec12c3bbe20e177927570f';
const confidence = Object.freeze({ authoritative: 'AUTHORITATIVE', corroborated: 'CORROBORATED', inferred: 'INFERRED', unknown: 'UNKNOWN' });
const dispositions = new Map((manifest.runtimeContractReconciliation?.tableDispositions ?? []).map((x) => [x.name, x]));
const active = manifest.tables.filter((t) => dispositions.get(t.name)?.disposition === 'REQUIRED_CURRENT_RUNTIME' && !(t.runtimeTiDBDefinitionEvidence ?? []).length).sort((a,b) => a.name.localeCompare(b.name));
const metadata = new Set(reconciliation.platformMetadataExcludedFromOriginalCount ?? []);
const unresolvedTables = (manifest.runtimeContractReconciliation?.tableDispositions ?? []).filter((x) => x.disposition === 'UNRESOLVED' && !metadata.has(x.name)).sort((a,b) => a.name.localeCompare(b.name));
const alternatives = (manifest.runtimeContractReconciliation?.tableDispositions ?? []).filter((x) => x.disposition === 'LEGACY_COMPATIBILITY_ONLY');
const viewDispositions = manifest.runtimeContractReconciliation?.viewDispositions ?? [];
const unresolvedViews = viewDispositions.filter((x) => x.disposition === 'UNRESOLVED');
const supportedViews = viewDispositions.filter((x) => x.disposition !== 'UNRESOLVED');
const unique = (xs) => [...new Set(xs)].sort((a,b) => a.localeCompare(b));
const sourcesFor = (t) => unique([...(t.historicalMigrations ?? []).map((p) => `schema/${p}`), ...(t.sourceFiles ?? []), ...(t.runtimeSqlEvidence ?? []).map((x) => x.source)]);
const candidateEvidence = (values, sources) => ({ confidence: values.length ? confidence.inferred : confidence.unknown, values, sources, basis: values.length ? 'Historical candidate only; active TiDB applicability is unverified.' : 'No candidate was found in the reviewed evidence.' });
const activeEntities = active.map((t) => ({
  name: t.name,
  classification: dispositions.get(t.name)?.disposition ?? 'REQUIRED_CURRENT_RUNTIME',
  completeAuthoritativeTiDBDefinition: false,
  sources: sourcesFor(t),
  modules: t.runtimeModules ?? [],
  runtimeEvidence: (t.runtimeSqlEvidence ?? []).map((q) => ({ operation: q.operation, source: q.source, line: q.line, writeColumns: q.writeColumns ?? [], selectProjectionEvidence: q.selectProjectionEvidence ?? null, statementPrefix: q.statementPrefix ?? null })),
  properties: {
    objectIdentity: { confidence: confidence.authoritative, value: t.name, basis: 'Phase 2B reconciliation inventory and current runtime SQL references; establishes application object identity only, not physical existence in TiDB.', sources: sourcesFor(t) },
    runtimeRequiredColumns: { confidence: confidence.inferred, values: unique([...(t.runtimeWriteColumns ?? []), ...(t.runtimeSqlEvidence ?? []).flatMap((q) => q.writeColumns ?? [])]), basis: 'Application query and writer expectations; incomplete for read projections and does not establish physical type or constraints.', sources: (t.runtimeSqlEvidence ?? []).map((q) => `${q.source}:${q.line}`) },
    historicalColumnCandidates: candidateEvidence(t.historicalColumnCandidates ?? [], (t.historicalMigrations ?? []).map((p) => `schema/${p}`)),
    primaryKeyCandidates: candidateEvidence(t.historicalPrimaryKeyEvidence ?? [], (t.historicalMigrations ?? []).map((p) => `schema/${p}`)),
    uniqueCandidates: candidateEvidence(t.historicalUniqueEvidence ?? [], (t.historicalMigrations ?? []).map((p) => `schema/${p}`)),
    indexCandidates: candidateEvidence(t.historicalIndexEvidence ?? [], (t.historicalMigrations ?? []).map((p) => `schema/${p}`)),
    foreignKeyCandidates: candidateEvidence(t.historicalForeignKeyEvidence ?? [], (t.historicalMigrations ?? []).map((p) => `schema/${p}`)),
    nullabilityDefaultsReferentialActionsCharsetsCollationsTimestampSemantics: { confidence: confidence.unknown, reason: 'No complete, active, authoritative TiDB definition establishes these properties.' }
  },
  parallelPostgresDefinitions: (t.parallelPostgresDefinitionEvidence ?? []).map((x) => ({ source: x.source, status: 'NOT_INDEPENDENT_AND_NOT_TIDB_AUTHORITY' }))
}));
const allRuntime = active.flatMap((t) => t.runtimeSqlEvidence ?? []);
const joins = allRuntime.filter((q) => q.operation === 'join');
const writePairs = new Set(active.flatMap((t) => (t.runtimeWriteColumns ?? []).map((c) => `${t.name}.${c}`)));
const sourceEvidence = {
  formatVersion: 1,
  status: 'SOURCE_RECOVERY_COMPLETE_CANONICAL_SCHEMA_BLOCKED',
  repository: 'FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM',
  verifiedBaseline: { branch: 'codex/tidb-only-runtime', commit: baseline, isCurrentHead: true },
  target: { dialect: 'TiDB', database: manifest.targetDatabase, schoolId: manifest.singleSchoolId, productionTiDBVersion: 'UNKNOWN_NOT_CONNECTED' },
  counts: {
    originalApplicationTables: reconciliation.originalApplicationTableCount,
    activeRuntimeTablesAssessed: active.length,
    fullAuthoritativeActiveTiDBDefinitions: active.filter((x) => x.completeAuthoritativeTiDBDefinition).length,
    partiallyRecoveredActiveDefinitions: active.length,
    unresolvedTables: unresolvedTables.length,
    compatibilityAlternatives: alternatives.length,
    supportedHistoricalViews: supportedViews.length,
    unresolvedViews: unresolvedViews.length,
    canonicalViewDefinitions: 0,
    runtimeWriteColumnPairs: writePairs.size,
    confirmedPhysicalColumns: 0,
    confirmedPrimaryKeys: 0,
    confirmedUniqueConstraints: 0,
    confirmedIndexes: 0,
    confirmedForeignKeys: 0,
    runtimeModulesMapped: reconciliation.evidenceSummary.activeModulesMappedToEntities,
    runtimeModulesWithCompleteContracts: 0,
    runtimeJoinObservations: joins.length,
    historicalForeignKeyCandidates: manifest.evidenceCounts.historicalForeignKeyEvidenceItems,
    historicalIndexCandidates: manifest.evidenceCounts.historicalSecondaryIndexEvidenceItems
  },
  historyReview: {
    localBranchRefsExamined: 255,
    tagsExamined: 2,
    deletedSchemaFilesFound: 0,
    renamedSchemaFilesFound: 0,
    schemaOrmDefinitionsFound: false,
    localDatabaseDumpOrBackupFound: false,
    numberedSqlMigrationFiles: manifest.migrationFileCount,
    sources: [
      { path: 'schema/001_foundation.sql', commit: '7a26fd67a9d9e3150bf5252b5ede35fb14461d21', engine: 'SQLite-oriented (PRAGMA, TEXT/INTEGER)', status: 'historical starting point; not TiDB authority' },
      { path: 'schema/068_academic_score_records_foundation.sql', commit: '55d3f3a74d842e508b956e44edcd49454d121968', engine: 'MySQL-like SQL; no verified active TiDB version/session settings', status: 'historical candidate only' },
      { path: 'schema/082_parent_sms_auth.sql', commit: 'fafe61b217f7d0f344d107cd2743216e0a05e178', engine: 'MySQL/TiDB-oriented migration', status: 'pre-existing untracked checkout artifact; not canonical source by itself' },
      { path: 'schema/083_result_blocking_tidb_scope.sql', commit: 'e142db137ac3cfd1a60c6981774763df59612333', engine: 'TiDB-oriented migration syntax', status: 'historical candidate; target version and live state unverified' },
      { path: 'supabase/migrations/202610150001_osaah_daylight_schema.sql', commit: '800f0191785c853fe7099008073d231c742728e3', engine: 'PostgreSQL', status: 'derived baseline; explicitly not TiDB authority' },
      { path: 'supabase/reconciliation/202610180001_captured_12_table_structural_stage.sql', commit: 'captured PostgreSQL catalog snapshot', engine: 'PostgreSQL', status: '12-table snapshot; not active TiDB catalog' }
    ]
  },
  propertyConfidencePolicy: {
    AUTHORITATIVE: 'Complete traceable schema source applicable to the active TiDB application state; none recovered for application tables/views.',
    CORROBORATED: 'Multiple genuinely independent sources agree; derived PostgreSQL baselines are not treated as independent corroboration.',
    INFERRED: 'Historical candidate DDL or runtime query expectations; never promoted into executable DDL.',
    UNKNOWN: 'Insufficient source evidence.'
  },
  activeTables: activeEntities,
  unresolvedTableDispositions: unresolvedTables.map((x) => ({ name: x.name, disposition: x.disposition, evidence: x.evidence ?? [], reason: x.reason ?? null })),
  compatibilityAlternatives: alternatives.map((x) => ({ name: x.name, disposition: x.disposition, evidence: x.evidence ?? [] })),
  views: viewDispositions.map((x) => ({ name: x.name, disposition: x.disposition, confidence: x.confidence ?? null, evidence: x.evidence ?? [], historicalDefinitionStatus: x.historicalDefinitionStatus ?? null })),
  evidenceRule: 'This evidence file describes source observations and candidates. It contains no production DDL.'
};
const blockedSchema = {
  formatVersion: 1,
  status: 'BLOCKED_NO_COMPLETE_AUTHORITATIVE_APPLICATION_CONTRACT',
  dialect: 'tidb',
  targetDatabase: manifest.targetDatabase,
  singleSchoolId: manifest.singleSchoolId,
  baselineCommit: baseline,
  executable: false,
  tables: [],
  views: [],
  constraints: [],
  indexes: [],
  dependencyOrder: [],
  blockers: [
    'No complete authoritative active TiDB DDL source was recovered for any of the 66 active application tables.',
    'Production TiDB version and live catalog are unknown; no genuine connection was established.',
    'Historical SQLite, MySQL-like, TiDB-oriented and PostgreSQL definitions conflict or lack proof of active end-state.',
    'Column nullability, defaults, key/index state, referential actions, charset/collation, timestamp semantics, and transaction assumptions are not fully verified.'
  ],
  policy: 'Do not initialize or generate application DDL from inferred, historical, or PostgreSQL-derived definitions.'
};
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
await writeFile(resolve(docs, 'tidb-schema-source-evidence.json'), json(sourceEvidence));
await writeFile(resolve(docs, 'tidb-authoritative-schema.json'), json(blockedSchema));
const oldInventory = await readJson('tidb-schema-entity-inventory.json');
oldInventory.sourceRecovery = { baselineCommit: baseline, status: sourceEvidence.status, confidenceLevels: confidence, counts: sourceEvidence.counts, activeTables: activeEntities, recoveryGeneratedFrom: 'docs/tidb-schema-requirements-manifest.json' };
await writeFile(resolve(docs, 'tidb-schema-entity-inventory.json'), json(oldInventory));
const recoveryMd = `# TiDB schema source recovery\n\n**Status: complete local source review; canonical application schema remains blocked.**\n\n- Repository: \`FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM\`\n- Verified branch and baseline: \`codex/tidb-only-runtime\` at \`${baseline}\`.\n- Target: TiDB database \`${manifest.targetDatabase}\`, single school \`${manifest.singleSchoolId}\`. Production TiDB version and catalog remain unknown.\n- Original application tables assessed: ${reconciliation.originalApplicationTableCount}; active runtime tables: ${active.length}; fully authoritative active TiDB definitions: 0; partially recovered: ${active.length}; unresolved table dispositions: ${unresolvedTables.length}; compatibility alternatives: ${alternatives.length}.\n- Historical views: ${supportedViews.length} supported-workflow candidates and ${unresolvedViews.length} unresolved; canonical view definitions recovered: 0.\n- Runtime write-column expectations: ${writePairs.size}; confirmed physical columns: 0. Confirmed primary keys, unique constraints, indexes, and foreign keys: 0 each. Runtime modules mapped: ${reconciliation.evidenceSummary.activeModulesMappedToEntities}; complete contracts: 0.\n\n## Sources examined\n\nThe Phase 2B per-entity manifest and reconciliation ledger were reviewed alongside repository Git history, numbered schema files, PostgreSQL snapshots, runtime SQL observations, adapter configuration, and available deployment metadata. The current schema folder has ${manifest.migrationFileCount} numbered SQL migration files. Local Git-history review found no deleted or renamed schema SQL files; no Drizzle/ORM schema definitions or local database dump/backup were found.\n\n| Source | Provenance | Finding |\n|---|---|---|\n| \`schema/001_foundation.sql\` | \`7a26fd67a9d9e3150bf5252b5ede35fb14461d21\` | SQLite-oriented foundation (PRAGMA, TEXT/INTEGER), not TiDB authority. |\n| \`schema/068_academic_score_records_foundation.sql\` | \`55d3f3a74d842e508b956e44edcd49454d121968\` | MySQL-like historical DDL; version/session behavior and active catalog not established. |\n| \`schema/082_parent_sms_auth.sql\` | \`fafe61b217f7d0f344d107cd2743216e0a05e178\` | Pre-existing untracked checkout artifact; cannot establish complete live schema. |\n| \`schema/083_result_blocking_tidb_scope.sql\` | \`e142db137ac3cfd1a60c6981774763df59612333\` | TiDB-oriented migration candidate; target version and applied state not verified. |\n| \`supabase/migrations/202610150001_osaah_daylight_schema.sql\` | \`800f0191785c853fe7099008073d231c742728e3\` | PostgreSQL baseline derived from repository migration/runtime evidence; not independent TiDB authority. |\n| \`supabase/reconciliation/202610180001_captured_12_table_structural_stage.sql\` | PostgreSQL catalog capture | Limited to a captured 12-table PostgreSQL schema, not target TiDB. |\n\n## Property confidence\n\n- **AUTHORITATIVE:** object identity and runtime dependency only, as application-scope facts; no physical application DDL property qualifies.\n- **CORROBORATED:** none promoted. The PostgreSQL baseline is derived from repository sources and is not an independent TiDB source.\n- **INFERRED:** runtime read/write expectations and historical column/key/index/foreign-key candidates. These are not executable definitions.\n- **UNKNOWN:** complete current types, nullability, defaults, generated/auto-increment behavior, enforced constraints, referential actions, charset/collation, timestamp semantics, target TiDB version, transaction/locking behavior, and live physical state.\n\nThe full per-table evidence, paths, lines, candidates, and confidence grades are in [machine-readable source evidence](tidb-schema-source-evidence.json). The proposed canonical contract is intentionally empty and non-executable in [authoritative schema JSON](tidb-authoritative-schema.json).\n\n## TiDB compatibility findings\n\nMySQL protocol compatibility does not establish version-specific equivalence. TiDB documents unsupported MySQL features and differences in defaults and behavior ([MySQL compatibility](https://docs.pingcap.com/tidb/stable/mysql-compatibility/)). TiDB foreign keys require appropriate indexed columns and matching definitions; inline \`REFERENCES\` clauses are parsed but ignored, so only supported table-level constraints establish enforcement ([foreign keys](https://docs.pingcap.com/tidb/stable/foreign-key/)). Session time zone affects \`TIMESTAMP\` behavior ([time zone configuration](https://docs.pingcap.com/tidb/stable/configure-time-zone/)); auto-increment and generated-column behavior also need target-version validation ([AUTO_INCREMENT](https://docs.pingcap.com/tidb/dev/auto-increment/), [generated columns](https://docs.pingcap.com/tidb/v7.1/generated-columns/)). No production compatibility claim is made because no live target connection or version check occurred.\n\n## Connection investigation\n\nThe TiDB adapter requires explicit \`OSAAH_DATABASE_ADAPTER=tidb\` and accepts a MySQL-family \`DATABASE_URL\` or component configuration; malformed or non-MySQL schemes fail with \`DATABASE_URL_INVALID\` before pool creation. The previously inspected local environment was not a trustworthy production source. Vercel environment listing could not complete because the CLI failed while fetching its npm update metadata; no credential values were displayed. No live connection was made. The environment owner must supply the correct Vercel-scoped TiDB configuration securely, then authorize a read-only version and catalog inspection.\n`;
await writeFile(resolve(docs, 'tidb-schema-source-recovery.md'), recoveryMd);
const authoritativeMd = `# Authoritative TiDB application schema\n\n**Status: BLOCKED — no complete authoritative application schema was recovered.**\n\nTarget: \`${manifest.targetDatabase}\` / TiDB / school \`${manifest.singleSchoolId}\`. Verified source-review baseline: \`${baseline}\`.\n\nThere are ${active.length} active runtime application tables. None has a complete, traceable definition applicable to the active TiDB state. The repository contains runtime query expectations and historical DDL candidates, but these do not jointly prove current types, nullability, defaults, key/index enforcement, referential actions, generated behavior, charset/collation, or timestamp semantics. The PostgreSQL baseline is not TiDB authority.\n\nNo executable initialization plan is published: table, view, key, index, and dependency arrays are empty in [authoritative schema JSON](tidb-authoritative-schema.json). This preserves fail-closed initialization. See [source recovery](tidb-schema-source-recovery.md) and [blockers](tidb-schema-recovery-blockers.md).\n`;
await writeFile(resolve(docs, 'tidb-authoritative-schema.md'), authoritativeMd);
const relLines = [
  '# TiDB schema relationship map', '',
  '> **Evidence only.** Application joins and historical foreign-key candidates do not prove database-enforced relationships.', '',
  `- Runtime JOIN observations: ${joins.length}.`,
  `- Historical foreign-key candidates: ${manifest.evidenceCounts.historicalForeignKeyEvidenceItems}.`,
  '- Confirmed canonical foreign keys: 0.',
  '- Confirmed canonical indexes: 0.',
  '',
  '## Runtime JOIN evidence', '',
  'Each row links to the application source location. The Phase 2B scanner records a truncated SQL prefix/projection, so the exact full condition remains to be reviewed from source. No JOIN is auto-promoted to a foreign key.', ''
];
for (const t of active) for (const q of (t.runtimeSqlEvidence ?? []).filter((x) => x.operation === 'join')) relLines.push(`- \`${t.name}\` — [${q.source}:${q.line}](${q.source}#L${q.line}); query prefix: \`${String(q.statementPrefix ?? '').replaceAll('`', "'")}\`.`);
relLines.push('', '## Historical FK candidates', '');
for (const t of active) for (const candidate of t.historicalForeignKeyEvidence ?? []) relLines.push(`- \`${t.name}\`: ${candidate} (migration candidates: ${(t.historicalMigrations ?? []).join(', ') || 'not resolved'}).`);
relLines.push('', '## Promotion requirements', '', 'Confirm both column contracts, compatible type/length/precision/charset/collation, ordered supporting indexes, lifecycle and delete/update action, data integrity, transaction boundaries, and TiDB target-version support before proposing any enforced relationship.');
await writeFile(resolve(docs, 'tidb-schema-relationship-map.md'), `${relLines.join('\n')}\n`);
const coverage = `# TiDB application-to-schema coverage\n\n**Status: INCOMPLETE — source mapping is not physical catalog coverage.**\n\n- Original application tables: ${reconciliation.originalApplicationTableCount}.\n- Active runtime tables assessed: ${active.length}; authoritative complete contracts: 0; partial evidence: ${active.length}.\n- Unresolved tables: ${unresolvedTables.length}; compatibility alternatives: ${alternatives.length}.\n- Historical view candidates: ${supportedViews.length} supported-workflow, ${unresolvedViews.length} unresolved; canonical definitions: 0.\n- Runtime modules mapped to entities: ${reconciliation.evidenceSummary.activeModulesMappedToEntities}; modules with complete schema contracts: 0.\n- Runtime write-column expectations: ${writePairs.size}; confirmed physical columns: 0.\n- Confirmed primary keys, unique constraints, indexes, and foreign keys: 0 each. Historical key/index candidates remain candidates only.\n\n## Active module and entity evidence\n\nThe per-table and per-module evidence is in [the entity inventory](tidb-schema-entity-inventory.json) and [source evidence](tidb-schema-source-evidence.json). Query observations establish application expectations only. Dynamic SQL, projection completeness, transaction semantics, and complete read contracts remain to be reconciled before a module can be certified.\n\n## Completion gate\n\nObtain authoritative target schema provenance or a securely provided read-only TiDB catalog export, then reconcile every active object and query, validate the target TiDB version and runtime semantics, and independently review the resulting canonical contract. Until then, application initialization remains fail-closed.\n`;
await writeFile(resolve(docs, 'tidb-application-schema-coverage.md'), coverage);
const blockers = `# TiDB schema recovery blockers\n\nPhase 2C source review completed against baseline \`${baseline}\`. Production DDL recovery remains blocked.\n\n1. **Authoritative source:** no complete active TiDB DDL was found for any of 66 active application tables; PostgreSQL and historical mixed-dialect migrations are not substitutes. **Next:** repository/database owner supplies the approved schema release artifact, migration history, or a secure catalog export with provenance.\n2. **Production target identity:** actual TiDB version, SQL mode, session time zone, charset/collation, and FK enforcement settings are unknown. **Next:** environment owner supplies verified target metadata and a read-only connection path.\n3. **Credential/config selection:** adapter rejects invalid/non-MySQL URL schemes as \`DATABASE_URL_INVALID\` before pool creation. Vercel environment listing was blocked by CLI update-metadata fetch failure. **Next:** owner confirms correct Vercel environment variable names/scope and configures TiDB credentials securely; do not send secrets in chat or commit them.\n4. **Current state and migrations:** no applied-migration evidence or live catalog could be inspected. **Next:** perform read-only catalog and migration-state inspection only after connection is verified; do not mutate production.\n5. **Per-entity contracts:** active query expectations coexist with historical type/key conflicts, and 92 tables plus 3 views remain unresolved. **Next:** domain owners resolve object lifecycle and field-level contract gaps with linked evidence; preserve classifications until supported.\n6. **Relationships and transactions:** joins are query evidence, 400 FK entries are historical candidates, and exact join predicates/transaction retry/idempotency lifecycle are not approved as constraints. **Next:** inspect full source queries and workflow boundaries; validate candidate indexes/constraints against data and TiDB version.\n7. **Compatibility:** AUTO_INCREMENT, generated columns, JSON, timestamp, collation, index limits, and transaction semantics are version/session-sensitive. **Next:** validate candidate DDL and behavior against an isolated instance matching the verified production TiDB version.\n\nDo not publish application DDL, initialize, integrate auth against an assumed schema, change production data, merge, or deploy until blockers are resolved and the canonical contract passes independent review.\n`;
await writeFile(resolve(docs, 'tidb-schema-recovery-blockers.md'), blockers);

const { buildTiDBSchemaEvidenceArtifacts } = await import('./publish-tidb-schema-evidence.mjs');
for (const [relativePath, contents] of buildTiDBSchemaEvidenceArtifacts(manifest)) await writeFile(resolve(root, relativePath), contents, 'utf8');
