import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { discoverMigrations } from '../src/platform/migration-runner.js';
import { PRODUCTION_REPOSITORY, runProductionTiDBMigrationAudit, validateReleaseIdentity } from '../scripts/production-tidb-migration-audit.mjs';

const releaseSha = '32b94e93e3657c8a896c30555d8e8ae8cb9dbbfa';

async function migrationFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'osaah-production-migration-audit-'));
  await writeFile(join(directory, '001_historical.sql'), 'SELECT 1;\n');
  await writeFile(join(directory, '049_current.sql'), 'SELECT 49;\n');
  await writeFile(join(directory, '082_parent_sms_auth.sql'), 'SELECT 82;\n');
  await writeFile(join(directory, '083_after.sql'), 'SELECT 83;\n');
  return directory;
}

function makeAdapter({ applied = [], baselines = [], runs = [], metadataTables, parentTables = [], lockRows = [{ lockId: 1, locked: 0, acquiredAt: null }], schoolRows = [{ id: 'sch_default_01' }], identity, failAt } = {}) {
  const queries = [];
  const allMetadata = ['schema_migrations', 'schema_migration_lock', 'schema_migration_runs', 'schema_baselines'];
  const adapter = {
    dialect: 'tidb',
    async verifyReadiness() {
      if (failAt === 'identity') throw new Error('mysql://sensitive:do-not-print@example.invalid/db');
      return identity ?? { ready: true, engine: 'TiDB', database: 'osaahdaylightschool' };
    },
    async query(sql, parameters = []) {
      assert.match(sql, /^\s*SELECT\b/i, `non-read query attempted: ${sql}`);
      queries.push({ sql, parameters });
      if (failAt === sql) throw new Error('secret:do-not-print');
      if (sql.includes('FROM schools')) return schoolRows;
      if (sql.includes('information_schema.TABLES')) {
        const names = parameters.length === 4 ? (metadataTables ?? allMetadata) : parentTables;
        return names.map((tableName) => ({ tableName }));
      }
      if (sql.includes('FROM schema_migrations')) return applied;
      if (sql.includes('FROM schema_baselines')) return baselines;
      if (sql.includes('FROM schema_migration_runs')) return runs;
      if (sql.includes('FROM schema_migration_lock')) return lockRows;
      throw new Error(`unexpected query: ${sql}`);
    },
    async execute() { throw new Error('mutating adapter method must never be called'); },
    async transaction() { throw new Error('transaction method must never be called'); },
    async ensureMetadata() { throw new Error('metadata creation/check helper must never be called'); },
    async close() {}
  };
  return { adapter, queries };
}

async function runAudit(directory, adapter, overrides = {}) {
  return runProductionTiDBMigrationAudit({
    adapter,
    directory,
    releaseRef: releaseSha,
    checkedOutCommit: releaseSha,
    repository: PRODUCTION_REPOSITORY,
    ...overrides
  });
}

