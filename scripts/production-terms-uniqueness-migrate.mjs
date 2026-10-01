import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { runTermsUniquenessMigration } from '../src/production-terms-uniqueness-migration.js';

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, '[redacted-database-url]')
    .replace(/(\b(?:password|passwd|secret|token|api[_-]?key)\b\s*[=:]\s*)[^\s&;,]+/gi, '$1[redacted]');
}

function sanitizeDetails(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDetails(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /password|passwd|secret|token|credential|connection.?string|database.?url/i.test(key)
      ? '[redacted]'
      : sanitizeDetails(item, seen)
  ]));
}

export async function runProductionTermsUniquenessCommand({
  mode = process.argv[2] ?? 'dry-run',
  environment = process.env,
  adapterFactory = createDatabaseAdapter,
  migrationRunner = runTermsUniquenessMigration,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  let adapter;
  try {
    if (!environment.DATABASE_URL) throw Object.assign(new Error('Protected DATABASE_URL is required.'), { code: 'DATABASE_URL_MISSING' });
    adapter = await adapterFactory({ environment });
    const result = await migrationRunner({ adapter, mode });
    stdout.write(`${JSON.stringify(result)}\n`);
    return { exitCode: 0, result };
  } catch (cause) {
    const payload = {
      ok: false,
      error: {
        code: cause?.code ?? 'MIGRATION_060_FAILED',
        message: cause?.code ? sanitizeText(cause.message) : 'Migration 060 failed safely.',
        details: sanitizeDetails(cause?.details ?? null)
      }
    };
    stderr.write(`${JSON.stringify(payload)}\n`);
    return { exitCode: 1, error: payload.error };
  } finally {
    await adapter?.close?.();
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const result = await runProductionTermsUniquenessCommand();
  process.exitCode = result.exitCode;
}
