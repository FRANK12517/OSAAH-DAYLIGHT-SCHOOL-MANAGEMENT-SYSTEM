import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createProductionBaseline, schemaFingerprint } from '../src/platform/baseline.js';

const expectedDatabase = 'osaahdaylightschool';

function requireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`Baseline query ${label} must return an array of rows.`);
  return value;
}

export async function recordProductionBaseline({ adapter, repositoryCommit, workflowProvenance, expectedDatabaseName = expectedDatabase, now = new Date() } = {}) {
  if (!adapter || typeof adapter.query !== 'function') throw new Error('A database adapter with query() is required.');
  if (!repositoryCommit) throw new Error('A reviewed repository commit is required.');
  if (!/^[a-f0-9]{40}$/i.test(repositoryCommit)) throw new Error('Baseline repositoryCommit must be a 40-character commit SHA.');
  if (!workflowProvenance) throw new Error('Baseline workflow provenance is required.');

  const databaseRows = requireRows(await adapter.query('SELECT DATABASE() AS database_name'), 'database');
  const database = databaseRows[0];
  if (!database || typeof database !== 'object' || typeof database.database_name !== 'string' || !database.database_name) throw new Error('Baseline database query returned no valid database_name.');
  if (database.database_name !== expectedDatabaseName) throw new Error(`Unexpected database target: ${database.database_name}.`);

  const tables = requireRows(await adapter.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'), 'tables');
  const columns = requireRows(await adapter.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, COLUMN_NAME'), 'columns');
  const indexes = requireRows(await adapter.query('SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME'), 'indexes');
  const foreignKeys = requireRows(await adapter.query("SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME"), 'foreign keys');
  const fingerprint = schemaFingerprint({
    tables: tables.map((row) => row.TABLE_NAME),
    columns: columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`),
    indexes: indexes.map((row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`),
    foreignKeys: foreignKeys.map((row) => `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}->${row.REFERENCED_TABLE_NAME}`)
  });
  const timestamp = now.toISOString().replace('T', ' ').replace('Z', '');
  const baseline = createProductionBaseline({ canonicalDatabase: expectedDatabaseName, baselineAt: timestamp, repositoryCommit, schemaFingerprint: fingerprint, reconciliationMigration: '049_production_schema_reconciliation.sql', workflowProvenance });
  await adapter.ensureMetadata({ create: true });
  if (typeof adapter.listBaselines === 'function') {
    const existing = requireRows(await adapter.listBaselines(), 'existing baselines').find((record) => record.id === baseline.id);
    if (existing) {
      const compatible = existing.canonicalDatabase === baseline.canonicalDatabase
        && existing.repositoryCommit === baseline.repositoryCommit
        && existing.schemaFingerprint === baseline.schemaFingerprint
        && existing.reconciliationMigration === baseline.reconciliationMigration
        && existing.baselineType === 'HISTORICAL_BASELINE'
        && (existing.historicalMigrationsExecuted === false || existing.historicalMigrationsExecuted === 0);
      if (!compatible) throw new Error(`Existing baseline ${baseline.id} conflicts with the reviewed release or schema fingerprint.`);
      return { baseline: existing, historicalMigrationsRecorded: false, reused: true };
    }
  }
  await adapter.recordBaseline(baseline);
  return { baseline, historicalMigrationsRecorded: false, reused: false };
}

async function main() {
  if (process.env.OSAAH_BASELINE_CONFIRM !== 'RECORD_CURRENT_BASELINE') throw new Error('Refusing to record a baseline without OSAAH_BASELINE_CONFIRM=RECORD_CURRENT_BASELINE.');
  const repositoryCommit = process.env.GITHUB_SHA || process.env.OSAAH_REPOSITORY_COMMIT;
  const workflowProvenance = process.env.GITHUB_WORKFLOW ? `${process.env.GITHUB_WORKFLOW}/${process.env.GITHUB_RUN_ID ?? 'local'}` : (process.env.OSAAH_WORKFLOW_PROVENANCE || 'manual-current-state-baseline');
  const adapter = createDatabaseAdapter();
  try {
    const result = await recordProductionBaseline({ adapter, repositoryCommit, workflowProvenance });
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  } finally { await adapter.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
