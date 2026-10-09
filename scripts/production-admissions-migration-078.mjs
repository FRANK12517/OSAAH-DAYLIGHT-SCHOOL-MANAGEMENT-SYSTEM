import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const VERSION = 78;
const NAME = '078_admissions_leadership_access.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_ADMISSIONS_MIGRATION_078';
const PREDECESSORS = [77];
const migrationDirectory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];

function verifyColumns(columnRows) {
  const expected = new Map([
    ['enquiry_request_id', 'varchar(64)'],
    ['permanent_student_id', 'varchar(128)']
  ]);
  const actual = new Map(rows(columnRows).map((row) => [String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), {
    type: String(row.columnType ?? row.COLUMN_TYPE).toLowerCase(),
    nullable: String(row.isNullable ?? row.IS_NULLABLE).toUpperCase()
  }]));
  for (const [name, type] of expected) {
    const column = actual.get(name);
    if (!column || column.type !== type || column.nullable !== 'YES') throw new Error(`Migration 078 column verification failed: admission_applications.${name}.`);
  }
}

function verifyIndexes(indexRows) {
  const expected = new Map([
    ['admission_applications.uq_admission_applications_enquiry_request', ['school_id', 'enquiry_request_id']],
    ['admission_applications.uq_admission_application_student_id', ['student_id']],
    ['admission_applications.uq_admission_application_permanent_student_id', ['school_id', 'permanent_student_id']],
    ['student_enrollments.uq_student_enrollment_context', ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current']]
  ]);
  const groups = new Map();
  for (const row of rows(indexRows)) {
    const key = `${String(row.tableName ?? row.TABLE_NAME).toLowerCase()}.${String(row.indexName ?? row.INDEX_NAME)}`;
    const group = groups.get(key) ?? [];
    group.push({ column: String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), sequence: Number(row.sequence ?? row.SEQ_IN_INDEX), nonUnique: Number(row.nonUnique ?? row.NON_UNIQUE) });
    groups.set(key, group);
  }
  for (const [name, columns] of expected) {
    const actual = groups.get(name)?.sort((a, b) => a.sequence - b.sequence);
    if (!actual || actual.some((column) => column.nonUnique !== 0) || JSON.stringify(actual.map((column) => column.column)) !== JSON.stringify(columns)) throw new Error(`Migration 078 unique index verification failed: ${name}.`);
  }
}

async function verifyAdmissionsSchema(adapter) {
  const [columnRows, indexRows, permissionRows] = await Promise.all([
    adapter.query("SELECT COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admission_applications' AND COLUMN_NAME IN ('enquiry_request_id','permanent_student_id') ORDER BY COLUMN_NAME"),
    adapter.query("SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence,NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='admission_applications' AND INDEX_NAME IN ('uq_admission_applications_enquiry_request','uq_admission_application_student_id','uq_admission_application_permanent_student_id')) OR (TABLE_NAME='student_enrollments' AND INDEX_NAME='uq_student_enrollment_context')) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX"),
    adapter.query("SELECT COUNT(DISTINCT r.role_key) AS roleCount FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.permission_key='admissions.write' AND r.role_key IN ('HEADTEACHER','ASSISTANT_HEADTEACHER')")
  ]);
  verifyColumns(columnRows);
  verifyIndexes(indexRows);
  if (Number(rows(permissionRows)[0]?.roleCount ?? rows(permissionRows)[0]?.role_count ?? 0) < 2) throw new Error('Migration 078 leadership permission verification failed.');
  return { columnsVerified: true, uniqueIndexesVerified: 4, leadershipRolesGranted: 2 };
}

