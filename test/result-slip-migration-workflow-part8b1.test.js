import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInMemoryMigrationAdapter, createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertExpectedDatabase, RESULT_SLIP_CONFIRMATION, validateReleaseInputs, verifyResultSlipSchema } from '../src/platform/result-slip-migration-preflight.js';
import { applyResultSlipMigrations } from '../scripts/apply-result-slip-migrations.mjs';

async function runnerFixture({ appliedVersions = [54], badChecksum = null, migrationLock = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'osaah-result-slip-migrations-'));
  const filenames = [
    ['054_durable_score_entry_academic_contract.sql', 'SELECT 54;'],
    ['055_canonical_academic_scores.sql', 'CREATE TABLE score_store (id INT);'],
    ['056_canonical_ges_assessments.sql', 'CREATE TABLE ges_store (id INT);'],
    ['057_future_migration.sql', 'DROP TABLE should_never_run;']
  ];
  for (const [name, sql] of filenames) await writeFile(join(directory, name), sql);
  const migrations = await discoverMigrations(directory);
  const baseline = { id: 'baseline', canonicalDatabase: 'osaahdaylightschool', reconciliationMigration: '054_durable_score_entry_academic_contract.sql' };
  const storage = { baselines: [baseline], applied: migrations.filter(item => appliedVersions.includes(item.version)).map(item => ({ version: item.version, name: item.name, checksum: item.version === badChecksum ? 'wrong' : item.checksum, appliedAt: '2026-09-27T00:00:00Z' })) };
  const baseAdapter = createInMemoryMigrationAdapter(storage);
  const adapter = migrationLock ? { ...baseAdapter, async acquireLock() { return false; } } : baseAdapter;
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true, clock: () => '2026-09-27T00:00:00Z' });
  return { directory, adapter, runner, storage, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('manual inputs require exact confirmation, release_ref, and protected database URL', () => {
  const validSha = 'a'.repeat(40);
  assert.throws(() => validateReleaseInputs({ confirmation: 'yes', releaseRef: 'main', databaseUrl: 'opaque-secret' }), { code: 'CONFIRMATION_MISMATCH' });
  assert.throws(() => validateReleaseInputs({ confirmation: RESULT_SLIP_CONFIRMATION, releaseRef: '', databaseUrl: 'opaque-secret' }), { code: 'RELEASE_REF_REQUIRED' });
  assert.throws(() => validateReleaseInputs({ confirmation: RESULT_SLIP_CONFIRMATION, releaseRef: validSha, databaseUrl: '' }), { code: 'DATABASE_URL_MISSING' });
  for (const releaseRef of ['main', 'fix/result-slip-options-part1', 'refs/heads/main', '1234567', 'A'.repeat(40), 'g'.repeat(40), 'a'.repeat(39), 'a'.repeat(41)]) {
    assert.throws(() => validateReleaseInputs({ confirmation: RESULT_SLIP_CONFIRMATION, releaseRef, databaseUrl: 'opaque-secret' }), { code: 'RELEASE_REF_INVALID' }, releaseRef);
  }
  assert.doesNotThrow(() => validateReleaseInputs({ confirmation: RESULT_SLIP_CONFIRMATION, releaseRef: validSha, databaseUrl: 'opaque-secret' }));
  assert.throws(() => assertExpectedDatabase('wrong-db'), { code: 'DATABASE_TARGET_MISMATCH' });
  assert.doesNotThrow(() => assertExpectedDatabase('osaahdaylightschool'));
});

test('workflow requires a lowercase 40-character SHA before checkout and compares the resolved SHA', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../.github/workflows/apply-result-slip-migrations.yml', import.meta.url), 'utf8');
  const validation = workflow.indexOf('[[ "$RELEASE_REF" =~ ^[0-9a-f]{40}$ ]]');
  const checkout = workflow.indexOf('- name: Check out the exact release ref');
  const resolved = workflow.indexOf('SHA="$(git rev-parse --verify HEAD^{commit})"');
  const equality = workflow.indexOf('if [ "$SHA" != "$RELEASE_REF" ]; then');
  const report = workflow.indexOf("printf 'Requested release_ref:");
  assert.ok(validation >= 0 && validation < checkout);
  assert.ok(resolved >= checkout && equality > resolved && report > equality);
});

