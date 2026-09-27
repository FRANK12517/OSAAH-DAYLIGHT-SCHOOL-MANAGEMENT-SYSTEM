import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner } from '../src/platform/migration-runner.js';
import { assertExpectedDatabase, verifyResultSlipSchema } from '../src/platform/result-slip-migration-preflight.js';
import {
  assertFinalProductionDatabase,
  FINAL_RESULT_SLIP_CONFIRMATION,
  FINAL_RESULT_SLIP_DATABASE,
  FINAL_RESULT_SLIP_PREDECESSORS,
  FINAL_RESULT_SLIP_VERSIONS,
  inspect049Postconditions,
  reconcile049,
  validateFinalReleaseInputs,
  verify054Postconditions,
  verifyMigrationLedger
} from '../src/platform/final-result-slip-reconciliation.js';

const directory = fileURLToPath(new URL('../schema', import.meta.url));
const safeFailure = (cause) => ({ ok: false, error: { code: cause?.code ?? 'FINAL_RESULT_SLIP_RECONCILIATION_FAILED', message: cause?.message ?? 'Final Result Slip reconciliation failed safely.', details: cause?.details } });
const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function applyFinalResultSlipReconciliation({ environment = process.env, adapterFactory = createDatabaseAdapter, runnerFactory = createMigrationRunner, output = process.stdout } = {}) {
  validateFinalReleaseInputs({ confirmation: environment.CONFIRMATION, releaseSha: environment.RELEASE_SHA, databaseUrl: environment.DATABASE_URL });
  let adapter;
  const executed049 = [];
  let created049Tables = [];
  let preservedForeignKeys = null;
  try {
    adapter = await adapterFactory({ environment });
    const [database] = await adapter.query('SELECT DATABASE() AS databaseName');
    assertFinalProductionDatabase(database?.databaseName);
    assertExpectedDatabase(database?.databaseName);
    const runner = runnerFactory({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    if (!before.baseline || before.baseline.canonicalDatabase !== FINAL_RESULT_SLIP_DATABASE) throw Object.assign(new Error('A matching production migration baseline is required.'), { code: 'MIGRATION_BASELINE_REQUIRED' });
    const allowed = new Map([[49,'049_production_schema_reconciliation.sql'],[54,'054_durable_score_entry_academic_contract.sql'],[55,'055_canonical_academic_scores.sql'],[56,'056_canonical_ges_assessments.sql']]);
    const known = new Map([...before.applied, ...before.pending].map((row) => [Number(row.version), row.name]));
    for (const [version, name] of allowed) if (known.get(version) !== name) throw Object.assign(new Error(`Migration ${version} filename does not match the final release contract.`), { code: 'MIGRATION_SCOPE_VIOLATION' });
    const recorded = new Set(before.applied.map((row) => Number(row.version)));
    if (FINAL_RESULT_SLIP_PREDECESSORS.some((version) => !recorded.has(version))) throw Object.assign(new Error('Migrations 050–053 must be recorded before final reconciliation.'), { code: 'MIGRATION_PREDECESSOR_MISSING' });
    if ([49,54,55,56].some((version) => recorded.has(version))) throw Object.assign(new Error('Migrations 049, 054, 055, and 056 must all be unrecorded before the final reconciliation starts.'), { code: 'MIGRATION_PRECONDITION_ALREADY_APPLIED' });
    if ((recorded.has(54) || recorded.has(55) || recorded.has(56)) && !recorded.has(49)) throw Object.assign(new Error('Ledger records a Result Slip successor while migration 049 is missing.'), { code: 'MIGRATION_LEDGER_GAP' });
    if (recorded.has(55) && !recorded.has(54) || recorded.has(56) && !recorded.has(55)) throw Object.assign(new Error('Ledger contains an out-of-order Result Slip migration.'), { code: 'MIGRATION_LEDGER_GAP' });
    const lock = await adapter.query('SELECT lock_id AS lockId,locked FROM schema_migration_lock WHERE lock_id=1');
    if (!lock[0] || Number(lock[0].locked) !== 0) throw Object.assign(new Error('Canonical migration lock is missing or already held.'), { code: 'MIGRATION_LOCKED' });

    const migration049 = before.pending.find((row) => Number(row.version) === 49) ?? before.applied.find((row) => Number(row.version) === 49);
    const sql049 = await (await import('node:fs/promises')).readFile(resolve(directory, '049_production_schema_reconciliation.sql'), 'utf8');
    const foreignKeySnapshot = async (db) => db.query(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,CONSTRAINT_NAME AS constraintName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${Array(17).fill('?').join(',')}) AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`, ['student_attendance','staff_attendance','staff_leave','attendance_audit_history','staff_attendance_reconciliation_audit','fee_obligations','fee_collection_records','fee_collection_corrections','student_fee_accounts','student_fee_ledger','fee_invoices','fee_invoice_items','student_fee_payments','student_fee_receipts','financial_audit_history','fee_types','fee_structures']);
    const runnerResult = await runner.applyVersions({
      versions: [...FINAL_RESULT_SLIP_VERSIONS],
      requiredAppliedVersions: [...FINAL_RESULT_SLIP_PREDECESSORS],
      beforeApply: async ({ adapter: db, applied }) => {
        const current = new Set(applied.map((row) => Number(row.version)));
        if (FINAL_RESULT_SLIP_PREDECESSORS.some((version) => !current.has(version)) || [49,54,55,56].some((version) => current.has(version))) throw Object.assign(new Error('The live migration ledger changed before lock-protected execution.'), { code: 'MIGRATION_PREFLIGHT_STATE_CHANGED' });
        const [held] = await db.query('SELECT locked FROM schema_migration_lock WHERE lock_id=1');
        if (!held || Number(held.locked) !== 1) throw Object.assign(new Error('Canonical migration lock was not held during locked preflight.'), { code: 'MIGRATION_LOCK_NOT_HELD' });
      },
      applyMigration: async ({ adapter: db, migration, executeMigrationSql }) => {
        if (migration.version === 49) {
          preservedForeignKeys = await foreignKeySnapshot(db);
          const reconciled = await reconcile049(db, executeMigrationSql, migration.sql);
          executed049.push(...reconciled.executed);
          created049Tables = reconciled.createdTables;
          return;
        }
        if (typeof executeMigrationSql !== 'function') throw Object.assign(new Error('Migration executor is unavailable.'), { code: 'DATABASE_ADAPTER_INVALID' });
        await executeMigrationSql(migration.sql, { migrationName: migration.name, version: migration.version });
      },
      verifyMigration: async ({ adapter: db, migration }) => {
        if (migration.version === 49) {
          const state = await inspect049Postconditions(db, sql049, { createdTables: created049Tables });
          if (!state.complete) throw Object.assign(new Error('Migration 049 postconditions did not pass; its ledger row was not recorded.'), { code: 'MIGRATION_049_POSTCONDITION_FAILED', details: state });
          if (preservedForeignKeys) {
            const current = await foreignKeySnapshot(db);
            if (JSON.stringify(current) !== JSON.stringify(preservedForeignKeys)) throw Object.assign(new Error('A relevant foreign-key definition changed during migration 049.'), { code: 'MIGRATION_049_FOREIGN_KEY_DRIFT' });
          }
        } else if (migration.version === 54) await verify054Postconditions(db);
        else if (migration.version === 55 || migration.version === 56) {
          await verifyResultSlipSchema(db, { allowMissingTables: migration.version === 55 ? ['canonical_ges_assessments'] : [] });
        }
      }
    });
    const final049 = await inspect049Postconditions(adapter, sql049, { createdTables: created049Tables });
    if (!final049.complete) throw Object.assign(new Error('Final migration 049 contract did not pass.'), { code: 'MIGRATION_049_POSTCONDITION_FAILED', details: final049 });
    const final054 = await verify054Postconditions(adapter);
    const schema = await verifyResultSlipSchema(adapter);
    const ledger = await verifyMigrationLedger(adapter);
    const validation = await runner.validate();
    const after = await runner.status();
    const unexpectedApplied = runnerResult.applied.filter((row) => !FINAL_RESULT_SLIP_VERSIONS.includes(Number(row.version)));
    if (unexpectedApplied.length) throw Object.assign(new Error('Unexpected migration version was applied.'), { code: 'MIGRATION_SCOPE_VIOLATION', details: unexpectedApplied.map((row) => row.version) });
    const [lockAfter] = await adapter.query('SELECT lock_id AS lockId,locked FROM schema_migration_lock WHERE lock_id=1');
    if (!lockAfter || Number(lockAfter.locked) !== 0) throw Object.assign(new Error('Migration lock was not released.'), { code: 'MIGRATION_LOCK_RELEASE_FAILED' });
    const result = {
      ok: true,
      database: database.databaseName,
      releaseSha: environment.RELEASE_SHA,
      migrations: [49,50,51,52,53,54,55,56].map((version) => ({ version, state: 'PRESENT', checksum: after.applied.find((row) => Number(row.version) === version)?.checksum ?? null })),
      reconciled049Objects: executed049,
      postconditions: { migration049: final049.complete, migration054: final054, resultSlip: schema },
      migrationLockReleased: true,
      unexpectedMigrations: [],
      ledgerValidation: { valid: validation.valid, migrationCount: validation.migrationCount, appliedCount: validation.appliedCount, pendingCount: validation.pendingCount },
      provenance: { migration049Checksum: digest(sql049), workflow: 'apply-final-result-slip-reconciliation.yml' }
    };
    output.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally { await adapter?.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  applyFinalResultSlipReconciliation().catch((cause) => { process.stderr.write(`${JSON.stringify(safeFailure(cause))}\n`); process.exitCode = 1; });
}

export { FINAL_RESULT_SLIP_CONFIRMATION };
