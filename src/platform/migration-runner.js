import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/i;
const checksum = (sql) => createHash('sha256').update(sql).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { code });

export async function discoverMigrations(directory) {
  const directoryPath = directory instanceof URL ? fileURLToPath(directory) : directory;
  const names = (await readdir(directoryPath)).filter((name) => name.endsWith('.sql'));
  const migrations = [];
  for (const name of names) { const match = FILE_PATTERN.exec(name); if (!match) throw error('INVALID_MIGRATION_NAME', `Invalid migration filename: ${name}.`); const sql = await readFile(resolve(directoryPath, name), 'utf8'); migrations.push(Object.freeze({ version: Number(match[1]), name, description: match[2], sql, checksum: checksum(sql) })); }
  migrations.sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
  const versions = new Set(); for (const migration of migrations) { if (versions.has(migration.version)) throw error('DUPLICATE_MIGRATION_VERSION', `Duplicate migration version: ${migration.version}.`); versions.add(migration.version); }
  return Object.freeze(migrations);
}

export function createInMemoryMigrationAdapter(storage = {}) {
  storage.applied ??= []; storage.baselines ??= []; storage.statements ??= []; storage.locked ??= false;
  return Object.freeze({
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata() { storage.metadataEnsured = true; return { created: false }; },
    async listApplied() { return structuredClone(storage.applied); },
    async listBaselines() { return structuredClone(storage.baselines); },
    async acquireLock() { if (storage.locked) return false; storage.locked = true; return true; },
    async releaseLock() { storage.locked = false; },
    async transaction(work) { const applied = structuredClone(storage.applied), statements = [...storage.statements]; try { return await work(this); } catch (cause) { storage.applied = applied; storage.statements = statements; throw cause; } },
    async execute(sql) { storage.statements.push(sql); },
    async executeMigrationSql(sql) { return this.execute(sql); },
    async recordApplied(record) { storage.applied.push(structuredClone(record)); },
    storage
  });
}

function validateAdapter(adapter) { for (const method of ['healthCheck', 'ensureMetadata', 'listApplied', 'acquireLock', 'releaseLock', 'transaction', 'execute', 'recordApplied']) if (typeof adapter?.[method] !== 'function') throw error('DATABASE_ADAPTER_INVALID', `Database adapter is missing ${method}().`); }

export function createMigrationRunner({ adapter, directory, clock = () => new Date().toISOString(), baselineRequired = false } = {}) {
  validateAdapter(adapter); if (!directory) throw error('MIGRATION_DIRECTORY_REQUIRED', 'Migration directory is required.');
  async function currentBaseline() {
    if (typeof adapter.listBaselines !== 'function') { if (baselineRequired) throw error('MIGRATION_BASELINE_REQUIRED', 'A truthful current-production baseline is required before applying migrations.'); return null; }
    const baselines = await adapter.listBaselines();
    if (!baselines.length && baselineRequired) throw error('MIGRATION_BASELINE_REQUIRED', 'A truthful current-production baseline is required before applying migrations.');
    return baselines[0] ?? null;
  }
  async function inspect({ createMetadata = false } = {}) {
    const migrations = await discoverMigrations(directory); await adapter.ensureMetadata({ create: createMetadata }); const applied = await adapter.listApplied();
    const available = new Map(migrations.map((item) => [item.version, item]));
    for (const record of applied) { const migration = available.get(record.version); if (!migration) throw error('APPLIED_MIGRATION_MISSING', `Applied migration ${record.version} is missing from the repository.`); if (record.name !== migration.name || record.checksum !== migration.checksum) throw error('MIGRATION_CHECKSUM_MISMATCH', `Applied migration ${migration.name} has changed.`); }
    const baseline = await currentBaseline();
    const baselineMigration = baseline ? migrations.find((item) => item.name === baseline.reconciliationMigration) : null;
    if (baseline && !baselineMigration) throw error('BASELINE_MIGRATION_MISSING', `Baseline reconciliation migration ${baseline.reconciliationMigration} is missing from the repository.`);
    const appliedVersions = new Set(applied.map((item) => item.version));
    const historicalUntracked = baselineMigration ? migrations.filter((item) => item.version < baselineMigration.version && !appliedVersions.has(item.version)) : [];
    const pending = migrations.filter((item) => !appliedVersions.has(item.version) && (!baselineMigration || item.version >= baselineMigration.version));
    return { migrations, applied, baseline, historicalUntracked, pending };
  }
  async function status() { const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.'); const result = await inspect({ createMetadata: false }); return Object.freeze({ baseline: result.baseline, historicalUntracked: result.historicalUntracked.map(({ version, name, checksum }) => ({ version, name, checksum })), applied: result.applied.map(({ version, name, checksum, appliedAt }) => ({ version, name, checksum, appliedAt })), pending: result.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) }); }
  async function validate() { const result = await inspect({ createMetadata: false }); return Object.freeze({ valid: true, migrationCount: result.migrations.length, appliedCount: result.applied.length, pendingCount: result.pending.length, historicalUntrackedCount: result.historicalUntracked.length, baseline: result.baseline }); }
  async function apply({ dryRun = false } = {}) {
    const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.');
    const before = await inspect({ createMetadata: !dryRun && !baselineRequired });
    if (before.baseline && before.historicalUntracked.length && baselineRequired === false) throw error('HISTORICAL_BASELINE_REQUIRED', 'Untracked historical migrations require explicit baseline-aware execution.');
    if (dryRun) return Object.freeze({ dryRun: true, baseline: before.baseline, historicalUntracked: before.historicalUntracked, pending: before.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) });
    if (!await adapter.acquireLock()) throw error('MIGRATION_LOCKED', 'Another migration execution is already active.');
    try {
      const result = await inspect({ createMetadata: false }), applied = [];
      for (const migration of result.pending) await adapter.transaction(async (transaction) => {
        const executor = transaction?.executeMigrationSql ?? adapter.executeMigrationSql;
        if (typeof executor !== 'function') throw error('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql().');
        await executor.call(transaction ?? adapter, migration.sql, { migrationName: migration.name, version: migration.version });
        const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() };
        if (typeof transaction?.recordApplied === 'function') await transaction.recordApplied(record); else await adapter.recordApplied(record);
        applied.push(record);
      });
      return Object.freeze({ dryRun: false, baseline: result.baseline, historicalUntracked: result.historicalUntracked, applied });
    } catch (cause) { if (cause.code) throw cause; throw error('MIGRATION_FAILED', 'Migration execution failed safely.'); }
    finally { await adapter.releaseLock(); }
  }
  return Object.freeze({ status, validate, apply });
}