test('bounded runner applies pending 055 then 056 and never applies future versions', async () => {
  const fixture = await runnerFixture();
  try {
    const result = await fixture.runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] });
    assert.deepEqual(result.applied.map(item => item.version), [55, 56]);
    assert.deepEqual(fixture.storage.statements, ['CREATE TABLE score_store (id INT);', 'CREATE TABLE ges_store (id INT);']);
    assert.equal(fixture.storage.applied.some(item => item.version === 57), false);
  } finally { await fixture.cleanup(); }
});

test('bounded runner safely handles 055 already applied and 056 pending', async () => {
  const fixture = await runnerFixture({ appliedVersions: [54, 55] });
  try {
    const result = await fixture.runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] });
    assert.deepEqual(result.applied.map(item => item.version), [56]);
    assert.deepEqual(fixture.storage.statements, ['CREATE TABLE ges_store (id INT);']);
  } finally { await fixture.cleanup(); }
});

test('bounded runner verifies both already-applied migrations without rerunning DDL', async () => {
  const fixture = await runnerFixture({ appliedVersions: [54, 55, 56] });
  try {
    const result = await fixture.runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] });
    assert.deepEqual(result.applied, []);
    assert.deepEqual(fixture.storage.statements, []);
  } finally { await fixture.cleanup(); }
});

test('checksum mismatch, missing predecessor, and an out-of-order ledger fail before DDL', async () => {
  for (const options of [{ appliedVersions: [54], badChecksum: 54 }, { appliedVersions: [] }, { appliedVersions: [54, 56] }]) {
    const fixture = await runnerFixture(options);
    try {
      await assert.rejects(fixture.runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] }));
      assert.deepEqual(fixture.storage.statements, []);
    } finally { await fixture.cleanup(); }
  }
});

test('bounded runner refuses to proceed when migration lock cannot be acquired', async () => {
  const fixture = await runnerFixture({ migrationLock: true });
  try {
    await assert.rejects(fixture.runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] }), { code: 'MIGRATION_LOCKED' });
    assert.deepEqual(fixture.storage.statements, []);
  } finally { await fixture.cleanup(); }
});

function schemaDatabase({ missingTable = null, missingColumn = null, missingUnique = null, missingForeignKey = null } = {}) {
  const definitions = {
    canonical_academic_scores: {
      columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','subject_id','class_score','exam_score','total_score','created_at','updated_at'],
      unique: ['school_id','student_id','class_id','academic_year_id','term_id','subject_id'],
      fks: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id'],['subject_id','subjects','id']]
    },
    canonical_ges_assessments: {
      columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','conduct','attitude','interest','class_teacher_remarks','headteacher_remarks','created_at','updated_at'],
      unique: ['school_id','student_id','class_id','academic_year_id','term_id'],
      fks: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id']]
    }
  };
  return { async query(sql, params = []) {
    if (sql.includes('information_schema.TABLES')) return Object.keys(definitions).filter(name => name !== missingTable).map(tableName => ({ tableName, tableType: 'BASE TABLE' }));
    const table = params[0]; const def = definitions[table];
    if (sql.includes('information_schema.COLUMNS')) return def.columns.filter(name => !(table === missingColumn?.table && name === missingColumn.column)).map(columnName => ({ columnName }));
    if (sql.includes('information_schema.STATISTICS')) return def.unique.filter(() => !(table === missingUnique)).map((columnName, index) => ({ indexName: 'unique_scope', nonUnique: 0, columnName, sequence: index + 1 }));
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return def.fks.filter(([column]) => !(table === missingForeignKey?.table && column === missingForeignKey.column)).map(([columnName, referencedTable, referencedColumn]) => ({ columnName, referencedTable, referencedColumn }));
    throw Error('Unexpected test query');
  } };
}

test('schema postconditions accept canonical definitions and reject missing table, column, unique index, or identity FK', async () => {
  const result = await verifyResultSlipSchema(schemaDatabase());
  assert.deepEqual(result.verifiedTables, ['canonical_academic_scores','canonical_ges_assessments']);
  assert.equal(result.studentIdentity, 'students.id');
  await assert.rejects(verifyResultSlipSchema(schemaDatabase({ missingTable: 'canonical_ges_assessments' })), { code: 'RESULT_SLIP_TABLE_MISSING' });
  await assert.rejects(verifyResultSlipSchema(schemaDatabase({ missingColumn: { table: 'canonical_academic_scores', column: 'class_score' } })), { code: 'RESULT_SLIP_COLUMNS_MISSING' });
  await assert.rejects(verifyResultSlipSchema(schemaDatabase({ missingUnique: 'canonical_ges_assessments' })), { code: 'RESULT_SLIP_UNIQUE_SCOPE_MISSING' });
  await assert.rejects(verifyResultSlipSchema(schemaDatabase({ missingForeignKey: { table: 'canonical_academic_scores', column: 'student_id' } })), { code: 'RESULT_SLIP_FOREIGN_KEYS_MISSING' });
});

