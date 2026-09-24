import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createForwardOnlyFinanceRunner } from '../src/platform/forward-finance-migration.js';

const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_FORWARD_MIGRATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });

const outputDir = resolve(process.env.OUTPUT_DIR ?? 'part5fe2-artifacts');
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const sanitize = (cause) => ({ ok: false, error: { code: cause?.code ?? 'FORWARD_MIGRATION_FAILED', message: cause?.code ? cause.message : 'Forward-only migration failed safely.', details: cause?.details ?? null } });

try {
  const runner = await createForwardOnlyFinanceRunner({ adapter, directory });
  const preflight = await runner.preflight();
  const result = mode === 'dry-run' ? await runner.apply({ dryRun: true }) : await runner.apply();
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'part5fe2-forward-migration-preflight.json'), `${JSON.stringify({ ok: true, mode: 'FORWARD_ONLY_050_051_PREFLIGHT', productionWrites: 'NONE', ...preflight, exactSequence: result.exactSequence }, null, 2)}\n`);
  await writeFile(resolve(outputDir, mode === 'dry-run' ? 'part5fe2-forward-migration-dry-run.json' : 'part5fe2-forward-migration-result.json'), `${JSON.stringify({ ok: true, mode, productionWrites: mode === 'dry-run' ? 'NONE' : '050_AND_051_ONLY', ...result }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, mode, exactSequence: result.exactSequence })}\n`);
} catch (cause) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'part5fe2-forward-migration-preflight.json'), `${JSON.stringify(sanitize(cause), null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(sanitize(cause))}\n`);
  process.exitCode = 1;
} finally { await adapter.close?.(); }
