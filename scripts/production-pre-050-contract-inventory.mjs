import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const REQUIRED_TABLES = [
  'schools', 'users', 'academic_years', 'terms', 'financial_audit_history',
  'students', 'student_fee_accounts', 'fee_structures', 'fee_obligations',
  'fee_invoices', 'fee_invoice_items', 'student_fee_payments', 'student_fee_receipts',
  'schema_migrations', 'schema_baselines', 'schema_migration_lock', 'budgets', 'budget_items',
  'general_income', 'general_expenses'
];
const PRE_050 = ['schools', 'users', 'academic_years', 'terms', 'financial_audit_history'];
const POST_050_EXTERNAL = ['schools', 'users', 'academic_years', 'terms'];
const FINANCE_RUNTIME = ['schools', 'users', 'students', 'student_fee_accounts', 'fee_structures', 'fee_obligations', 'fee_invoices', 'fee_invoice_items', 'student_fee_payments', 'student_fee_receipts', 'financial_audit_history'];
const CONTRACTS = {
  schools: { columns: { id: { type: null, nullable: 'NO' } }, primaryKey: ['id'] },
  users: { columns: { id: { type: null, nullable: 'NO' } }, primaryKey: ['id'] },
  academic_years: { columns: { id: { type: null, nullable: 'NO' }, school_id: { type: null, nullable: 'NO' } }, primaryKey: ['id'] },
  terms: { columns: { id: { type: null, nullable: 'NO' }, academic_year_id: { type: null, nullable: 'NO' } }, primaryKey: ['id'] },
  financial_audit_history: { columns: { id: { type: null, nullable: 'NO' }, school_id: { type: null, nullable: 'NO' }, changed_by: { type: null, nullable: 'NO' }, changed_at: { type: null, nullable: 'NO' } }, primaryKey: ['id'] }
};
const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'PRODUCTION_CONTRACT_INVENTORY_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } });
const unique = (values) => [...new Set(values)];
const tableRef = (name) => `\`${name.replaceAll('`', '')}\``;