test('migration entrypoint checks the database before runner access and never prints DATABASE_URL', async () => {
  const sentinel = 'mysql://private:must-not-print@example.invalid/db';
  let runnerCalled = false;
  const adapter = { async query() { return [[{ databaseName: 'wrong-db' }]]; }, async close() {} };
  const releaseSha = 'a'.repeat(40);
  await assert.rejects(applyResultSlipMigrations({ environment: { CONFIRMATION: RESULT_SLIP_CONFIRMATION, RELEASE_REF: releaseSha, DATABASE_URL: sentinel }, adapterFactory: async () => adapter, runnerFactory: () => { runnerCalled = true; throw Error('must not be called'); }, output: { write() {} } }), { code: 'DATABASE_TARGET_MISMATCH' });
  assert.equal(runnerCalled, false);
  let adapterCalled = false;
  await assert.rejects(applyResultSlipMigrations({ environment: { CONFIRMATION: RESULT_SLIP_CONFIRMATION, RELEASE_REF: releaseSha, DATABASE_URL: '' }, adapterFactory: async () => { adapterCalled = true; }, output: { write() {} } }), { code: 'DATABASE_URL_MISSING' });
  assert.equal(adapterCalled, false);
  assert.equal(JSON.stringify({ confirmation: RESULT_SLIP_CONFIRMATION, releaseRef: releaseSha }).includes(sentinel), false);

  const schema = schemaDatabase();
  const applied = [
    { version: 54, name: '054_durable_score_entry_academic_contract.sql', checksum: 'safe54' },
    { version: 55, name: '055_canonical_academic_scores.sql', checksum: 'safe55' },
    { version: 56, name: '056_canonical_ges_assessments.sql', checksum: 'safe56' }
  ];
  const validAdapter = { async query(sql, params) {
    if (sql.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
    if (sql.includes('schema_migration_lock')) return [{ lockId: 1, locked: 0 }];
    return schema.query(sql, params);
  }, async close() {} };
  let currentApplied = [applied[0]];
  const validRunner = {
    async status() { return { baseline: { canonicalDatabase: 'osaahdaylightschool' }, applied: currentApplied, pending: currentApplied.length === 1 ? applied.slice(1) : [] }; },
    async applyVersions({ versions, requiredAppliedVersions }) { assert.deepEqual(versions, [55,56]); assert.deepEqual(requiredAppliedVersions, [54]); currentApplied = applied; return { applied: applied.slice(1) }; },
    async validate() { return { valid: true, migrationCount: 55, appliedCount: 56, pendingCount: 0 }; }
  };
  let outputText = '';
  const result = await applyResultSlipMigrations({ environment: { CONFIRMATION: RESULT_SLIP_CONFIRMATION, RELEASE_REF: releaseSha, DATABASE_URL: sentinel }, adapterFactory: async () => validAdapter, runnerFactory: () => validRunner, output: { write(value) { outputText += value; } } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.newlyApplied, [55,56]);
  assert.equal(outputText.includes(sentinel), false);
  assert.equal(outputText.includes(releaseSha), true);
});

test('workflow is manual-only, confirmation-gated, protected, bounded, and does not deploy', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../.github/workflows/apply-result-slip-migrations.yml', import.meta.url), 'utf8');
  const scores = await readFile(new URL('../schema/055_canonical_academic_scores.sql', import.meta.url), 'utf8');
  const ges = await readFile(new URL('../schema/056_canonical_ges_assessments.sql', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /CONFIRMATION.*APPLY_RESULT_SLIP_055_056/s);
  assert.match(workflow, /node scripts\/apply-result-slip-migrations\.mjs/);
  assert.doesNotMatch(workflow, /vercel|deploy/i);
  assert.match(scores, /CREATE TABLE IF NOT EXISTS canonical_academic_scores/);
  assert.match(scores, /student_id[^,]*,?[\s\S]*FOREIGN KEY \(student_id\) REFERENCES students\(id\)/);
  assert.match(ges, /CREATE TABLE IF NOT EXISTS canonical_ges_assessments/);
  for (const sql of [scores, ges]) assert.doesNotMatch(sql, /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE)\b/i);
});