export async function runProductionAdmissionsMigration078({
  adapter,
  directory = migrationDirectory,
  mode = 'dry-run',
  executionToken,
  backupConfirmation,
  baselineRequired = true
} = {}) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Use dry-run or apply.');
  if (!adapter?.query || !adapter?.close) throw new Error('A closable production database adapter is required.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) throw new Error('Explicit Migration 078 apply authorization is required.');
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') throw new Error('A recent recoverable backup confirmation is required.');

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) throw new Error('Migration 078 definition is unavailable or mismatched.');
  assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: VERSION });

  const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  if (database !== EXPECTED_DATABASE) throw new Error(`Unexpected production database target: ${database ?? 'unknown'}.`);

  const runner = createMigrationRunner({ adapter, directory, baselineRequired });
  const before = await runner.status();
  if (before.baseline?.canonicalDatabase && before.baseline.canonicalDatabase !== EXPECTED_DATABASE) throw new Error('Production migration baseline targets a different database.');
  if (before.historicalUntracked.length) throw Object.assign(new Error('Historical migrations are untracked; refusing Migration 078.'), { code: 'HISTORICAL_MIGRATIONS_UNTRACKED' });
  const otherPending = before.pending.filter((item) => item.version !== VERSION);
  if (otherPending.length) throw Object.assign(new Error('Migrations other than 078 are pending; refusing an out-of-order production apply.'), { code: 'UNRELATED_MIGRATIONS_PENDING', details: { versions: otherPending.map((item) => item.version) } });
  if (!before.applied.some((item) => item.version === PREDECESSORS[0])) throw Object.assign(new Error('Required predecessor migration 077 is not recorded.'), { code: 'MIGRATION_PREDECESSOR_MISSING' });

  if (mode === 'dry-run') {
    const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: PREDECESSORS, dryRun: true });
    return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, productionWrites: 'NONE', result };
  }

  const result = await runner.applyVersions({
    versions: [VERSION],
    requiredAppliedVersions: PREDECESSORS,
    beforeApply: async ({ adapter: tx }) => {
      const currentDatabase = rows(await tx.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
      if (currentDatabase !== EXPECTED_DATABASE) throw new Error('Database target changed before Migration 078 execution.');
    },
    verifyMigration: async ({ adapter: tx }) => { await verifyAdmissionsSchema(tx); }
  });
  const verifiedSchema = await verifyAdmissionsSchema(adapter);
  const after = await runner.status();
  const appliedRecord = after.applied.find((item) => item.version === VERSION);
  if (!appliedRecord || appliedRecord.name !== NAME || appliedRecord.checksum !== migration.checksum) throw new Error('Migration 078 ledger verification failed.');
  if (after.pending.some((item) => item.version === VERSION)) throw new Error('Migration 078 remains pending after apply.');
  if (after.pending.length) throw Object.assign(new Error('Unexpected pending migrations remain after Migration 078.'), { code: 'UNRELATED_MIGRATIONS_PENDING', details: { versions: after.pending.map((item) => item.version) } });
  return {
    ok: true,
    mode,
    database,
    migration: { version: VERSION, name: NAME, checksum: migration.checksum },
    productionWrites: result.applied.length ? 'MIGRATION_078_ONLY' : 'NONE_ALREADY_APPLIED',
    applied: result.applied.length,
    verifiedSchema,
    ledger: { version: appliedRecord.version, name: appliedRecord.name, checksum: appliedRecord.checksum, appliedAt: appliedRecord.appliedAt }
  };
}

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  if (!process.env.DATABASE_URL) throw new Error('Protected DATABASE_URL is required.');
  const loaded = await import(pathToFileURL(resolve(process.cwd(), 'src/ai/tidb-database-adapter.js')));
  const adapter = await loaded.createDatabaseAdapter({ environment: process.env });
  try {
    return await runProductionAdmissionsMigration078({
      adapter,
      mode,
      executionToken: process.env.EXECUTION_TOKEN,
      backupConfirmation: process.env.BACKUP_CONFIRMATION
    });
  } finally { await adapter.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (error) {
    const details = error?.details;
    const diagnostic = details ? Object.fromEntries(['versions'].filter((key) => details[key] !== undefined).map((key) => [key, details[key]])) : null;
    process.stderr.write(`${JSON.stringify({ error: error.message, code: error.code ?? null, ...(diagnostic ? { diagnostic } : {}) })}\n`);
    process.exitCode = 1;
  }
}
