import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';

const VERSION = 76;
const NAME = '076_durable_announcements.sql';
const APPLY_TOKEN = 'APPLY_DURABLE_ANNOUNCEMENTS_076';
const mode = process.argv[2] ?? 'dry-run';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const migration = (await discoverMigrations(directory)).find((item) => item.version === VERSION);
if (!migration || migration.name !== NAME) throw new Error('Migration 076 file is missing or mismatched.');
const sql = await readFile(new URL(`../schema/${NAME}`, import.meta.url), 'utf8');
if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('Migration 076 checksum mismatch.');
if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) throw new Error('Migration 076 is destructive.');

const rows = (value) => Array.isArray(value) ? value : [];
const requiredTables = ['schools', 'users', 'roles', 'user_roles', 'parent_student_links', 'schema_migrations', 'schema_migration_lock'];
const announcementTables = ['announcement_records', 'announcement_recipients', 'announcement_reads'];
async function snapshot(adapter) {
  const tables = rows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('schools','users','roles','user_roles','parent_student_links','schema_migrations','schema_migration_lock','announcement_records','announcement_recipients','announcement_reads') ORDER BY TABLE_NAME"));
  const present = new Set(tables.map((item) => item.tableName));
  const columns = rows(await adapter.query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('announcement_records','announcement_recipients','announcement_reads') ORDER BY TABLE_NAME,ORDINAL_POSITION"));
  const indexes = rows(await adapter.query("SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('announcement_records','announcement_recipients','announcement_reads') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX"));
  const counts = {};
  for (const table of [...requiredTables, ...announcementTables]) if (present.has(table)) counts[table] = Number(rows(await adapter.query(`SELECT COUNT(*) AS count FROM ${table}`))[0]?.count ?? 0);
  const ledger = present.has('schema_migrations') ? rows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION])) : [];
  return { tables: [...present].sort(), columns, indexes, counts, ledger };
}
function assertPrerequisites(snapshotValue) {
  const missing = requiredTables.filter((table) => !snapshotValue.tables.includes(table));
  if (missing.length) throw new Error(`Migration 076 prerequisites are missing: ${missing.join(', ')}.`);
}
function assertAnnouncementSchema(snapshotValue) {
  const required = {
    announcement_records: ['id', 'school_id', 'title', 'message', 'priority', 'recipient_category', 'status', 'scheduled_for', 'published_at', 'sender_id', 'created_at', 'updated_at'],
    announcement_recipients: ['id', 'school_id', 'announcement_id', 'recipient_id', 'recipient_type', 'assigned_at'],
    announcement_reads: ['id', 'school_id', 'announcement_id', 'recipient_id', 'read_at']
  };
  for (const [table, columns] of Object.entries(required)) {
    if (!snapshotValue.tables.includes(table)) throw new Error(`Migration 076 verification failed: ${table} is missing.`);
    const actual = new Set(snapshotValue.columns.filter((item) => item.tableName === table).map((item) => item.columnName));
    const missing = columns.filter((column) => !actual.has(column));
    if (missing.length) throw new Error(`Migration 076 verification failed for ${table}: ${missing.join(', ')}.`);
  }
  for (const index of ['idx_announcement_recipient', 'idx_announcement_due', 'idx_announcement_reads']) if (!snapshotValue.indexes.some((item) => item.indexName === index)) throw new Error(`Migration 076 verification failed: index ${index} is missing.`);
}

if (mode === 'dry-run') {
  const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null);
  if (!modulePath) throw new Error('A durable production database adapter module is required for read-only preflight.');
  const loaded = await import(pathToFileURL(resolve(modulePath)));
  const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
  try {
    const before = await snapshot(adapter); assertPrerequisites(before);
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [75], dryRun: true });
    console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, plan, execution: 'read-only' }));
  } finally { await adapter?.close?.(); }
  process.exit(0);
}
if (mode !== 'apply' || process.env.EXECUTION_TOKEN !== APPLY_TOKEN || process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') throw new Error('Migration 076 apply requires the protected token and backup confirmation.');
const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null);
if (!modulePath) throw new Error('A durable production database adapter module is required.');
const loaded = await import(pathToFileURL(resolve(modulePath)));
const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
try {
  const before = await snapshot(adapter); assertPrerequisites(before);
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [75], verifyMigration: async ({ adapter: transaction }) => assertAnnouncementSchema(await snapshot(transaction)) });
  const after = await snapshot(adapter); assertAnnouncementSchema(after);
  for (const table of ['schools', 'users', 'roles', 'user_roles', 'parent_student_links']) if (after.counts[table] !== before.counts[table]) throw new Error(`Migration 076 changed existing row count in ${table}.`);
  if (!after.ledger.some((item) => item.version === VERSION && item.name === NAME && item.checksum === migration.checksum)) throw new Error('Migration 076 ledger record was not verified.');
  console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, after, result }));
} finally { await adapter?.close?.(); }
