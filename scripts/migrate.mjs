import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';
import { assertProductionAcademicMigrationAllowed } from '../src/platform/academic-migration-guard.js';
import { PRODUCTION_DEPLOYMENT, runProductionTiDBMigrationAudit } from './production-tidb-migration-audit.mjs';

const auditFailureCodes = new Set([
  'RELEASE_COMMIT_INVALID', 'REPOSITORY_MISMATCH', 'TIDB_ADAPTER_REQUIRED', 'TIDB_CONNECTION_FAILED',
  'DATABASE_IDENTITY_MISMATCH', 'SCHOOL_IDENTITY_QUERY_FAILED', 'SCHOOL_IDENTITY_MISMATCH',
  'MIGRATION_METADATA_QUERY_FAILED', 'MIGRATION_METADATA_MISSING', 'MIGRATION_LEDGER_QUERY_FAILED',
  'MIGRATION_BASELINE_QUERY_FAILED', 'MIGRATION_RUN_QUERY_FAILED', 'MIGRATION_LOCK_QUERY_FAILED',
  'MIGRATION_082_SCHEMA_QUERY_FAILED', 'MIGRATION_RUNNER_UNAVAILABLE'
]);

async function productionAudit() {
  const sourceRoot = resolve(process.env.OSAAH_MIGRATION_SOURCE_ROOT || process.cwd());
  if (!process.env.DATABASE_URL?.trim()) throw Object.assign(new Error('Protected DATABASE_URL is unavailable.'), { code: 'DATABASE_URL_REQUIRED' });
  if (String(process.env.OSAAH_DATABASE_ADAPTER ?? '').trim().toLowerCase() !== 'tidb') throw Object.assign(new Error('Production migration audit requires explicit TiDB selection.'), { code: 'TIDB_SELECTION_REQUIRED' });
  if (String(process.env.TIDB_SSL_REJECT_UNAUTHORIZED ?? '').trim().toLowerCase() === 'false') throw Object.assign(new Error('TiDB TLS certificate verification cannot be disabled.'), { code: 'DATABASE_TLS_VERIFICATION_REQUIRED' });

  const adapterPath = resolve(sourceRoot, 'src/ai/tidb-database-adapter.js');
  if (process.env.OSAAH_DATABASE_ADAPTER_MODULE && resolve(process.env.OSAAH_DATABASE_ADAPTER_MODULE) !== adapterPath) {
    throw Object.assign(new Error('The production audit must use the checked-out TiDB adapter.'), { code: 'TIDB_ADAPTER_PATH_MISMATCH' });
  }
  let adapter;
  let discoverMigrationsForRelease;
  try {
    const loaded = await import(pathToFileURL(adapterPath));
    adapter = loaded.createDatabaseAdapter?.({ environment: process.env });
    if (!adapter) throw new Error('adapter unavailable');
  } catch {
    throw Object.assign(new Error('The checked-out TiDB adapter could not be initialized safely.'), { code: 'TIDB_ADAPTER_INITIALIZATION_FAILED' });
  }
  try {
    try {
      const runnerModule = await import(pathToFileURL(resolve(sourceRoot, 'src/platform/migration-runner.js')));
      discoverMigrationsForRelease = runnerModule.discoverMigrations;
      if (typeof discoverMigrationsForRelease !== 'function') throw new Error('migration discovery unavailable');
    } catch {
      throw Object.assign(new Error('The checked-out release migration source could not be loaded.'), { code: 'MIGRATION_RUNNER_UNAVAILABLE' });
    }
    return await runProductionTiDBMigrationAudit({
      adapter,
      directory: resolve(sourceRoot, 'schema'),
      discoverMigrations: discoverMigrationsForRelease,
      releaseRef: process.env.OSAAH_RELEASE_REF,
      checkedOutCommit: process.env.OSAAH_VERIFIED_RELEASE_COMMIT,
      repository: process.env.GITHUB_REPOSITORY,
      deploymentReference: process.env.OSAAH_DEPLOYMENT_REFERENCE || PRODUCTION_DEPLOYMENT
    });
  } finally {
    await adapter.close?.();
  }
}

async function main() {
  const command = process.argv[2] ?? 'status', directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
  if (!['status', 'apply', 'validate'].includes(command)) throw Object.assign(new Error('Use migration:status, migration:apply, or migration:validate.'), { code: 'INVALID_MIGRATION_COMMAND' });
  if (command === 'status' && process.env.OSAAH_RELEASE_REF) {
    const result = await productionAudit();
    if (result.blockingIssues.length) process.exitCode = 1;
    return result;
  }
  if (command === 'validate' && !process.env.OSAAH_DATABASE_ADAPTER_MODULE && !process.env.DATABASE_URL) { const migrations = await discoverMigrations(directory); return { valid: true, migrationCount: migrations.length }; }
  const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null);
  if (!modulePath) throw Object.assign(new Error('A durable production database adapter module is required.'), { code: 'DATABASE_ADAPTER_REQUIRED' });
  const loaded = await import(pathToFileURL(resolve(modulePath))); const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
  try {
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: Boolean(process.env.DATABASE_URL) });
    if (command === 'apply') {
      const current = await runner.status();
      for (const migration of current.pending) assertProductionAcademicMigrationAllowed(migration);
    }
    return await (command === 'apply' ? runner.apply() : command === 'validate' ? runner.validate() : runner.status());
  } finally {
    await adapter?.close?.();
  }
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) {
  const productionAuditRequested = process.argv[2] === 'status' && Boolean(process.env.OSAAH_RELEASE_REF);
  if (productionAuditRequested) {
    const code = auditFailureCodes.has(cause.code) || ['DATABASE_URL_REQUIRED', 'TIDB_SELECTION_REQUIRED', 'DATABASE_TLS_VERIFICATION_REQUIRED', 'TIDB_ADAPTER_PATH_MISMATCH', 'TIDB_ADAPTER_INITIALIZATION_FAILED'].includes(cause.code) ? cause.code : 'PRODUCTION_AUDIT_FAILED';
    const messages = {
      DATABASE_URL_REQUIRED: 'Protected DATABASE_URL is unavailable.',
      TIDB_SELECTION_REQUIRED: 'Production migration audit requires explicit TiDB selection.',
      DATABASE_TLS_VERIFICATION_REQUIRED: 'TiDB TLS certificate verification cannot be disabled.',
      TIDB_ADAPTER_PATH_MISMATCH: 'The audit adapter path does not match the checked-out release source.',
      TIDB_ADAPTER_INITIALIZATION_FAILED: 'The checked-out TiDB adapter could not be initialized safely.'
    };
    process.stderr.write(`${JSON.stringify({ error: code, message: messages[code] ?? (code === 'PRODUCTION_AUDIT_FAILED' ? 'Production migration audit failed safely.' : cause.message) })}\n`);
  } else {
    const payload = { error: cause.code ?? 'MIGRATION_COMMAND_FAILED', message: cause.code ? cause.message : 'Migration command failed safely.' };
    if (cause.details) payload.details = cause.details;
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }
  process.exitCode = 1;
}
