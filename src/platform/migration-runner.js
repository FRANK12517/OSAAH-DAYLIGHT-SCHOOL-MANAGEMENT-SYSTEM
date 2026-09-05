import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/i;
const checksum = (sql) => createHash('sha256').update(sql).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { code });

export async function discoverMigrations(directory) {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : directory; const names = (await readdir(directoryPath)).filter((name) => name.endsWith('.sql')); const migrations = [];
  for (const name of names) { const match = FILE_PATTERN.exec(name); if (!match) throw error('INVALID_MIGRATION_NAME', `Invalid migration filename: ${name}`); const sql = await readFile(resolve(directoryPath, name), 'utf8'); migrations.push(Object.freeze({ version: Number(match[1]), name, description: match[2], sql, checksum: checksum(sql) })); }
  migrations.sort((a, b) => a.version - b.version || a.name.localeCompare(b.name)); const versions = new Set(); for (const migration of migrations) { if (versions.has(migration.version)) throw error('DUPLICATE_MIGRATION_VERSION', `Duplicate migration version: ${migration.version}`); versions.add(migration.version); }
  return Object.freeze(migrations);
}

export function createInMemoryMigrationAdapter(storage = {}) {
  storage.applied ??= []; storage.statements ??= []; storage.locked ??= false;
  return Object.freeze({
    async healthCheck() { return { healthy: true }; }, async ensureMetadata() {}, async listApplied() { return structuredClone(storage.applied); },
    async acquireLock() { if (storage.locked) return false; storage.locked = true; return true; }, async releaseLock() { storage.locked = false; },
    async transaction(work) { const applied = structuredClone(storage.applied), statements = [...storage.statements]; try { return await work(); } catch (cause) { storage.applied = applied; storage.statements = statements; throw cause; } },
    async execute(sql) { storage.statements.push(sql); }, async recordApplied(record) { storage.applied.push(structuredClone(record)); }, storage
  });
}

function validateAdapter(adapter) { for (const method of ['healthCheck', 'ensureMetadata', 'listApplied', 'acquireLock', 'releaseLock', 'transaction', 'execute', 'recordApplied']) if (typeof adapter?.[method] !== 'function') throw error('DATABASE_ADAPTER_INVALID', `Database adapter is missing ${method}().`); }
export function createMigrationRunner({ adapter, directory, clock = () => new Date().toISOString() } = {}) {
  validateAdapter(adapter); if (!directory) throw error('MIGRATION_DIRECTORY_REQUIRED', 'Migration directory is required.');
  async function inspect() { const migrations = await discoverMigrations(directory); await adapter.ensureMetadata(); const applied = await adapter.listApplied(), available = new Map(migrations.map((item) => [item.version, item])); for (const record of applied) { const migration = available.get(record.version); if (!migration) throw error('APPLIED_MIGRATION_MISSING', `Applied migration ${record.version} is missing from the repository.`); if (record.name !== migration.name || record.checksum !== migration.checksum) throw error('MIGRATION_CHECKSUM_MISMATCH', `Applied migration ${migration.name} has changed.`); } const appliedVersions = new Set(applied.map((item) => item.version)); return { migrations, applied, pending: migrations.filter((item) => !appliedVersions.has(item.version)) }; }
  async function status() { const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.'); const result = await inspect(); return Object.freeze({ applied: result.applied.map(({ version, name, checksum, appliedAt }) => ({ version, name, checksum, appliedAt })), pending: result.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) }); }
  async function validate() { const result = await inspect(); return Object.freeze({ valid: true, migrationCount: result.migrations.length, appliedCount: result.applied.length, pendingCount: result.pending.length }); }
  async function apply({ dryRun = false } = {}) { const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.'); const before = await inspect(); if (dryRun) return Object.freeze({ dryRun: true, pending: before.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) }); if (!await adapter.acquireLock()) throw error('MIGRATION_LOCKED', 'Another migration execution is already active.'); try { const result = await inspect(), applied = []; for (const migration of result.pending) await adapter.transaction(async () => { await adapter.execute(migration.sql); const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() }; await adapter.recordApplied(record); applied.push(record); }); return Object.freeze({ dryRun: false, applied }); } catch (cause) { if (cause.code) throw cause; throw error('MIGRATION_FAILED', 'Migration execution failed safely.'); } finally { await adapter.releaseLock(); } }
  return Object.freeze({ status, validate, apply });
}
