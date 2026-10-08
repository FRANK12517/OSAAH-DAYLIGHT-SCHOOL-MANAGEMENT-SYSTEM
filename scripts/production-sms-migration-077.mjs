import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';

const VERSION = 77;
const NAME = '077_durable_sms_messages.sql';
const APPLY_TOKEN = 'APPLY_DURABLE_SMS_MESSAGES_077';
const mode = process.argv[2] ?? 'dry-run';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const migrations = await discoverMigrations(directory);
const migration = migrations.find((item) => item.version === VERSION);
const predecessor = migrations.find((item) => item.version === 76);
if (!migration || migration.name !== NAME) throw new Error('Migration 077 file is missing or mismatched.');
if (!predecessor || predecessor.name !== '076_durable_announcements.sql') throw new Error('Migration 076 predecessor file is missing or mismatched.');
const sql = await readFile(new URL(`../schema/${NAME}`, import.meta.url), 'utf8');
const predecessorSql = await readFile(new URL(`../schema/${predecessor.name}`, import.meta.url), 'utf8');
if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('Migration 077 checksum mismatch.');
if (createHash('sha256').update(predecessorSql).digest('hex') !== predecessor.checksum) throw new Error('Migration 076 predecessor checksum mismatch.');
if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) throw new Error('Migration 077 contains a prohibited destructive statement.');

const asRows = (value) => Array.isArray(value) ? value : [];
const requiredTables = ['schools','users','roles','user_roles','role_permissions','permissions','parent_student_links','student_profiles','students','student_enrollments','schema_migrations','schema_migration_lock'];
const ownedTables = ['sms_campaigns','sms_campaign_recipients'];
async function snapshot(adapter) {
  const tables = asRows(await adapter.query("SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('schools','users','roles','user_roles','role_permissions','permissions','parent_student_links','student_profiles','students','student_enrollments','schema_migrations','schema_migration_lock','sms_campaigns','sms_campaign_recipients') ORDER BY TABLE_NAME"));
  const present = new Set(tables.map((row) => row.tableName));
  const columns = asRows(await adapter.query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sms_campaigns','sms_campaign_recipients') ORDER BY TABLE_NAME,ORDINAL_POSITION"));
  const indexes = asRows(await adapter.query("SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sms_campaigns','sms_campaign_recipients') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX"));
  const counts = {};
  for (const table of [...requiredTables, ...ownedTables]) if (present.has(table)) counts[table] = Number(asRows(await adapter.query(`SELECT COUNT(*) AS count FROM ${table}`))[0]?.count ?? 0);
  const ledger = present.has('schema_migrations') ? asRows(await adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM schema_migrations WHERE version=?', [VERSION])) : [];
  const permission = present.has('permissions') ? asRows(await adapter.query("SELECT id,permission_key AS permissionKey FROM permissions WHERE permission_key='messages.sms.send'")) : [];
  const grants = present.has('role_permissions') ? asRows(await adapter.query("SELECT DISTINCT r.role_key AS roleKey FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.permission_key='messages.sms.send' ORDER BY r.role_key")) : [];
  return { tables: [...present].sort(), columns, indexes, counts, ledger, permission, grants };
}
function assertPrerequisites(value) {
  const missing = requiredTables.filter((table) => !value.tables.includes(table));
  if (missing.length) throw new Error(`Migration 077 preflight is blocked: missing prerequisites ${missing.join(', ')}.`);
  if (!value.ledger.some((row) => Number(row.version) === 76)) throw new Error('Migration 077 requires verified Migration 076 in schema_migrations before application.');
  const prior = value.ledger.find((row) => Number(row.version) === 76);
  if (prior.name !== predecessor.name || prior.checksum !== predecessor.checksum) throw new Error('Migration 076 ledger name/checksum does not match the verified predecessor file.');
}
function assertSmsSchema(value) {
  const required = {
    sms_campaigns: ['id','school_id','message_body','recipient_mode','selector_json','status','recipient_count','created_by','idempotency_key','provider_key','created_at','updated_at','sent_at'],
    sms_campaign_recipients: ['id','school_id','campaign_id','parent_user_id','student_id','normalized_phone','recipient_name','status','provider_message_id','last_error','created_at','updated_at','delivered_at']
  };
  for (const [table, names] of Object.entries(required)) {
    if (!value.tables.includes(table)) throw new Error(`Migration 077 verification failed: ${table} is missing.`);
    const actual = new Set(value.columns.filter((column) => column.tableName === table).map((column) => column.columnName));
    const missing = names.filter((name) => !actual.has(name));
    if (missing.length) throw new Error(`Migration 077 verification failed for ${table}: ${missing.join(', ')}.`);
  }
  for (const index of ['uq_sms_campaign_idempotency','idx_sms_campaign_history','idx_sms_campaign_status','uq_sms_campaign_phone','idx_sms_recipient_campaign_status','idx_sms_recipient_provider']) if (!value.indexes.some((row) => row.indexName === index)) throw new Error(`Migration 077 verification failed: index ${index} is missing.`);
  if (!value.permission.some((row) => row.permissionKey === 'messages.sms.send')) throw new Error('Migration 077 verification failed: dedicated SMS permission is missing.');
  for (const role of ['PROPRIETOR','SCHOOL_ADMIN','HEADTEACHER']) if (!value.grants.some((row) => row.roleKey === role)) throw new Error(`Migration 077 verification failed: ${role} did not receive messages.sms.send.`);
  for (const role of ['ASSISTANT_HEADTEACHER','TEACHER','PARENT','STUDENT']) if (value.grants.some((row) => row.roleKey === role)) throw new Error(`Migration 077 verification failed: unauthorized role ${role} received messages.sms.send.`);
}
function databaseModulePath() { return process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null); }
async function openAdapter() {
  const modulePath = databaseModulePath();
  if (!modulePath) throw new Error('A durable production database adapter module is required for migration preflight.');
  const loaded = await import(pathToFileURL(resolve(modulePath)));
  const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
  if (!adapter?.query) throw new Error('The production adapter is unavailable or does not support read-only queries.');
  return adapter;
}
if (mode === 'dry-run') {
  const adapter = await openAdapter();
  try {
    const before = await snapshot(adapter); assertPrerequisites(before);
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [76], dryRun: true });
    console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, plan, execution: 'read-only' }));
  } finally { await adapter.close?.(); }
  process.exit(0);
}
if (mode !== 'apply' || process.env.EXECUTION_TOKEN !== APPLY_TOKEN || process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') throw new Error('Migration 077 apply requires the protected token and explicit backup confirmation.');
const adapter = await openAdapter();
try {
  const before = await snapshot(adapter); assertPrerequisites(before);
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [76], verifyMigration: async ({ adapter: tx }) => assertSmsSchema(await snapshot(tx)) });
  const after = await snapshot(adapter); assertSmsSchema(after);
  for (const table of ['schools','users','roles','user_roles','parent_student_links','student_profiles','students','student_enrollments']) if (after.counts[table] !== before.counts[table]) throw new Error(`Migration 077 altered pre-existing row count in ${table}.`);
  if (!after.ledger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) throw new Error('Migration 077 ledger record was not verified.');
  console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, before, after, result }));
} finally { await adapter.close?.(); }
