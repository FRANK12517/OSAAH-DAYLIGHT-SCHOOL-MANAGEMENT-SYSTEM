import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { ASSIGNMENT_SCHEMA_TABLES, isAssignmentMigrationRecorded, readAssignmentMigrationLedger, readAssignmentSchemaSnapshot } from '../src/platform/assignment-migration-schema.js';

const VERSION = 62;
const NAME = '062_assignments.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXECUTION_TOKEN = 'APPLY_ASSIGNMENTS_062';
const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
if (mode === 'apply' && process.env.EXECUTION_TOKEN !== EXECUTION_TOKEN) throw Object.assign(new Error('Exact assignment migration approval token is required.'), { code: 'MIGRATION_APPROVAL_REQUIRED' });

const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'MIGRATION_062_FAILED', message: cause?.code ? cause.message : 'Assignment migration failed safely.', details: cause?.details ?? null } });

async function databaseIdentity() {
  const rows = await adapter.query('SELECT DATABASE() AS database_name');
  const database = rows[0]?.database_name ?? null;
  if (database !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH', details: { expectedDatabase: EXPECTED_DATABASE, actualDatabase: database } });
  return database;
}
async function verifySchoolIdCompatibility(migration) {
  const [databaseDefaults] = await adapter.query('SELECT DEFAULT_CHARACTER_SET_NAME AS characterSetName, DEFAULT_COLLATION_NAME AS collationName FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()');
  const [parentColumn] = await adapter.query('SELECT COLUMN_TYPE AS columnType, CHARACTER_SET_NAME AS characterSetName, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', ['schools', 'id']);
  const migrationSchoolIdLengths = [...migration.sql.matchAll(/\bschool_id\s+VARCHAR\((\d+)\)\s+NOT NULL/gi)].map((match) => Number(match[1]));
  const parentColumnType = String(parentColumn?.columnType ?? '').toLowerCase();
  const parentCharset = String(parentColumn?.characterSetName ?? '').toLowerCase();
  const parentCollation = String(parentColumn?.collationName ?? '').toLowerCase();
  const defaultCharset = String(databaseDefaults?.characterSetName ?? '').toLowerCase();
  const defaultCollation = String(databaseDefaults?.collationName ?? '').toLowerCase();
  const expectedType = migrationSchoolIdLengths.length === 2 && migrationSchoolIdLengths[0] === migrationSchoolIdLengths[1] ? `varchar(${migrationSchoolIdLengths[0]})` : null;
  const compatible = Boolean(parentColumn && expectedType && parentColumnType === expectedType && parentCharset && parentCharset === defaultCharset && parentCollation && parentCollation === defaultCollation);
  if (!compatible) throw Object.assign(new Error('Migration 062 school_id columns do not match the production schools.id foreign-key type and collation.'), { code: 'MIGRATION_062_SCHEMA_INCOMPATIBLE', details: { parentColumn: parentColumn ?? null, databaseDefaults: databaseDefaults ?? null, migrationSchoolIdLengths } });
  return { parentColumn, databaseDefaults, migrationSchoolIdLengths, compatible };
}
async function main() {
  const database = await databaseIdentity();
  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION && item.name === NAME);
  if (!migration) throw Object.assign(new Error(`Required migration ${NAME} is missing.`), { code: 'MIGRATION_062_FILE_MISSING' });
  const beforeSchema = await readAssignmentSchemaSnapshot(adapter);
  const beforeLedger = await readAssignmentMigrationLedger(adapter);
  const schoolIdCompatibility = await verifySchoolIdCompatibility(migration);
  const migrationAlreadyRecorded = isAssignmentMigrationRecorded(beforeLedger, migration);
  if (!migrationAlreadyRecorded && beforeSchema.tables.length > 0) throw Object.assign(new Error('Assignment tables exist without the matching migration 062 ledger row; refusing an ambiguous apply.'), { code: 'MIGRATION_062_PREEXISTING_OBJECTS', details: { tables: beforeSchema.tables } });
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const dryRun = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [61], dryRun: true });
  if (mode === 'dry-run') return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, beforeLedger, schoolIdCompatibility, pending: dryRun.pending, productionWrites: 'NONE' };
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [61], dryRun: false, verifyMigration: async ({ adapter: tx }) => {
    const tables = await tx.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)', [...ASSIGNMENT_SCHEMA_TABLES]);
    if (tables.length !== 2) throw Object.assign(new Error('Assignment migration did not create both required tables.'), { code: 'MIGRATION_062_SCHEMA_VERIFICATION_FAILED' });
  } });
  const afterSchema = await readAssignmentSchemaSnapshot(adapter);
  const afterLedger = await readAssignmentMigrationLedger(adapter);
  if (afterSchema.tables.length !== 2 || !afterLedger.some((row) => Number(row.version) === VERSION && row.name === NAME && row.checksum === migration.checksum)) throw Object.assign(new Error('Assignment migration postcondition failed.'), { code: 'MIGRATION_062_POSTCONDITION_FAILED' });
  return { ok: true, mode, database, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, beforeSchema, afterSchema, beforeLedger, afterLedger, applied: result.applied };
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify(safeError(cause))}\n`); process.exitCode = 1; } finally { await adapter.close?.(); }