test('protected read-only production TiDB migration audit', async (t) => {
  const directory = await migrationFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const migrations = await discoverMigrations(directory);
  const baselineMigration = migrations.find(({ version }) => version === 49);
  const applied49 = { version: 49, name: baselineMigration.name, checksum: baselineMigration.checksum, appliedAt: '2026-11-01T00:00:00Z' };
  const baseline = {
    canonicalDatabase: 'osaahdaylightschool', baselineAt: '2026-11-01T00:00:00Z', repositoryCommit: releaseSha,
    schemaFingerprint: 'f'.repeat(64), reconciliationMigration: baselineMigration.name,
    baselineType: 'HISTORICAL_BASELINE', historicalMigrationsExecuted: false
  };

  await t.test('accepts only a full checked-out SHA from the intended repository', () => {
    assert.equal(validateReleaseIdentity({ releaseRef: releaseSha, checkedOutCommit: releaseSha.toUpperCase(), repository: PRODUCTION_REPOSITORY }), releaseSha);
    for (const releaseRef of ['32b94e9', 'g'.repeat(40), '']) assert.throws(() => validateReleaseIdentity({ releaseRef, checkedOutCommit: releaseSha, repository: PRODUCTION_REPOSITORY }), { code: 'RELEASE_COMMIT_INVALID' });
    assert.throws(() => validateReleaseIdentity({ releaseRef: releaseSha, checkedOutCommit: releaseSha, repository: 'someone/other-repo' }), { code: 'REPOSITORY_MISMATCH' });
  });

  await t.test('verifies TiDB, canonical database and school before reading the ledger', async () => {
    const { adapter, queries } = makeAdapter({ applied: [applied49], baselines: [baseline] });
    const report = await runAudit(directory, adapter);
    assert.equal(report.database.engine, 'TiDB');
    assert.equal(report.database.name, 'osaahdaylightschool');
    assert.equal(report.database.canonicalSchoolId, 'sch_default_01');
    assert.equal(report.releaseCommit, releaseSha);
    assert.ok(queries.some(({ sql }) => sql.includes('FROM schools')));
  });

  await t.test('reports baseline, applied, pending, historical and migration 082 state', async () => {
    const { adapter } = makeAdapter({ applied: [applied49], baselines: [baseline] });
    const report = await runAudit(directory, adapter);
    assert.equal(report.status, 'AUDIT_COMPLETE');
    assert.equal(report.baseline.reconciliationMigration, '049_current.sql');
    assert.deepEqual(report.applied.map(({ version }) => version), [49]);
    assert.deepEqual(report.pending.map(({ version }) => version), [82, 83]);
    assert.deepEqual(report.historicalUntracked.map(({ version }) => version), [1]);
    assert.equal(report.migration082.status, 'PENDING_AND_SCHEMA_ABSENT');
    assert.equal(report.ledger.checksumConsistent, true);
    assert.deepEqual(report.ledger.gaps, []);
  });

  await t.test('requires TiDB engine and canonical database identity', async () => {
    const wrongEngine = makeAdapter({ identity: { ready: true, engine: 'MySQL', database: 'osaahdaylightschool' } });
    await assert.rejects(() => runAudit(directory, wrongEngine.adapter), { code: 'DATABASE_IDENTITY_MISMATCH' });
    const wrongDatabase = makeAdapter({ identity: { ready: true, engine: 'TiDB', database: 'other_database' } });
    await assert.rejects(() => runAudit(directory, wrongDatabase.adapter), { code: 'DATABASE_IDENTITY_MISMATCH' });
    const wrongSchool = makeAdapter({ schoolRows: [] });
    await assert.rejects(() => runAudit(directory, wrongSchool.adapter), { code: 'SCHOOL_IDENTITY_MISMATCH' });
  });

  await t.test('performs only SELECT queries and does not create metadata or use mutation methods', async () => {
    const { adapter, queries } = makeAdapter({ applied: [applied49], baselines: [baseline] });
    await runAudit(directory, adapter);
    assert.ok(queries.length > 0);
    assert.ok(queries.every(({ sql }) => /^\s*SELECT\b/i.test(sql)));
  });

  await t.test('fails closed when migration metadata tables are missing', async () => {
    const { adapter } = makeAdapter({ metadataTables: ['schema_migrations'] });
    await assert.rejects(() => runAudit(directory, adapter), { code: 'MIGRATION_METADATA_MISSING' });
  });

  await t.test('reports checksum mismatches and version gaps', async () => {
    const { adapter } = makeAdapter({
      applied: [applied49, { version: 83, name: '083_after.sql', checksum: 'a'.repeat(64), appliedAt: null }],
      baselines: [baseline]
    });
    const report = await runAudit(directory, adapter);
    assert.equal(report.status, 'AUDIT_BLOCKED');
    assert.ok(report.blockingIssues.some(({ code }) => code === 'MIGRATION_CHECKSUM_MISMATCH'));
    assert.ok(report.blockingIssues.some(({ code }) => code === 'MIGRATION_LEDGER_GAP'));
    assert.equal(report.ledger.checksumConsistent, false);
  });

  await t.test('flags RUNNING and FAILED runs and inconsistent COMPLETED runs', async () => {
    for (const state of ['RUNNING', 'FAILED']) {
      const { adapter } = makeAdapter({ applied: [applied49], baselines: [baseline], runs: [{ version: 82, name: '082_parent_sms_auth.sql', checksum: migrations.find(({ version }) => version === 82).checksum, state, startedAt: '2026-11-01T00:00:00Z', errorCode: 'SAFE_CODE' }] });
      const report = await runAudit(directory, adapter);
      assert.ok(report.blockingIssues.some((issue) => issue.code === 'MIGRATION_RECOVERY_REQUIRED' && issue.state === state));
      assert.equal(report.migrationRuns[0].state, state);
    }
    const { adapter } = makeAdapter({ applied: [applied49], baselines: [baseline], runs: [{ version: 82, name: '082_parent_sms_auth.sql', checksum: migrations.find(({ version }) => version === 82).checksum, state: 'COMPLETED' }] });
    const report = await runAudit(directory, adapter);
    assert.ok(report.blockingIssues.some(({ code }) => code === 'COMPLETED_RUN_LEDGER_MISMATCH'));
  });

  await t.test('classifies Migration 082 as applied only when ledger and both tables agree', async () => {
    const migration082 = migrations.find(({ version }) => version === 82);
    const applied082 = { version: 82, name: migration082.name, checksum: migration082.checksum, appliedAt: '2026-11-02T00:00:00Z' };
    const complete = makeAdapter({ applied: [applied49, applied082], baselines: [baseline], parentTables: ['parent_auth_rate_limits', 'parent_auth_challenges'] });
    assert.equal((await runAudit(directory, complete.adapter)).migration082.status, 'RECORDED_APPLIED_AND_SCHEMA_PRESENT');
    const partial = makeAdapter({ applied: [applied49, applied082], baselines: [baseline], parentTables: ['parent_auth_rate_limits'] });
    const report = await runAudit(directory, partial.adapter);
    assert.equal(report.migration082.status, 'RECORDED_APPLIED_BUT_SCHEMA_PARTIAL_OR_MISSING');
    assert.ok(report.blockingIssues.some(({ code }) => code === 'MIGRATION_082_SCHEMA_INCONSISTENT'));
  });

  await t.test('sanitizes connection failures and does not leak connection secrets', async () => {
    const { adapter } = makeAdapter({ failAt: 'identity' });
    await assert.rejects(() => runAudit(directory, adapter), (error) => error.code === 'TIDB_CONNECTION_FAILED' && !error.message.includes('do-not-print'));
  });

  await t.test('rejects a production report query error without exposing driver data', async () => {
    const { adapter } = makeAdapter({ failAt: 'SELECT id FROM schools WHERE id=? LIMIT 2' });
    await assert.rejects(() => runAudit(directory, adapter), (error) => error.code === 'SCHOOL_IDENTITY_QUERY_FAILED' && !error.message.includes('do-not-print'));
  });

  await t.test('workflow uses protected read-only dispatch and the status command only', async () => {
    const workflow = await readFile(new URL('../.github/workflows/production-tidb-migration-audit.yml', import.meta.url), 'utf8');
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /environment: production/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /group: production-tidb-migration-audit/);
    assert.match(workflow, /node-version: 20/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /node scripts\/migrate\.mjs status/);
    assert.doesNotMatch(workflow, /migration:apply|migration:baseline|forward-reconciliation|TRUNCATE|ALTER TABLE|DROP TABLE/);
  });

  await t.test('CLI fails safely when protected DATABASE_URL is unavailable', async () => {
    const run = promisify(execFile);
    const script = fileURLToPath(new URL('../scripts/migrate.mjs', import.meta.url));
    const env = { ...process.env, OSAAH_RELEASE_REF: releaseSha, OSAAH_VERIFIED_RELEASE_COMMIT: releaseSha, GITHUB_REPOSITORY: PRODUCTION_REPOSITORY };
    delete env.DATABASE_URL;
    await assert.rejects(() => run(process.execPath, [script, 'status'], { env }), (failure) => {
      const result = JSON.parse(failure.stderr.trim());
      return result.error === 'DATABASE_URL_REQUIRED' && !failure.stderr.includes('secret');
    });
  });
});
