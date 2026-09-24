import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner } from '../src/platform/migration-runner.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

if (!process.env.DATABASE_URL) {
  process.stderr.write(JSON.stringify({ error: 'DATABASE_URL_MISSING' }) + '\n');
  process.exitCode = 1;
} else {
  const adapter = createDatabaseAdapter();
  const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  try {
    const before = await runner.status();
    const pending = before.pending.map(({ version, name, checksum }) => ({ version, name, checksum }));
    if (!pending.length) throw Object.assign(new Error('No pending migration was available for durable authentication.'), { code: 'AUTH_MIGRATION_NOT_PENDING' });
    if (!pending.some((migration) => migration.name === '052_durable_auth_sessions.sql')) throw Object.assign(new Error('Unexpected pending migration set.'), { code: 'UNEXPECTED_PENDING_MIGRATION' });
    const result = await runner.apply();
    const columns = await adapter.query('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['auth_sessions']);
    const indexes = await adapter.query('SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX', ['auth_sessions']);
    const after = await runner.status();
    process.stdout.write(JSON.stringify({ ok: true, applied: result.applied.map(({ version, name, checksum }) => ({ version, name, checksum })), authSessions: { present: columns.length > 0, columns, indexes }, pendingAfter: after.pending.map(({ version, name }) => ({ version, name })) }) + '\n');
  } catch (error) {
    const details = error?.details && typeof error.details === 'object' ? {
      migration: error.details.migration ?? null,
      version: error.details.version ?? null,
      statementIndex: error.details.statementIndex ?? null,
      operation: error.details.operation ?? null,
      databaseCode: error.details.databaseCode ?? null,
      sqlState: error.details.sqlState ?? null,
      databaseMessage: error.details.databaseMessage ?? null
    } : undefined;
    process.stderr.write(JSON.stringify({ error: error.code ?? 'DURABLE_AUTH_MIGRATION_FAILED', message: error.code ? error.message : 'Durable auth migration failed safely.', ...(details ? { details } : {}) }) + '\n');
    process.exitCode = 1;
  } finally { await adapter.close(); }
}
