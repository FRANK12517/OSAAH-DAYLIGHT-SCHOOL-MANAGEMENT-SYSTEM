import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { applyDemoStudentMigration } from '../src/demo-student-migration.js';

const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run and apply are supported.'), { code: 'INVALID_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('A TiDB DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
let adapter;
try {
  adapter = await createDatabaseAdapter({ environment: process.env });
  const result = await applyDemoStudentMigration(adapter, { directory, mode });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (cause) {
  const details = cause?.details && typeof cause.details === 'object' ? cause.details : undefined;
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: cause?.code ?? 'DEMO_MIGRATION_FAILED', message: cause?.code ? cause.message : 'Migration 084 failed safely.', ...(details ? { details } : {}) } })}\n`);
  process.exitCode = 1;
} finally {
  await adapter?.close?.();
}
