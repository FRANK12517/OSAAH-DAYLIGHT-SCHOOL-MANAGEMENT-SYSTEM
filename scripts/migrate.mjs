import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';

async function main() {
  const command = process.argv[2] ?? 'status', directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
  if (!['status', 'apply', 'validate'].includes(command)) throw Object.assign(new Error('Use migration:status, migration:apply, or migration:validate.'), { code: 'INVALID_MIGRATION_COMMAND' });
  if (command === 'validate' && !process.env.OSAAH_DATABASE_ADAPTER_MODULE) { const migrations = await discoverMigrations(directory); return { valid: true, migrationCount: migrations.length }; }
  const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE;
  if (!modulePath) throw Object.assign(new Error('A durable production database adapter module is required.'), { code: 'DATABASE_ADAPTER_REQUIRED' });
  const loaded = await import(pathToFileURL(resolve(modulePath))); const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
  const runner = createMigrationRunner({ adapter, directory }); return command === 'apply' ? runner.apply() : command === 'validate' ? runner.validate() : runner.status();
}
try { process.stdout.write(`${JSON.stringify(await main())}\n`); } catch (cause) { process.stderr.write(`${JSON.stringify({ error: cause.code ?? 'MIGRATION_COMMAND_FAILED', message: cause.code ? cause.message : 'Migration command failed safely.' })}\n`); process.exitCode = 1; }
