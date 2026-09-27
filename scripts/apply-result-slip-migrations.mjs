import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createMigrationRunner } from '../src/platform/migration-runner.js';
import { assertExpectedDatabase, EXPECTED_PRODUCTION_DATABASE, validateReleaseInputs, verifyResultSlipSchema } from '../src/platform/result-slip-migration-preflight.js';

const directory = fileURLToPath(new URL('../schema', import.meta.url));
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'RESULT_SLIP_MIGRATION_FAILED', message: cause?.message ?? 'Result Slip migration failed safely.' } });

export async function applyResultSlipMigrations({ environment = process.env, adapterFactory = createDatabaseAdapter, runnerFactory = createMigrationRunner, output = process.stdout } = {}) {
  validateReleaseInputs({ confirmation: environment.CONFIRMATION, releaseRef: environment.RELEASE_REF, databaseUrl: environment.DATABASE_URL });
  let adapter;
  try {
    adapter = await adapterFactory({ environment });
    const [databaseRow] = await adapter.query('SELECT DATABASE() AS databaseName');
    assertExpectedDatabase(databaseRow?.databaseName);

    const runner = runnerFactory({ adapter, directory, baselineRequired: true });
    const before = await runner.status();
    if (!before.baseline || before.baseline.canonicalDatabase !== EXPECTED_PRODUCTION_DATABASE) throw Object.assign(new Error('A matching production migration baseline is required.'), { code: 'MIGRATION_BASELINE_REQUIRED' });
    const recorded = new Set(before.applied.map((item) => Number(item.version)));
    const expectedNames = new Map([[55, '055_canonical_academic_scores.sql'], [56, '056_canonical_ges_assessments.sql']]);
    const knownMigrations = new Map([...before.applied, ...before.pending].map((item) => [Number(item.version), item.name]));
    for (const [version, name] of expectedNames) if (knownMigrations.get(version) !== name) throw Object.assign(new Error(`Migration ${version} filename does not match the certified Result Slip migration.`), { code: 'MIGRATION_SCOPE_VIOLATION' });
    if (!recorded.has(54)) throw Object.assign(new Error('Required predecessor migration 054 is not recorded.'), { code: 'MIGRATION_PREDECESSOR_MISSING' });
    const earlierPending = before.pending.filter((item) => Number(item.version) < 55);
    if (earlierPending.length) throw Object.assign(new Error(`Earlier migrations must be resolved first: ${earlierPending.map((item) => item.version).join(', ')}.`), { code: 'MIGRATION_PREDECESSOR_MISSING' });
    if (recorded.has(56) && !recorded.has(55)) throw Object.assign(new Error('Migration ledger records 056 without its required predecessor 055.'), { code: 'MIGRATION_LEDGER_GAP' });
    const mayNotExist = [];
    if (!recorded.has(55)) mayNotExist.push('canonical_academic_scores');
    if (!recorded.has(56)) mayNotExist.push('canonical_ges_assessments');
    await verifyResultSlipSchema(adapter, { allowMissingTables: mayNotExist });
    const [lockRow] = await adapter.query('SELECT lock_id AS lockId,locked FROM schema_migration_lock WHERE lock_id=1');
    if (!lockRow || Number(lockRow.locked) !== 0) throw Object.assign(new Error('Migration lock is missing or already held.'), { code: 'MIGRATION_LOCKED' });

    const applied = await runner.applyVersions({ versions: [55, 56], requiredAppliedVersions: [54] });
    const schema = await verifyResultSlipSchema(adapter);
    const validation = await runner.validate();
    const after = await runner.status();
    const finalRecords = new Map(after.applied.map((item) => [Number(item.version), item]));
    for (const version of [55, 56]) if (!finalRecords.has(version)) throw Object.assign(new Error(`Migration ${version} is not recorded after execution.`), { code: 'MIGRATION_LEDGER_POSTCHECK_FAILED' });
    const unexpectedApplied = applied.applied.filter((item) => ![55, 56].includes(Number(item.version)));
    if (unexpectedApplied.length) throw Object.assign(new Error('Bounded runner reported an unexpected applied migration.'), { code: 'MIGRATION_SCOPE_VIOLATION' });
    const result = {
      ok: true,
      database: databaseRow.databaseName,
      releaseRef: environment.RELEASE_REF,
      migrations: [55, 56].map((version) => ({ version, name: finalRecords.get(version).name, checksum: finalRecords.get(version).checksum, state: 'APPLIED' })),
      newlyApplied: applied.applied.map((item) => item.version),
      pendingVersions: after.pending.map((item) => item.version),
      ledgerValidation: { valid: validation.valid, migrationCount: validation.migrationCount, appliedCount: validation.appliedCount, pendingCount: validation.pendingCount },
      schema
    };
    output.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    await adapter?.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  applyResultSlipMigrations().catch((cause) => {
    process.stderr.write(`${JSON.stringify(safeError(cause))}\n`);
    process.exitCode = 1;
  });
}
