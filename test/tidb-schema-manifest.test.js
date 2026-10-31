import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateCanonicalTiDBSchemaManifest, validateTiDBSchemaEvidenceManifest } from '../src/platform/tidb-schema-manifest.js';

function validManifest() {
  const table = { engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', indexes: [], uniqueConstraints: [], foreignKeys: [] };
  return {
    status: 'CANONICAL', dialect: 'tidb', database: 'osaahdaylightschool', schoolId: 'sch_default_01', views: [],
    tables: [
      { ...table, name: 'schools', columns: [{ name: 'id', type: 'VARCHAR(64)', nullable: false, default: null }], primaryKey: ['id'] },
      { ...table, name: 'users', columns: [
        { name: 'id', type: 'VARCHAR(64)', nullable: false, default: null },
        { name: 'school_id', type: 'VARCHAR(64)', nullable: false, default: null },
        { name: 'status', type: 'VARCHAR(16)', nullable: false, default: 'ACTIVE' }
      ], primaryKey: ['id'], indexes: [{ name: 'idx_users_school', columns: ['school_id'], unique: false }], uniqueConstraints: [], foreignKeys: [
        { name: 'fk_users_school', columns: ['school_id'], referencedTable: 'schools', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }
      ] }
    ]
  };
}

test('canonical TiDB manifest validates complete table, key, index, relationship, and required-default contracts', () => {
  const result = validateCanonicalTiDBSchemaManifest(validManifest(), {
    runtimeRequirements: { users: ['id', 'school_id', 'status'] },
    requiredDefaults: { users: { status: 'ACTIVE' } }
  });
  assert.deepEqual(result, { valid: true, issues: [], tableCount: 2 });
});

test('canonical TiDB schema requires complete table encoding, explicit defaults, and referential actions', () => {
  const manifest = validManifest();
  delete manifest.tables[1].engine;
  delete manifest.tables[1].charset;
  delete manifest.tables[1].collation;
  delete manifest.tables[1].columns[2].default;
  delete manifest.tables[1].foreignKeys[0].onDelete;
  const result = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(result.issues.includes('TABLE_ENGINE_REQUIRED:users'));
  assert.ok(result.issues.includes('TABLE_CHARSET_COLLATION_REQUIRED:users'));
  assert.ok(result.issues.includes('COLUMN_DEFAULT_CONTRACT_REQUIRED:users.status'));
  assert.ok(result.issues.includes('FOREIGN_KEY_ON_DELETE_REQUIRED:users.fk_users_school'));
});
test('canonical schema validator reports duplicate table and column names', () => {
  const manifest = validManifest();
  manifest.tables.push({ ...manifest.tables[0], columns: [...manifest.tables[0].columns, { ...manifest.tables[0].columns[0] }] });
  const result = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(result.issues.includes('DUPLICATE_TABLE:schools'));
  assert.ok(result.issues.includes('DUPLICATE_COLUMN:schools.id'));
});

test('canonical schema validator detects missing runtime tables and columns', () => {
  const result = validateCanonicalTiDBSchemaManifest(validManifest(), { runtimeRequirements: { auth_sessions: ['id', 'user_id'] } });
  assert.ok(result.issues.includes('RUNTIME_TABLE_MISSING:auth_sessions'));
  const missingColumn = validateCanonicalTiDBSchemaManifest(validManifest(), { runtimeRequirements: { users: ['password_hash'] } });
  assert.ok(missingColumn.issues.includes('RUNTIME_COLUMN_MISSING:users.password_hash'));
});

test('canonical schema validator rejects invalid foreign keys and indexes', () => {
  const manifest = validManifest();
  manifest.tables[1].indexes.push({ name: 'idx_missing', columns: ['not_a_column'] });
  manifest.tables[1].foreignKeys.push({ name: 'fk_bad', columns: ['missing'], referencedTable: 'ghosts', referencedColumns: ['id'] });
  const result = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(result.issues.includes('INDEX_COLUMN_MISSING:users.not_a_column'));
  assert.ok(result.issues.includes('FOREIGN_KEY_TABLE_MISSING:users.ghosts'));
});

test('canonical schema validator catches unsupported types, missing primary keys, and missing defaults', () => {
  const manifest = validManifest();
  manifest.tables[1].columns[2].type = 'SERIAL';
  manifest.tables[1].primaryKey = [];
  delete manifest.tables[1].columns[2].default;
  const result = validateCanonicalTiDBSchemaManifest(manifest, { requiredDefaults: { users: { status: 'ACTIVE' } } });
  assert.ok(result.issues.includes('UNSUPPORTED_TIDB_TYPE:users.status'));
  assert.ok(result.issues.includes('PRIMARY_KEY_REQUIRED:users'));
  assert.ok(result.issues.includes('REQUIRED_DEFAULT_MISSING:users.status'));
});

test('canonical schema validator reports inconsistent relationships and nullable delete actions', () => {
  const manifest = validManifest();
  manifest.tables[1].foreignKeys = [{ name: 'fk_bad', columns: ['school_id'], referencedTable: 'schools', referencedColumns: ['id'], onDelete: 'SET NULL' }];
  const result = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(result.issues.includes('FOREIGN_KEY_SET_NULL_NON_NULLABLE:users.fk_bad'));
  manifest.tables[1].columns[1].type = 'BIGINT';
  assert.ok(validateCanonicalTiDBSchemaManifest(manifest).issues.includes('FOREIGN_KEY_TYPE_MISMATCH:users.school_id'));
});

test('canonical schema validator requires an indexed referenced key and matching character metadata', () => {
  const manifest = validManifest();
  manifest.tables[0].primaryKey = [];
  manifest.tables[0].indexes = [];
  manifest.tables[1].columns[1].charset = 'utf8mb4';
  manifest.tables[0].columns[0].charset = 'latin1';
  const result = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(result.issues.includes('FOREIGN_KEY_REMOTE_INDEX_MISSING:users.fk_users_school'));
  assert.ok(result.issues.includes('FOREIGN_KEY_CHARSET_MISMATCH:users.school_id'));
});

test('canonical schema validator rejects character types without required lengths', () => {
  const manifest = validManifest();
  manifest.tables[1].columns[0].type = 'VARCHAR';
  assert.ok(validateCanonicalTiDBSchemaManifest(manifest).issues.includes('UNSUPPORTED_TIDB_TYPE:users.id'));
});

test('generated repository evidence manifest stays explicitly unresolved and is not accepted as canonical', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/tidb-schema-requirements-manifest.json', import.meta.url), 'utf8'));
  const evidence = validateTiDBSchemaEvidenceManifest(manifest);
  assert.equal(evidence.valid, true);
  assert.equal(evidence.canonical, false);
  assert.equal(manifest.status, 'EVIDENCE_ONLY_NOT_CANONICAL');
  const reconciliation = manifest.runtimeContractReconciliation;
  assert.equal(reconciliation.tableDispositions.length, 164);
  assert.equal(new Set(reconciliation.tableDispositions.map((item) => item.name)).size, 164);
  assert.equal(reconciliation.viewDispositions.length, 8);
  assert.equal(new Set(reconciliation.viewDispositions.map((item) => item.name)).size, 8);
  assert.ok(reconciliation.viewDispositions.every((view) => view.definitionHistory.length > 0));
  assert.ok(reconciliation.viewDispositions.some((view) => view.definitionAssessment.startsWith('CONFLICTING_')));
  assert.equal(reconciliation.targetTiDBAssessment.targetVersion, 'UNKNOWN_NOT_FOUND_IN_REPOSITORY_DEPLOYMENT_CONFIGURATION');
  assert.equal(reconciliation.completionStatus, 'INCOMPLETE_REQUIRED_CONTRACTS_AND_OBJECT_DISPOSITIONS_REMAIN_UNRESOLVED');
  assert.equal(reconciliation.domainCompletionMatrix.length, 9);
  assert.ok(reconciliation.domainCompletionMatrix.every((domain) => domain.status === 'PARTIAL' && domain.blockers.length > 0));
  assert.ok(reconciliation.tableDispositions.every((item) => item.missingEvidence?.length && item.whyRepositoryEvidenceIsInsufficient && item.requiredExternalDecision && Array.isArray(item.affectedWorkflowEvidence)));
  assert.ok(reconciliation.viewDispositions.every((item) => item.missingEvidence?.length && item.whyRepositoryEvidenceIsInsufficient && item.requiredExternalDecision && Array.isArray(item.affectedWorkflowEvidence)));
  assert.deepEqual(
    reconciliation.viewDispositions.reduce((counts, item) => ({ ...counts, [item.disposition]: (counts[item.disposition] ?? 0) + 1 }), {}),
    { REQUIRED_SUPPORTED_WORKFLOW: 5, UNRESOLVED: 3 }
  );
  assert.equal(reconciliation.contracts.find((item) => item.object === 'user_roles').status, 'ID_COLUMN_AND_PAIR_SEMANTICS_RESOLVED_PRIMARY_KEY_UNRESOLVED');
  assert.match(reconciliation.contracts.find((item) => item.object === 'users').runtime.passwordHash, /scrypt.*bcrypt/i);
  assert.match(reconciliation.targetTiDBAssessment.connectionContract.tls, /rejectUnauthorized=true/);
  assert.equal(manifest.domainDocumentation.fullyResolvedDomains.length, 0);
  assert.equal(manifest.domainDocumentation.unresolvedRequiredTableContracts, 71);
  assert.equal(manifest.domainDocumentation.unresolvedRequiredViewContracts, 5);
  const domainMatrix = await readFile(new URL('../docs/tidb-domain-contracts/completion-matrix.md', import.meta.url), 'utf8');
  assert.match(domainMatrix, /Fully resolved required tables: \*\*0 of 71\*\*/);
  assert.ok(manifest.unresolvedSummary.runtimeSqlConfirmedTables > 0);
  assert.equal(manifest.unresolvedSummary.runtimeTablesWithoutAnySchemaDefinitionEvidence, 1);
  assert.equal(manifest.unresolvedSummary.runtimeWriteColumnPairsWithoutAnySchemaDefinitionEvidence, 1);
  assert.ok(manifest.tables.find((table) => table.name === 'class_subjects').runtimeRequiredness.startsWith('OPTIONAL_LEGACY_'));
  assert.deepEqual(
    manifest.tables.find((table) => table.name === 'staff_profiles').runtimeWriteColumnsWithoutSchemaEvidence,
    ['staff_number']
  );
  const staffProfileGaps = reconciliation.tableDispositions.find((item) => item.name === 'staff_profiles').missingEvidence.join(' ');
  assert.match(staffProfileGaps, /caller-supplied staff_number/i);
  assert.match(staffProfileGaps, /school scope/i);
  assert.match(staffProfileGaps, /historical HR DDL/i);
  assert.equal(manifest.evidenceCounts.allCountsAreEvidenceOnly, true);
  assert.ok(manifest.evidenceCounts.historicalColumnCandidatePairs > 0);
  assert.equal(manifest.unresolvedSummary.allObjectsRemainUnresolvedForCanonicalDdl, true);
  const canonical = validateCanonicalTiDBSchemaManifest(manifest);
  assert.ok(canonical.issues.includes('MANIFEST_NOT_CANONICAL_TIDB'));
});
