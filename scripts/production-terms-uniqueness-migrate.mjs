import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { runTermsUniquenessMigration } from '../src/production-terms-uniqueness-migration.js';

const mode = process.argv[2] ?? 'dry-run';
let adapter;
try {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
  adapter = createDatabaseAdapter({ environment: process.env });
  const result = await runTermsUniquenessMigration({ adapter, mode });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (cause) {
  const payload = {
    ok: false,
    error: {
      code: cause?.code ?? 'MIGRATION_060_FAILED',
      message: cause?.code ? cause.message : 'Migration 060 failed safely.',
      details: cause?.details ?? null
    }
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
} finally {
  await adapter?.close?.();
}
