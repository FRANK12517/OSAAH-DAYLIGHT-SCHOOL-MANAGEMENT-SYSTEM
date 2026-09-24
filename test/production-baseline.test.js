import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordProductionBaseline } from '../scripts/record-production-baseline.mjs';

const commit = '71cf16dd2782f737716ef60682baccd795fd358d';
const provenance = 'test/contract';
const queries = {
  database: 'SELECT DATABASE() AS database_name',
  tables: 'SELECT TABLE_NAME FROM information_schema.TABLES',
  columns: 'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS',
  indexes: 'SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS',
  foreignKeys: 'SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE'
};

function baselineAdapter({ databaseResult = [{ database_name: 'osaahdaylightschool' }], malformedQuery = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (malformedQuery && sql.includes(malformedQuery)) return { not: 'rows' };
      if (sql.includes('SELECT DATABASE()')) return databaseResult;
      if (sql.includes('information_schema.TABLES')) return [{ TABLE_NAME: 'schools' }];
      if (sql.includes('information_schema.COLUMNS')) return [{ TABLE_NAME: 'schools', COLUMN_NAME: 'id' }];
      if (sql.includes('information_schema.STATISTICS')) return [{ TABLE_NAME: 'schools', INDEX_NAME: 'PRIMARY' }];
      return [];
    },
    async ensureMetadata() { calls.push('ensureMetadata'); },
    async recordBaseline(record) { this.recorded = record; }
  };
}

test('baseline recorder consumes the canonical rows-only adapter contract', async () => {
  const adapter = baselineAdapter();
  const result = await recordProductionBaseline({ adapter, repositoryCommit: commit, workflowProvenance: provenance, now: new Date('2026-09-24T00:00:00.000Z') });
  assert.equal(result.baseline.canonicalDatabase, 'osaahdaylightschool');
  assert.equal(result.baseline.repositoryCommit, commit);
  assert.equal(result.historicalMigrationsRecorded, false);
  assert.equal(adapter.calls[0], queries.database);
  assert.equal(adapter.calls.at(-1), 'ensureMetadata');
  assert.equal(adapter.recorded.baselineType, 'HISTORICAL_BASELINE');
});

test('baseline recorder fails closed for a wrong database', async () => {
  await assert.rejects(() => recordProductionBaseline({ adapter: baselineAdapter({ databaseResult: [{ database_name: 'wrong_database' }] }), repositoryCommit: commit, workflowProvenance: provenance }), /Unexpected database target/);
});

test('baseline recorder fails closed for an empty database result', async () => {
  await assert.rejects(() => recordProductionBaseline({ adapter: baselineAdapter({ databaseResult: [] }), repositoryCommit: commit, workflowProvenance: provenance }), /no valid database_name/);
});

test('baseline recorder fails closed for a malformed database result', async () => {
  await assert.rejects(() => recordProductionBaseline({ adapter: baselineAdapter({ databaseResult: { database_name: 'osaahdaylightschool' } }), repositoryCommit: commit, workflowProvenance: provenance }), /must return an array of rows/);
});

test('baseline recorder fails closed when a later schema query violates the rows-only contract', async () => {
  await assert.rejects(() => recordProductionBaseline({ adapter: baselineAdapter({ malformedQuery: 'COLUMNS' }), repositoryCommit: commit, workflowProvenance: provenance }), /columns must return an array of rows/);
});
