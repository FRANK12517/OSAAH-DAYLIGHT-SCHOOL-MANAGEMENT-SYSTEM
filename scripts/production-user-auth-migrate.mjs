import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';

const VERSION = 69;
const NAME = '069_production_user_login_identifiers.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_PRODUCTION_USER_AUTH_069';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

async function readUserSchema(adapter) {
  const columns = rows(await adapter.query(
    "SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' ORDER BY ORDINAL_POSITION"
  ));
  const indexes = rows(await adapter.query(
    "SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' ORDER BY INDEX_NAME, SEQ_IN_INDEX"
  ));
  return { columns, indexes };
}

async function verifyNoUsernameCollisions(adapter, schema) {
  const present = new Set(schema.columns.map((column) => column.columnName));
  const source = present.has('username') ? "COALESCE(NULLIF(username,''),email)" : 'email';
  const duplicates = rows(await adapter.query(
    `SELECT COUNT(*) AS conflictCount FROM (SELECT school_id, LOWER(${source}) AS login_name FROM users GROUP BY school_id, LOWER(${source}) HAVING COUNT(*) > 1) AS collisions`
  ));
  const count = Number(duplicates[0]?.conflictCount ?? 0);
  if (count > 0) fail('USERNAME_COLLISION_PREFLIGHT_FAILED', 'Existing login identifiers are not unique within school scope.', { collisionGroups: count });
}

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) fail('MIGRATION_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A recent recoverable backup confirmation is required.');

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  if (!migration || migration.name !== NAME) fail('MIGRATION_069_FILE_MISSING', `Required migration ${NAME} is unavailable or mismatched.`);

  const loaded = await import(new URL('../src/ai/tidb-database-adapter.js', import.meta.url));
  const adapter = await loaded.createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });

    const schemaBefore = await readUserSchema(adapter);
    const columnsBefore = new Set(schemaBefore.columns.map((column) => column.columnName));
    const requiredBaseColumns = ['id', 'school_id', 'email', 'password_hash', 'status', 'created_at'];
    const missingBaseColumns = requiredBaseColumns.filter((column) => !columnsBefore.has(column));
    if (missingBaseColumns.length) fail('USERS_BASE_SCHEMA_UNEXPECTED', 'The users table does not match the verified migration preconditions.', { missingColumns: missingBaseColumns });
    await verifyNoUsernameCollisions(adapter, schemaBefore);

    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    if (!before.applied.some((item) => Number(item.version) === 68)) fail('MIGRATION_068_PREDECESSOR_MISSING', 'Required migration 068 is not recorded.');
    const pendingMigrationsOutsideScope = before.pending.filter((item) => Number(item.version) !== VERSION).map((item) => Number(item.version));
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [68], dryRun: true });

    if (mode === 'dry-run') return {
      ok: true, mode, database,
      migration: { version: VERSION, name: NAME, checksum: migration.checksum },
      existingUsersColumns: schemaBefore.columns.map((column) => column.columnName),
      pendingMigrationsOutsideScope,
      productionWrites: 'NONE', result: plan
    };

    const result = await runner.applyVersions({
      versions: [VERSION],
      requiredAppliedVersions: [68],
      verifyMigration: async ({ adapter: transaction }) => {
        const schemaAfter = await readUserSchema(transaction);
        const columnsAfter = new Set(schemaAfter.columns.map((column) => column.columnName));
        const missing = ['username', 'updated_at'].filter((column) => !columnsAfter.has(column));
        if (missing.length) fail('MIGRATION_069_SCHEMA_VERIFY_FAILED', 'User authentication schema is missing contracted columns.', { missingColumns: missing });
        const indexPresent = schemaAfter.indexes.some((index) => index.indexName === 'uq_users_school_username' && Number(index.nonUnique) === 0 && index.columnName === 'username');
        if (!indexPresent) fail('MIGRATION_069_INDEX_VERIFY_FAILED', 'School-scoped username uniqueness is not present.');
        await verifyNoUsernameCollisions(transaction, schemaAfter);
      }
    });
    const schemaAfter = await readUserSchema(adapter);
    return {
      ok: true, mode, database,
      migration: { version: VERSION, name: NAME, checksum: migration.checksum },
      verifiedColumns: schemaAfter.columns.filter((column) => ['username', 'updated_at'].includes(column.columnName)),
      pendingMigrationsOutsideScope,
      productionWrites: 'MIGRATION_069_ONLY', result
    };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ error: error.code ?? 'PRODUCTION_USER_AUTH_MIGRATION_FAILED', message: error.message, details: error.details ?? null })}\n`); process.exitCode = 1; }
