import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const migrationName = '052_durable_auth_sessions.sql';
const migrationVersion = 52;
const expectedColumns = [
  ['id', 'varchar(191)', 'NO', 'PRI'],
  ['user_id', 'varchar(191)', 'NO', 'MUL'],
  ['school_id', 'varchar(191)', 'NO', 'MUL'],
  ['token_hash', 'char(64)', 'NO', 'UNI'],
  ['created_at', 'varchar(32)', 'NO', ''],
  ['expires_at', 'varchar(32)', 'NO', 'MUL'],
  ['revoked_at', 'varchar(32)', 'YES', ''],
  ['last_used_at', 'varchar(32)', 'YES', '']
];
const expectedIndexes = [
  ['PRIMARY', 'id', 1],
  ['idx_auth_sessions_expiry', 'expires_at', 1],
  ['idx_auth_sessions_expiry', 'revoked_at', 2],
  ['idx_auth_sessions_school', 'school_id', 1],
  ['idx_auth_sessions_user_active', 'user_id', 1],
  ['idx_auth_sessions_user_active', 'revoked_at', 2],
  ['idx_auth_sessions_user_active', 'expires_at', 3],
  ['token_hash', 'token_hash', 1]
];
const safeDetails = (error) => error?.details && typeof error.details === 'object' ? {
  migration: error.details.migration ?? null,
  version: error.details.version ?? null,
  statementIndex: error.details.statementIndex ?? null,
  operation: error.details.operation ?? null,
  databaseCode: error.details.databaseCode ?? null,
  sqlState: error.details.sqlState ?? null
} : undefined;
const schemaState = async (adapter) => {
  const columns = await adapter.query('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', ['auth_sessions']);
  const indexes = await adapter.query('SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX', ['auth_sessions']);
  const columnShape = columns.map((row) => [row.COLUMN_NAME, row.COLUMN_TYPE, row.IS_NULLABLE, row.COLUMN_KEY]);
  const indexShape = indexes.map((row) => [row.INDEX_NAME, row.COLUMN_NAME, Number(row.SEQ_IN_INDEX)]);
  return { columns, indexes, exact: JSON.stringify(columnShape) === JSON.stringify(expectedColumns) && JSON.stringify(indexShape) === JSON.stringify(expectedIndexes) };
};

if (!process.env.DATABASE_URL) {
  process.stderr.write(JSON.stringify({ error: 'DATABASE_URL_MISSING' }) + '\n');
  process.exitCode = 1;
} else {
  const adapter = createDatabaseAdapter();
  try {
    const database = (await adapter.query('SELECT DATABASE() AS database_name'))[0]?.database_name;
    if (database !== 'osaahdaylightschool') throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const sql = await readFile(resolve(fileURLToPath(new URL('../schema/052_durable_auth_sessions.sql', import.meta.url))), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = await adapter.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC');
    const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]));
    for (const version of [50, 51, 53]) if (!appliedByVersion.has(version)) throw Object.assign(new Error(`Required forward migration ${version} is not recorded.`), { code: 'AUTH_MIGRATION_SEQUENCE_UNEXPECTED' });
    const stateBefore = await schemaState(adapter);
    if (appliedByVersion.has(migrationVersion)) {
      const record = appliedByVersion.get(migrationVersion);
      if (record.name !== migrationName || record.checksum !== checksum || !stateBefore.exact) throw Object.assign(new Error('Recorded durable auth migration does not match the expected schema.'), { code: 'AUTH_MIGRATION_SCHEMA_MISMATCH' });
      process.stdout.write(JSON.stringify({ ok: true, alreadyApplied: true, applied: [record], authSessions: { present: true, columns: stateBefore.columns, indexes: stateBefore.indexes } }) + '\n');
    } else {
      if (stateBefore.columns.length && !stateBefore.exact) throw Object.assign(new Error('The durable auth table exists but does not exactly match migration 052; refusing to alter or recreate it.'), { code: 'AUTH_SESSION_SCHEMA_MISMATCH' });
      const appliedAt = new Date().toISOString();
      if (!stateBefore.columns.length) {
        await adapter.transaction(async (transaction) => {
          await transaction.executeMigrationSql(sql, { migrationName, version: migrationVersion });
          await transaction.recordApplied({ version: migrationVersion, name: migrationName, checksum, appliedAt });
        });
      } else {
        await adapter.recordApplied({ version: migrationVersion, name: migrationName, checksum, appliedAt });
      }
      const stateAfter = await schemaState(adapter);
      const recorded = await adapter.query('SELECT version, name, checksum, applied_at FROM schema_migrations WHERE version=?', [migrationVersion]);
      if (!stateAfter.exact) throw Object.assign(new Error('Migration 052 was recorded but post-migration schema verification failed.'), { code: 'AUTH_MIGRATION_SCHEMA_VERIFY_FAILED' });
      process.stdout.write(JSON.stringify({ ok: true, alreadyApplied: false, reconciledExistingSchema: Boolean(stateBefore.columns.length), applied: recorded, authSessions: { present: true, columns: stateAfter.columns, indexes: stateAfter.indexes } }) + '\n');
    }
  } catch (error) {
    const details = safeDetails(error);
    process.stderr.write(JSON.stringify({ error: error.code ?? 'DURABLE_AUTH_MIGRATION_FAILED', message: error.code ? error.message : 'Durable auth migration failed safely.', ...(details ? { details } : {}) }) + '\n');
    process.exitCode = 1;
  } finally { await adapter.close(); }
}
