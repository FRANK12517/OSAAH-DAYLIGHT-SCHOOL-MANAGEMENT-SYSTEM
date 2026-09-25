import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createForwardProductionReconciliationRunner } from '../src/platform/forward-production-reconciliation.js';

const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_FORWARD_RECONCILIATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
const outputDir = resolve(process.env.OUTPUT_DIR ?? 'part5fe6-artifacts');
const directory = resolve(fileURLToPath(new URL('../schema/', import.meta.url)));
const adapter = createDatabaseAdapter({ environment: process.env });
const sanitize = (cause) => ({ ok: false, error: { code: cause?.code ?? 'FORWARD_RECONCILIATION_FAILED', message: cause?.code ? cause.message : 'Forward production reconciliation failed safely.', details: cause?.details ?? null } });
try {
  const runner = await createForwardProductionReconciliationRunner({ adapter, directory });
  const preflight = await runner.preflight();
  const result = mode === 'dry-run' ? await runner.apply({ dryRun: true }) : await runner.apply();
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'part5fe6-forward-reconciliation-preflight.json'), `${JSON.stringify({ ok: true, mode: 'FORWARD_ONLY_053_PREFLIGHT', productionWrites: 'NONE', ...preflight }, null, 2)}\n`);
  await writeFile(resolve(outputDir, mode === 'dry-run' ? 'part5fe6-forward-reconciliation-dry-run.json' : 'part5fe6-forward-reconciliation-result.json'), `${JSON.stringify({ ok: true, mode, productionWrites: mode === 'dry-run' ? 'NONE' : '053_ONLY', ...result }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, mode, exactSequence: result.exactSequence })}\n`);
} catch (cause) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'part5fe6-forward-reconciliation-preflight.json'), `${JSON.stringify(sanitize(cause), null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(sanitize(cause))}\n`);
  process.exitCode = 1;
} finally { await adapter.close?.(); }
