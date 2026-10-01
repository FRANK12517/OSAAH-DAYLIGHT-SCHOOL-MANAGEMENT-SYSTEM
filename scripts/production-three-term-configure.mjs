import { configureThreeTerms } from '../src/production-three-term-config.js';
import { executeWithConnectionRetry } from '../src/production-three-term-execution.js';

const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is allowed.'), { code: 'INVALID_CONFIGURATION_MODE' });
if (!process.env.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });

const { createDatabaseAdapter } = await import('../src/ai/tidb-database-adapter.js');
const safeError = (cause) => ({ ok: false, error: { code: cause?.code ?? 'THREE_TERM_CONFIGURATION_FAILED', message: cause?.code ? cause.message : 'Three-term configuration failed safely.', details: cause?.details ?? null } });

async function main() {
  return executeWithConnectionRetry({
    createAdapter: () => createDatabaseAdapter({ environment: process.env }),
    operation: async (adapter) => {
      const identity = await adapter.query('SELECT DATABASE() AS databaseName');
      return configureThreeTerms(adapter, { databaseName: identity[0]?.databaseName ?? null, dryRun: mode === 'dry-run' });
    }
  });
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch (cause) {
  process.stderr.write(`${JSON.stringify(safeError(cause))}\n`);
  process.exitCode = 1;
}
