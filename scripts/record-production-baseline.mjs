import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createProductionBaseline, schemaFingerprint } from '../src/platform/baseline.js';

const expectedDatabase = 'osaahdaylightschool';
if (process.env.OSAAH_BASELINE_CONFIRM !== 'RECORD_CURRENT_BASELINE') {
  throw new Error('Refusing to record a baseline without OSAAH_BASELINE_CONFIRM=RECORD_CURRENT_BASELINE.');
}
const repositoryCommit = process.env.GITHUB_SHA || process.env.OSAAH_REPOSITORY_COMMIT;
const workflowProvenance = process.env.GITHUB_WORKFLOW ? `${process.env.GITHUB_WORKFLOW}/${process.env.GITHUB_RUN_ID ?? 'local'}` : (process.env.OSAAH_WORKFLOW_PROVENANCE || 'manual-current-state-baseline');
if (!repositoryCommit) throw new Error('A reviewed repository commit is required.');
const adapter = createDatabaseAdapter();
try {
  const [[database]] = await adapter.query('SELECT DATABASE() AS database_name');
  if (database?.database_name !== expectedDatabase) throw new Error(`Unexpected database target: ${database?.database_name ?? 'unknown'}.`);
  const [tables] = await adapter.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
  const [columns] = await adapter.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, COLUMN_NAME');
  const [indexes] = await adapter.query('SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME');
  const [foreignKeys] = await adapter.query("SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME");
  const fingerprint = schemaFingerprint({
    tables: tables.map((row) => row.TABLE_NAME),
    columns: columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`),
    indexes: indexes.map((row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`),
    foreignKeys: foreignKeys.map((row) => `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}->${row.REFERENCED_TABLE_NAME}`)
  });
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const baseline = createProductionBaseline({ canonicalDatabase: expectedDatabase, baselineAt: timestamp, repositoryCommit, schemaFingerprint: fingerprint, reconciliationMigration: '049_production_schema_reconciliation.sql', workflowProvenance });
  await adapter.ensureMetadata({ create: true });
  await adapter.recordBaseline(baseline);
  process.stdout.write(JSON.stringify({ ok: true, baseline: { ...baseline, schemaFingerprint: fingerprint }, historicalMigrationsRecorded: false }) + '\n');
} finally { await adapter.close(); }
