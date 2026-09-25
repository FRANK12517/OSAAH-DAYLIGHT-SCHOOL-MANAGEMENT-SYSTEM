import { readFile } from 'node:fs/promises';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const migrationName = '052_durable_auth_sessions.sql';
const migrationVersion = 52;
const safeDetails = (error) => error?.details && typeof error.details === 'object' ? {
  migration: error.details.migration ?? null,
  version: error.details.version ?? null,
  statementIndex: error.details.statementIndex ?? null,
  operation: error.details.operation ?? null,
  databaseCode: error.details.databaseCode ?? null,
  sqlState: error.details.sqlState ?? null
} : undefined;

if (!process.env.DATABASE_URL) {
  process.stderr.write(JSON.stringify({ error: 'DATABASE_URL_MISSING' }) + '\n');
  process.exitCode = 1;
} else {
  const adapter = createDatabaseAdapter();
  try {
    const database = (await adapter.query('SELECT DATABASE() AS database_name'))[0]?.database_name;
    if (database !== 'osaahdaylightschool') throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const applied = await adapter.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');
    const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]));
    if (appliedByVersion.has(migrationVersion)) throw Object.assign(new Error('Durable auth migration is already recorded.'), { code: 'AUTH_MIGRATION_ALREADY_APPLIED' });
    for (const version of [50, 51, 53]) if (!appliedByVersion.has(version)) throw Object.assign(new Error(`Required forward migration ${version} is not recorded.`), { code: 'AUTH_MIGRATION_SEQUENCE_UNEXPECTED' });
    const tableRows = await adapter.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['auth_sessions']);
    if (tableRows.length) throw Object.assign(new Error('The durable auth table exists but migration 052 is not recorded; refusing to guess or recreate it.'), { code: 'AUTH_SESSION_SCHEMA_UNTRACKED' });
    const sql = await readFile(resolve(fileURLToPath(new URL('../schema/052_durable_auth_sessions.sql', import.meta.url))), 'utf8');
    const checksum = (await import('node:crypto')).createHash('sha256').update(sql).digest('hex');
    const appliedAt = new Date().toISOString();
    await adapter.transaction(async (transaction) => {
      await transaction.executeMigrationSql(sql, { migrationName, version: migrationVersion });
      await transaction.recordApplied({ version: migrationVersion, name: migrationName, checksum, appliedAt });
    });
    const columns = await adapter.query('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['auth_sessions']);
    const indexes = await adapter.query('SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX', ['auth_sessions']);
    const recorded = await adapter.query('SELECT version, name, checksum FROM schema_migrations WHERE version=?', [migrationVersion]);
    process.stdout.write(JSON.stringify({ ok: true, applied: recorded, authSessions: { present: columns.length > 0, columns, indexes } }) + '\n');
  } catch (error) {
    const details = safeDetails(error);
    process.stderr.write(JSON.stringify({ error: error.code ?? 'DURABLE_AUTH_MIGRATION_FAILED', message: error.code ? error.message : 'Durable auth migration failed safely.', ...(details ? { details } : {}) }) + '\n');
    process.exitCode = 1;
  } finally { await adapter.close(); }
}
