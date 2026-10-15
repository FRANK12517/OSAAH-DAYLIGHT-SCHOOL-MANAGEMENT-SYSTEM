import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDatabaseAdapter } from '../src/ai/postgres-database-adapter.js';

const migrationName = '202610150001_osaah_daylight_schema.sql';
const migrationPath = resolve('supabase/migrations', migrationName);
const command = process.argv[2] ?? 'status';
const safeError = (code, message) => Object.assign(new Error(message), { code });

function localTarget(environment) {
  const raw = environment.OSAAH_POSTGRES_URL;
  if (!raw) throw safeError('POSTGRES_URL_REQUIRED', 'Set OSAAH_POSTGRES_URL to a disposable local PostgreSQL URL.');
  const target = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)) throw safeError('REMOTE_TARGET_REFUSED', 'This local migration runner refuses remote PostgreSQL hosts; use a separately reviewed hosted-Supabase procedure.');
  return target;
}

async function main(environment = process.env) {
  if (!['validate', 'status', 'apply'].includes(command)) throw safeError('INVALID_COMMAND', 'Use supabase:migration:validate, supabase:migration:status, or supabase:migration:apply.');
  if (command === 'validate') {
    const result = spawnSync(process.execPath, [resolve('scripts/validate-supabase-migration.mjs')], { encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) throw safeError('STATIC_VALIDATION_FAILED', 'Supabase migration static validation failed.');
    return { valid: true };
  }
  localTarget(environment);
  if (command === 'apply' && environment.OSAAH_ALLOW_LOCAL_SUPABASE_APPLY !== 'I_ACKNOWLEDGE_DISPOSABLE_LOCAL_DATABASE') throw safeError('APPLY_ACKNOWLEDGEMENT_REQUIRED', 'Set OSAAH_ALLOW_LOCAL_SUPABASE_APPLY to the documented acknowledgement to apply to a disposable local database.');
  const adapter = createDatabaseAdapter({ environment });
  try {
    const present = await adapter.query("SELECT to_regclass('public.osaah_supabase_migrations') AS ledger");
    const ledgerExists = Boolean(present[0]?.ledger);
    const checksum = createHash('sha256').update(await readFile(migrationPath)).digest('hex');
    const applied = ledgerExists ? await adapter.query('SELECT migration_name AS "migrationName",checksum,applied_at AS "appliedAt" FROM public.osaah_supabase_migrations WHERE migration_name=?', [migrationName]) : [];
    if (command === 'status') return { targetHost: 'local PostgreSQL', migration: migrationName, checksum, applied: applied.length > 0, appliedAt: applied[0]?.appliedAt ?? null };
    if (applied.length) {
      if (applied[0].checksum !== checksum) throw safeError('MIGRATION_CHECKSUM_MISMATCH', 'The baseline checksum differs from the recorded local migration.');
      return { applied: false, alreadyApplied: true, migration: migrationName };
    }
    const publicTables = await adapter.query("SELECT table_name AS \"tableName\" FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const unexpectedTables = publicTables.map((row) => row.tableName).filter((name) => name !== 'osaah_supabase_migrations');
    if (unexpectedTables.length) throw safeError('TARGET_NOT_EMPTY', `Refusing baseline application because public tables already exist (${unexpectedTables.length}).`);
    await adapter.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(745830421)');
      await tx.executeMigrationSql(`CREATE TABLE IF NOT EXISTS public.osaah_supabase_migrations (migration_name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
      const current = await tx.query('SELECT checksum FROM public.osaah_supabase_migrations WHERE migration_name=? FOR UPDATE', [migrationName]);
      if (current.length) {
        if (current[0].checksum !== checksum) throw safeError('MIGRATION_CHECKSUM_MISMATCH', 'The baseline checksum differs from the recorded local migration.');
        return;
      }
      const baseline = (await readFile(migrationPath, 'utf8')).replace(/^\s*begin\s*;\s*/i, '').replace(/\s*commit\s*;\s*$/i, '');
      await tx.executeMigrationSql(baseline, { migrationName });
      await tx.execute('INSERT INTO public.osaah_supabase_migrations(migration_name,checksum) VALUES (?,?)', [migrationName, checksum]);
    });
    return { applied: true, migration: migrationName, checksum };
  } finally { await adapter.close(); }
}

try { process.stdout.write(`${JSON.stringify(await main())}\n`); }
catch (cause) { process.stderr.write(`${JSON.stringify({ error: cause.code ?? 'SUPABASE_MIGRATION_FAILED', message: cause.code ? cause.message : 'Local Supabase migration command failed safely.' })}\n`); process.exitCode = 1; }
