import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverMigrations, createMigrationRunner } from '../src/platform/migration-runner.js';
const VERSION = 75;
const NAME = '075_result_blocking_examination_scope.sql';
const APPLY_TOKEN = 'APPLY_RESULT_BLOCKING_075';
const mode = process.argv[2] ?? 'dry-run';
const directory = resolve(fileURLToPath(new URL('../schema', import.meta.url)));
const migration = (await discoverMigrations(directory)).find((item) => item.version === VERSION);
if (!migration || migration.name !== NAME) throw new Error('Migration 075 file is missing or mismatched.');
const sql = await readFile(new URL(`../schema/${NAME}`, import.meta.url), 'utf8');
if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('Migration 075 checksum mismatch.');
if (/\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\b(TRUNCATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) throw new Error('Migration 075 is destructive.');
if (mode === 'dry-run') { console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, execution: 'read-only' })); process.exit(0); }
if (mode !== 'apply' || process.env.EXECUTION_TOKEN !== APPLY_TOKEN || process.env.BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED') throw new Error('Migration 075 apply requires the protected token and backup confirmation.');
const modulePath = process.env.OSAAH_DATABASE_ADAPTER_MODULE || (process.env.DATABASE_URL ? resolve(process.cwd(), 'src/ai/tidb-database-adapter.js') : null);
if (!modulePath) throw new Error('A durable production database adapter module is required.');
const loaded = await import(pathToFileURL(resolve(modulePath)));
const adapter = await loaded.createDatabaseAdapter?.({ environment: process.env });
try {
  const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
  const result = await runner.applyVersions({ versions: [VERSION], requiredAppliedVersions: [74] });
  console.log(JSON.stringify({ ok: true, mode, migration: { version: VERSION, name: NAME, checksum: migration.checksum }, result }));
} finally { await adapter?.close?.(); }
