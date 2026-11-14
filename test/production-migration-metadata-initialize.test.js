import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initializeProductionMigrationMetadata } from '../scripts/production-migration-metadata-initialize.mjs';

const backup = {
  backupConfirmation: 'BACKUP_CONFIRMED', backupCluster: 'osaahdaylightschool', backupStatus: 'Succeeded', backupRestoreAvailable: true,
  backupCompletedAt: '2026-11-14T03:00:45Z', backupExpiresAt: '2026-11-15T03:00:45Z', now: new Date('2026-11-14T09:30:00Z')
};
const columnFixture = [
  ['version', 'int', 'int(11)', 'NO', null], ['name', 'varchar', 'varchar(255)', 'NO', 255],
  ['checksum', 'char', 'char(64)', 'NO', 64], ['state', 'enum', "enum('RUNNING','FAILED','COMPLETED')", 'NO', null],
  ['started_at', 'datetime', 'datetime', 'NO', null], ['completed_at', 'datetime', 'datetime', 'YES', null],
  ['error_code', 'varchar', 'varchar(80)', 'YES', 80]
];

function fixture({ missing = [], locked = false } = {}) {
  const tables = new Set(['schema_migrations', 'schema_migration_lock', 'schema_baselines', 'schema_migration_runs'].filter((name) => !missing.includes(name)));
  const calls = [];
  let lock = locked ? 1 : 0;
  const adapter = {
    async verifyReadiness() { calls.push('verifyReadiness'); return { ready: true, engine: 'TiDB', database: 'osaahdaylightschool', serverVersion: '5.7.25-TiDB-v8.5.0' }; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('information_schema.TABLES') && sql.includes('IN (')) return [...tables].map((tableName) => ({ tableName }));
      if (sql.startsWith('SHOW CREATE TABLE')) return [{ 'Create Table': `CREATE TABLE ${sql.match(/`([^`]+)`/)?.[1]} (metadata-definition)` }];
      if (sql.includes('FROM schema_migrations')) return [{ version: 49, name: '049_production_schema_reconciliation.sql', checksum: 'a'.repeat(64), appliedAt: '2026-11-01 00:00:00' }];
      if (sql.includes('FROM schema_baselines')) return [{ id: 'baseline-1', canonicalDatabase: 'osaahdaylightschool', repositoryCommit: 'b'.repeat(40) }];
      if (sql.includes('FROM schema_migration_lock')) return [{ lockId: 1, locked: lock, acquiredAt: lock ? '2026-11-14 09:30:00' : null }];
      if (sql.includes('information_schema.TABLES') && params[0] === 'schema_migration_runs') return tables.has('schema_migration_runs') ? [{ engine: 'InnoDB' }] : [];
      if (sql.includes('information_schema.COLUMNS')) return columnFixture.map(([columnName, dataType, columnType, nullable, maxLength]) => ({ columnName, dataType, columnType, nullable, maxLength }));
      if (sql.includes('information_schema.STATISTICS')) return [{ indexName: 'PRIMARY', nonUnique: 0, columnName: 'version', sequence: 1 }];
      if (sql.includes('COUNT(*) AS runCount')) return [{ runCount: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async acquireLock() { calls.push('acquireLock'); if (lock) return false; lock = 1; return true; },
    async releaseLock() { calls.push('releaseLock'); lock = 0; },
    async ensureMetadata(options) { calls.push({ ensureMetadata: options }); tables.add('schema_migration_runs'); },
    async execute() { throw new Error('Direct SQL execution is not allowed by metadata initialization.'); },
    async transaction() { throw new Error('Transactions are not part of metadata initialization.'); },
    async startMigration() { throw new Error('No numbered migration may run during metadata initialization.'); }
  };
  return { adapter, calls };
}

test('metadata-only bootstrap creates only migration run metadata through the authoritative initializer', async () => {
  const { adapter, calls } = fixture({ missing: ['schema_migration_runs'] });
  const result = await initializeProductionMigrationMetadata({ adapter, ...backup });
  assert.equal(result.outcome, 'INITIALIZED');
  assert.deepEqual(result.createdTables, ['schema_migration_runs']);
  assert.equal(result.database, 'osaahdaylightschool');
  assert.equal(result.serverVersion, '5.7.25-TiDB-v8.5.0');
  assert.equal(result.migrationHistoryUnchanged, true);
  assert.equal(result.baselineHistoryUnchanged, true);
  assert.equal(result.migrationLock, 'RELEASED_IDLE');
  assert.deepEqual(result.migrationRuns, { engine: 'InnoDB', columns: 7, primaryKey: 'version', runCount: 0 });
  assert.equal(result.migration085Executed, false);
  assert.equal(result.numberedMigrationsExecuted, false);
  assert.equal(result.studentOrGuardianRecordsChanged, false);
  assert.deepEqual(calls.filter((item) => typeof item === 'object' && 'ensureMetadata' in item), [{ ensureMetadata: { create: true } }]);
  assert.equal(calls.includes('acquireLock'), true);
  assert.equal(calls.includes('releaseLock'), true);
  assert.equal(calls.some((item) => typeof item === 'object' && /\bstudents\b|\bparent_student_links\b|\badmission_applications\b/i.test(item.sql)), false);
});

test('metadata bootstrap refuses missing ledger prerequisites or a busy lock before initialization', async (t) => {
  await t.test('missing schema_migrations', async () => {
    const { adapter, calls } = fixture({ missing: ['schema_migrations', 'schema_migration_runs'] });
    await assert.rejects(() => initializeProductionMigrationMetadata({ adapter, ...backup }), { code: 'MIGRATION_METADATA_PREREQUISITE_MISSING' });
    assert.equal(calls.some((item) => typeof item === 'object' && 'ensureMetadata' in item), false);
  });
  await t.test('migration lock busy', async () => {
    const { adapter, calls } = fixture({ missing: ['schema_migration_runs'], locked: true });
    await assert.rejects(() => initializeProductionMigrationMetadata({ adapter, ...backup }), { code: 'MIGRATION_LOCKED' });
    assert.equal(calls.some((item) => typeof item === 'object' && 'ensureMetadata' in item), false);
  });
});

test('metadata bootstrap requires a current successful restorable backup', async () => {
  for (const change of [
    { backupConfirmation: '' }, { backupCluster: 'another-cluster' }, { backupStatus: 'Running' },
    { backupRestoreAvailable: false }, { backupExpiresAt: '2026-11-14T09:29:59Z' }
  ]) {
    const { adapter, calls } = fixture({ missing: ['schema_migration_runs'] });
    await assert.rejects(() => initializeProductionMigrationMetadata({ adapter, ...backup, ...change }));
    assert.equal(calls.length, 0);
  }
});

test('existing compatible metadata is recognized idempotently without acquiring the lock or creating tables', async () => {
  const { adapter, calls } = fixture();
  const result = await initializeProductionMigrationMetadata({ adapter, ...backup });
  assert.equal(result.outcome, 'ALREADY_PRESENT');
  assert.equal(calls.includes('acquireLock'), false);
  assert.equal(calls.some((item) => typeof item === 'object' && 'ensureMetadata' in item), false);
});

test('Production migration workflow isolates metadata initialization and keeps DRY_RUN/apply gates intact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-global-student-id-unique-migration-085.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /INITIALIZE_MIGRATION_METADATA_ONLY/);
  assert.match(workflow, /node \.migration-085-verifier\/scripts\/production-migration-metadata-initialize\.mjs/);
  assert.match(workflow, /inputs\.execution_token == 'INITIALIZE_MIGRATION_METADATA_ONLY'/);
  assert.match(workflow, /inputs\.execution_token == 'DRY_RUN_ONLY'[\s\S]*production-global-student-id-unique-migrate-085\.mjs dry-run/);
  assert.match(workflow, /inputs\.execution_token == 'APPLY_GLOBAL_STUDENT_ID_UNIQUE_085'[\s\S]*production-global-student-id-unique-migrate-085\.mjs apply/);
  assert.match(workflow, /BACKUP_EXPIRES_AT/);
  assert.doesNotMatch(workflow, /migration:apply|migrate\.mjs apply/);
});