function statusForTable(table, expectedColumns, actual) {
  if (!actual.exists) return { status: 'MISSING', compatible: false, blocking: true, reason: `Required table ${table} is absent.` };
  const missing = expectedColumns.filter((column) => !actual.columns.some((item) => item.COLUMN_NAME === column));
  if (missing.length) return { status: 'INCOMPATIBLE', compatible: false, blocking: true, reason: `Missing required columns: ${missing.join(', ')}.` };
  return { status: 'PRESENT_COMPATIBLE', compatible: true, blocking: false, reason: 'Required table and columns are present; exact type compatibility is reported separately.' };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
    process.exitCode = 1;
    return;
  }
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    if (databaseRow?.database_name !== EXPECTED_DATABASE) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const [tableRows] = await pool.query('SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    const [columnRows] = await pool.query('SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION', [REQUIRED_TABLES]);
    const [indexRows] = await pool.query('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', [REQUIRED_TABLES]);
    const [constraintRows] = await pool.query('SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, CONSTRAINT_NAME', [REQUIRED_TABLES]);
    const [foreignKeyRows] = await pool.query('SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION', [REQUIRED_TABLES]);
    const presentTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    const actualByTable = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, { exists: presentTables.has(table), columns: columnRows.filter((row) => row.TABLE_NAME === table), indexes: indexRows.filter((row) => row.TABLE_NAME === table), constraints: constraintRows.filter((row) => row.TABLE_NAME === table), foreignKeys: foreignKeyRows.filter((row) => row.TABLE_NAME === table), definition: tableRows.find((row) => row.TABLE_NAME === table) ?? null }]));
    const [[migrationCount]] = presentTables.has('schema_migrations') ? await pool.query('SELECT COUNT(*) AS row_count FROM schema_migrations') : [[{ row_count: null }]];
    const [migrationRows] = presentTables.has('schema_migrations') ? await pool.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC') : [[]];
    const [baselineRows] = presentTables.has('schema_baselines') ? await pool.query('SELECT id, canonical_database, baseline_at, repository_commit, schema_fingerprint, reconciliation_migration, workflow_provenance, baseline_type, historical_migrations_executed, created_at FROM schema_baselines ORDER BY baseline_at DESC') : [[]];
    const [lockRows] = presentTables.has('schema_migration_lock') ? await pool.query('SELECT lock_id, locked, acquired_at FROM schema_migration_lock ORDER BY lock_id ASC') : [[]];
    const migrations = await discoverMigrations(resolve(new URL('../schema/', import.meta.url).pathname));
    const baseline = baselineRows[0] ?? null;
    const baselineMigration = baseline ? migrations.find((item) => item.name === baseline.reconciliation_migration) : null;
    const appliedVersions = new Set(migrationRows.map((row) => Number(row.version)));
    const pending = migrations.filter((item) => !appliedVersions.has(item.version) && (!baselineMigration || item.version >= baselineMigration.version)).map((item) => ({ version: item.version, name: item.name, checksum: item.checksum }));
    const historicalUntracked = baselineMigration ? migrations.filter((item) => item.version < baselineMigration.version && !appliedVersions.has(item.version)).map((item) => ({ version: item.version, name: item.name, checksum: item.checksum })) : [];
    const expectedColumns = Object.fromEntries(Object.entries(CONTRACTS).map(([table, contract]) => [table, Object.keys(contract.columns)]));
    const contractRows = Object.entries(CONTRACTS).flatMap(([table, contract]) => Object.entries(contract.columns).map(([column, expected]) => {
      const actual = actualByTable[table].columns.find((item) => item.COLUMN_NAME === column) ?? null;
      const typeCompatible = !actual || !expected.type || actual.COLUMN_TYPE.toLowerCase() === expected.type.toLowerCase();
      const nullableCompatible = !actual || actual.IS_NULLABLE === expected.nullable;
      return { requirement: `${table}.${column}`, expected: { type: expected.type ?? 'application-compatible key type', nullable: expected.nullable }, actual: actual ? { type: actual.COLUMN_TYPE, nullable: actual.IS_NULLABLE, default: actual.COLUMN_DEFAULT, key: actual.COLUMN_KEY } : null, status: actual && typeCompatible && nullableCompatible ? 'PRESENT_COMPATIBLE' : actual ? 'PRESENT_INCOMPATIBLE' : 'MISSING', blocking: true, evidence: actual ? 'information_schema.COLUMNS' : 'information_schema.TABLES/COLUMNS' };
    }));
    const tableContract = (tables, label) => tables.map((table) => ({ requirement: table, expected: { table: 'present', columns: expectedColumns[table] ?? 'runtime-required canonical table' }, actual: actualByTable[table], ...statusForTable(table, expectedColumns[table] ?? [], actualByTable[table]), blocking: !actualByTable[table].exists, evidence: 'information_schema.TABLES/COLUMNS/STATISTICS/KEY_COLUMN_USAGE' , group: label }));
    const ledger = { database: databaseRow.database_name, schemaMigrations: { exists: presentTables.has('schema_migrations'), rowCount: Number(migrationCount.row_count ?? 0), rows: migrationRows }, schemaBaselines: { exists: presentTables.has('schema_baselines'), rowCount: baselineRows.length, rows: baselineRows }, schemaMigrationLock: { exists: presentTables.has('schema_migration_lock'), rows: lockRows }, migration050Present: presentTables.has('budgets') && presentTables.has('budget_items'), migration051Present: presentTables.has('general_income') && presentTables.has('general_expenses'), baselineInterpretation: { selectedBaseline: baseline, runnerUses: 'first baseline returned by adapter ordering; no MAX/latest logic in runner itself', baselineMigration: baselineMigration?.name ?? null, historicalUntracked, pending } };
    const migration050External = ['schools', 'users', 'academic_years', 'terms'];
    const matrix050 = { title: 'MIGRATION 050 PRODUCTION CONTRACT MATRIX', prerequisites: [...tableContract(migration050External, 'pre-existing-migration-contract'), { requirement: 'budgets', expected: 'created by migration 050 with exact migration definition', actual: actualByTable.budgets, status: actualByTable.budgets.exists ? 'PRESENT_REQUIRES_DEFINITION_COMPARISON' : 'NOT_PRESENT_WILL_BE_CREATED', blocking: false, evidence: 'information_schema.TABLES/COLUMNS/STATISTICS' }, { requirement: 'budget_items', expected: 'created by migration 050 with exact migration definition', actual: actualByTable.budget_items, status: actualByTable.budget_items.exists ? 'PRESENT_REQUIRES_DEFINITION_COMPARISON' : 'NOT_PRESENT_WILL_BE_CREATED', blocking: false, evidence: 'information_schema.TABLES/COLUMNS/STATISTICS' }, ...contractRows.filter((row) => migration050External.some((table) => row.requirement.startsWith(`${table}.`)))], currentFinanceRuntimeDependencies: tableContract(['financial_audit_history'], 'current-finance-runtime-only'), result: migration050External.every((table) => actualByTable[table].exists) ? '050 CONTRACT SATISFIED' : '050 CONTRACT NOT SATISFIED' };
    const matrix051 = { title: 'MIGRATION 051 POST-050 CONTRACT MATRIX', prerequisites: [...tableContract(POST_050_EXTERNAL, 'existing-production'), { requirement: 'budgets and budget_items', providedBy: 'successful migration 050', expected: 'compatible IDs and school-scoped runtime links', actualProjected: 'defined by schema/050_budget_management.sql', status: 'PROJECTED_IF_050_SUCCEEDS', blocking: false, evidence: 'repository migration contract' }, ...contractRows.filter((row) => POST_050_EXTERNAL.some((table) => row.requirement.startsWith(`${table}.`)))], result: POST_050_EXTERNAL.every((table) => actualByTable[table].exists) ? '051 CONTRACT SATISFIED AFTER 050' : '051 CONTRACT NOT SATISFIED AFTER 050' };
    const repairClassification = { repairs: [], migration049RelevantGaps: [{ object: 'financial_audit_history', classification: actualByTable.financial_audit_history.exists ? 'NON-BLOCKING_HISTORICAL_DIFFERENCE' : 'BLOCKS_CURRENT_FINANCE_RUNTIME', action: 'No repair in E1.' }, { object: 'attendance and unrelated fee postconditions', classification: 'UNRELATED_OR_HISTORICAL_ONLY', action: 'No repair in E1.' }] };
    const unsafeHistoricalReplay = pending.some((item) => item.version < 50);
    const finalStatus = unsafeHistoricalReplay ? 'BLOCKED — UNSAFE HISTORICAL REPLAY RISK' : matrix050.result === '050 CONTRACT SATISFIED' && matrix051.result === '051 CONTRACT SATISFIED AFTER 050' && repairClassification.repairs.length === 0 ? 'READY FOR PART 5F-E2 — APPLY 050/051' : 'BLOCKED — CURRENT PRODUCTION CONTRACT INCOMPATIBLE';
    const result = { ok: true, mode: 'READ_ONLY_PRE_050_CONTRACT_INVENTORY', commit: process.env.GITHUB_SHA ?? null, connectedDatabase: databaseRow.database_name, tableInventory: tableRows, contracts: { migration050: matrix050, migration051: matrix051, financeRuntime: tableContract(FINANCE_RUNTIME, 'current-finance-runtime') }, definitions: actualByTable, ledger, repairClassification, productionWrites: 'NO PRODUCTION DATABASE WRITES PERFORMED', finalStatus };
    const outputDir = process.env.OUTPUT_DIR ? resolve(process.env.OUTPUT_DIR) : null;
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
    const report = `# Part 5F-E1 — Production Schema Contract Verification

**Mode:** read-only production diagnostic
**Database:** ${databaseRow.database_name}
**Inspected ref:** ${process.env.GITHUB_SHA ?? 'unspecified'}

## Safety result

**NO PRODUCTION DATABASE WRITES PERFORMED**

The diagnostic uses fixed SELECT and information_schema queries only. It does not apply migrations, mutate metadata, acquire or release the migration lock, or modify schema/data.

## Fresh ledger state

- schema_migrations: ${ledger.schemaMigrations.exists ? `${ledger.schemaMigrations.rowCount} rows` : 'missing'}
- schema_baselines: ${ledger.schemaBaselines.exists ? `${ledger.schemaBaselines.rowCount} rows` : 'missing'}
- schema_migration_lock: ${ledger.schemaMigrationLock.exists ? JSON.stringify(ledger.schemaMigrationLock.rows) : 'missing'}
- Migration 050 objects present: **${ledger.migration050Present ? 'yes' : 'no'}**
- Migration 051 objects present: **${ledger.migration051Present ? 'yes' : 'no'}**

## Baseline and pending behavior

The repository runner uses the first baseline returned by the adapter. It does not calculate a maximum baseline version or choose a latest timestamp itself. The selected baseline migration is ${ledger.baselineInterpretation.baselineMigration ?? 'none'}.

The exact pending migration list is recorded in part5fe1-ledger-state.json. Historical untracked migrations are also recorded there and are not executed by this diagnostic.

## Contract results

- **Migration 050:** ${matrix050.result}
- **Migration 051 after 050:** ${matrix051.result}

Required pre-existing contract objects and their actual definitions are recorded in the two contract matrix files and the full sanitized result artifact.

## Migration 049 relevance filter

Only current Finance dependencies are considered. Unrelated attendance, fee-type, and historical differences are not repaired by Part 5F-E1. The classification is recorded in part5fe1-repair-classification.json.

## Final status

**${finalStatus}**

No migration 050 or 051 was applied.
`;
      await Promise.all([
        writeFile(resolve(outputDir, 'PART-5FE1-PRODUCTION-CONTRACT-REPORT.md'), report),
        writeFile(resolve(outputDir, 'part5fe1-050-contract-matrix.json'), `${JSON.stringify(matrix050, null, 2)}\n`),
        writeFile(resolve(outputDir, 'part5fe1-051-contract-matrix.json'), `${JSON.stringify(matrix051, null, 2)}\n`),
        writeFile(resolve(outputDir, 'part5fe1-ledger-state.json'), `${JSON.stringify(ledger, null, 2)}\n`),
        writeFile(resolve(outputDir, 'part5fe1-repair-classification.json'), `${JSON.stringify(repairClassification, null, 2)}\n`)
      ]);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
  } finally { await pool.end(); }
}

await main();

export { CONTRACTS, FINANCE_RUNTIME, PRE_050, POST_050_EXTERNAL, REQUIRED_TABLES };

/* Read-only query allow-list: this file intentionally contains no mutation SQL. */
