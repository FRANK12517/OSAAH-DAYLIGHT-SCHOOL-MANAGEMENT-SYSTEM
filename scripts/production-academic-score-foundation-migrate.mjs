import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';

const VERSION = 68;
const NAME = '068_academic_score_records_foundation.sql';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const APPLY_TOKEN = 'APPLY_ACADEMIC_SCORE_FOUNDATION_068';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (mode === 'apply' && process.env.EXECUTION_TOKEN !== APPLY_TOKEN) fail('MIGRATION_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A recent recoverable backup confirmation is required.');

  const migrations = await discoverMigrations(directory);
  const migration = migrations.find((item) => item.version === VERSION);
  const lifecycle = migrations.find((item) => item.version === 67);
  if (!migration || migration.name !== NAME) fail('MIGRATION_068_FILE_MISSING', `Required migration ${NAME} is unavailable or mismatched.`);
  if (!lifecycle || lifecycle.name !== '067_academic_result_lifecycle.sql') fail('MIGRATION_067_FILE_MISSING', 'Migration 067 definition is unavailable or mismatched.');
  assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion: VERSION });

  const loaded = await import(new URL('../src/ai/tidb-database-adapter.js', import.meta.url));
  const adapter = await loaded.createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });
    const tables = new Set(rows(await adapter.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('academic_score_records','academic_result_records','canonical_academic_scores')"
    )).map((row) => row.tableName));
    if (tables.has('canonical_academic_scores')) fail('LEGACY_COMPETING_SCORE_STORE_PRESENT', 'Competing canonical_academic_scores exists; refusing the foundation release.');
    if (tables.has('academic_result_records')) fail('MIGRATION_067_ALREADY_PRESENT', 'Lifecycle table exists before the score foundation; refusing out-of-order execution.');
    if (tables.has('academic_score_records')) fail('MIGRATION_068_ALREADY_PRESENT', 'Score table exists but Migration 068 is unrecorded; refusing ambiguous adoption.');

    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    if (before.applied.some((item) => Number(item.version) === 67)) fail('MIGRATION_067_PRECEDES_068', 'Migration 067 is recorded before its required score foundation.');
    const plan = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [63, 64, 65, 66], dryRun: true });
    if (mode === 'dry-run') return {
      ok: true, mode, database,
      migration: { version: VERSION, name: NAME, checksum: migration.checksum },
      verifiedPredecessors: [63, 64, 65, 66],
      executionOrder: '066 → 068 → 067',
      productionWrites: 'NONE',
      result: plan
    };

    const result = await runner.applyVersions({
      versions: [VERSION],
      requiredAppliedVersions: [63, 64, 65, 66],
      verifyMigration: async ({ adapter: tx }) => {
        const definition = rows(await tx.query(
          "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='academic_score_records'"
        ));
        const present = new Set(definition.map((row) => row.columnName));
        const requiredColumns = ['id','school_id','record_type','mock_label','academic_year_id','term_id','class_id','student_id','subject_id','ca_score','ca_max','examination_score','examination_max','total_score','grade','remark','entered_by','updated_at','scope_key_hash'];
        const missingColumns = requiredColumns.filter((column) => !present.has(column));
        if (missingColumns.length) fail('MIGRATION_068_SCHEMA_VERIFICATION_FAILED', 'Score foundation is missing contracted columns.', { missingColumns });
        const fks = rows(await tx.query(
          "SELECT COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='academic_score_records' AND REFERENCED_TABLE_NAME IS NOT NULL"
        ));
        const requiredFks = new Map([['school_id','schools'],['student_id','student_profiles'],['class_id','classes'],['academic_year_id','academic_years'],['term_id','terms'],['subject_id','subjects'],['entered_by','users']]);
        for (const [column, table] of requiredFks) {
          if (!fks.some((fk) => fk.columnName === column && fk.referencedTable === table && fk.referencedColumn === 'id')) fail('MIGRATION_068_FOREIGN_KEY_VERIFICATION_FAILED', `Required foreign key ${column} → ${table}.id is missing.`, { column, table });
        }
        const indexes = rows(await tx.query(
          "SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='academic_score_records' ORDER BY INDEX_NAME,SEQ_IN_INDEX"
        ));
        if (!indexes.some((index) => index.indexName === 'uq_academic_score_record_scope' && Number(index.nonUnique) === 0 && index.columnName === 'scope_key_hash')) fail('MIGRATION_068_UNIQUENESS_VERIFICATION_FAILED', 'Unique academic score scope key is missing.');
        const indexNames = new Set(indexes.map((index) => index.indexName));
        for (const indexName of ['idx_academic_scores_lookup','idx_academic_scores_subject_scope','idx_academic_scores_student_subject']) {
          if (!indexNames.has(indexName)) fail('MIGRATION_068_INDEX_VERIFICATION_FAILED', `Required academic score lookup index ${indexName} is missing.`, { indexName });
        }
      }
    });
    return {
      ok: true, mode, database,
      migration: { version: VERSION, name: NAME, checksum: migration.checksum },
      verifiedPredecessors: [63, 64, 65, 66],
      executionOrder: '066 → 068 → 067',
      productionWrites: 'MIGRATION_068_ONLY',
      result
    };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ error: error.code ?? 'MIGRATION_068_FAILED', message: error.message, details: error.details ?? null })}\n`); process.exitCode = 1; }
