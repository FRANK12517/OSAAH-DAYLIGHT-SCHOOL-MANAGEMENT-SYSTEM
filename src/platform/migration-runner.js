import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/i;
const checksum = (sql) => createHash('sha256').update(sql).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { code });
function splitStatements(sql) {
  const statements = []; let current = '', quote = null, lineComment = false, blockComment = false;
  for (let i=0;i<sql.length;i+=1) {
    const ch=sql[i], next=sql[i+1];
    if(lineComment){ current+=ch; if(ch==='\n') lineComment=false; continue; }
    if(blockComment){ current+=ch; if(ch==='*'&&next==='/'){current+=next;i+=1;blockComment=false;} continue; }
    if(quote){ current+=ch; if(ch==='\\'&&next){current+=next;i+=1;continue;} if(ch===quote){if(next===quote){current+=next;i+=1;}else quote=null;} continue; }
    if(ch==='-'&&next==='-'){current+=ch+next;i+=1;lineComment=true;continue;}
    if(ch==='/'&&next==='*'){current+=ch+next;i+=1;blockComment=true;continue;}
    if(ch==="'"||ch==='"'||ch==='`'){quote=ch;current+=ch;continue;}
    if(ch===';'){if(current.trim())statements.push(current.trim());current='';continue;}
    current+=ch;
  }
  if(quote||blockComment)throw error('MIGRATION_SQL_INVALID','Migration contains an unterminated SQL quote or comment.');
  if(current.trim())statements.push(current.trim());
  return statements;
}

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
  storage.applied ??= []; storage.baselines ??= []; storage.statements ??= []; storage.locked ??= false; storage.runs ??= [];
  return Object.freeze({
    dialect: storage.dialect ?? 'memory',
    async healthCheck() { return { healthy: true }; },
    async ensureMetadata({ create = true } = {}) { storage.metadataEnsured = true; if (!create && storage.dialect === 'tidb' && storage.runsTableCreated === false) throw error('MIGRATION_METADATA_MISSING', 'Migration run metadata table is missing.'); if (create) storage.runsTableCreated = true; return { created: Boolean(create) }; },
    async listApplied() { return structuredClone(storage.applied); },
    async listBaselines() { return structuredClone(storage.baselines); },
    async listMigrationRuns() { return structuredClone(storage.runs); },
    async startMigration(migration) { if (storage.runs.some((run) => run.version === migration.version && ['RUNNING','FAILED'].includes(run.state))) throw error('MIGRATION_RECOVERY_REQUIRED', `Migration ${migration.name} requires recovery.`); storage.runs = storage.runs.filter((run) => run.version !== migration.version); storage.runs.push({ version:migration.version,name:migration.name,checksum:migration.checksum,state:'RUNNING',startedAt:migration.startedAt }); },
    async completeMigration(record) { const run=storage.runs.find((item)=>item.version===record.version&&item.state==='RUNNING'); if(!run) throw error('MIGRATION_STATE_UPDATE_FAILED','No running migration record exists.'); Object.assign(run,{state:'COMPLETED',checksum:record.checksum,completedAt:record.completedAt}); },
    async failActiveMigration({ version,failedAt,errorCode }) { for(const run of storage.runs) if(run.state==='RUNNING' && (version==null || run.version===version)) Object.assign(run,{state:'FAILED',completedAt:failedAt,errorCode}); },
    async acquireLock() { if (storage.locked) return false; storage.locked = true; return true; },
    async releaseLock() { storage.locked = false; },
    async transaction(work) { const applied = structuredClone(storage.applied), statements = [...storage.statements]; try { return await work(this); } catch (cause) { if (storage.dialect !== 'tidb') { storage.applied = applied; storage.statements = statements; } throw cause; } },
    async execute(sql) { storage.statements.push(sql); if(storage.failAt&&storage.statements.length===storage.failAt) throw error('TEST_DDL_FAILURE','Injected DDL failure.'); },
    async executeMigrationSql(sql) { for (const statement of splitStatements(sql)) await this.execute(statement); },
    async recordApplied(record) { storage.applied.push(structuredClone(record)); },
    storage
  });
}

function validateAdapter(adapter) { for (const method of ['healthCheck', 'ensureMetadata', 'listApplied', 'acquireLock', 'releaseLock', 'transaction', 'execute', 'recordApplied']) if (typeof adapter?.[method] !== 'function') throw error('DATABASE_ADAPTER_INVALID', `Database adapter is missing ${method}().`); }

export function createMigrationRunner({ adapter, directory, clock = () => new Date().toISOString(), baselineRequired = false } = {}) {
  validateAdapter(adapter); if (!directory) throw error('MIGRATION_DIRECTORY_REQUIRED', 'Migration directory is required.');
  const isTiDB = adapter.dialect === 'tidb';
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
    for (const record of typeof adapter.listMigrationRuns === 'function' ? await adapter.listMigrationRuns() : []) {
      if (record.state === 'RUNNING' || record.state === 'FAILED') throw error('MIGRATION_RECOVERY_REQUIRED', `Migration ${record.name} is ${String(record.state).toLowerCase()}; inspect and reconcile its actual schema before retrying.`);
      if (record.state === 'COMPLETED' && applied.some((entry) => entry.version === record.version) && applied.find((entry) => entry.version === record.version)?.checksum !== record.checksum) throw error('MIGRATION_CHECKSUM_MISMATCH', `Migration ${record.name} run checksum does not match the applied ledger.`);
      if (record.state === 'COMPLETED' && !applied.some((entry) => entry.version === record.version)) throw error('MIGRATION_RECOVERY_REQUIRED', `Migration ${record.name} completed without an applied ledger entry; inspect its actual schema before retrying.`);
    }
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
  async function applyVersions({ versions, requiredAppliedVersions = [], dryRun = false, beforeApply, applyMigration, verifyMigration } = {}) {
    if (!Array.isArray(versions) || !versions.length || versions.some((version) => !Number.isInteger(version) || version < 1) || new Set(versions).size !== versions.length) throw error('MIGRATION_VERSION_SCOPE_INVALID', 'An explicit unique migration version allowlist is required.');
    const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.');
    const before = await inspect({ createMetadata: !dryRun && !baselineRequired });
    if (before.baseline && before.historicalUntracked.length && baselineRequired === false) throw error('HISTORICAL_BASELINE_REQUIRED', 'Untracked historical migrations require explicit baseline-aware execution.');
    const selected = versions.map((version) => {
      const migration = before.migrations.find((item) => item.version === version);
      if (!migration) throw error('MIGRATION_VERSION_MISSING', `Required migration ${version} is not present.`);
      return migration;
    });
    const appliedVersions = new Set(before.applied.map((item) => Number(item.version)));
    const missingPredecessors = requiredAppliedVersions.filter((version) => !Number.isInteger(version) || !appliedVersions.has(version));
    if (missingPredecessors.length) throw error('MIGRATION_PREDECESSOR_MISSING', `Required predecessor migrations are not recorded: ${missingPredecessors.join(', ')}.`);
    const ordered = [...selected].sort((a, b) => a.version - b.version);
    if (versions.some((version, index) => version !== ordered[index].version)) throw error('MIGRATION_VERSION_ORDER_INVALID', 'Migration allowlist must be in ascending execution order.');
    if (ordered.some((migration, index) => index > 0 && !appliedVersions.has(ordered[index - 1].version) && !ordered.slice(0, index).some((prior) => prior.version === ordered[index - 1].version))) throw error('MIGRATION_PREDECESSOR_MISSING', 'A selected migration predecessor is not recorded or included earlier in the explicit scope.');
    if (appliedVersions.has(ordered.at(-1).version) && ordered.some((migration) => !appliedVersions.has(migration.version))) throw error('MIGRATION_LEDGER_GAP', 'A later selected migration is recorded while an earlier selected migration is missing.');
    const pending = ordered.filter((migration) => !appliedVersions.has(migration.version));
    if (dryRun) return Object.freeze({ dryRun: true, baseline: before.baseline, pending: pending.map(({ version, name, checksum }) => ({ version, name, checksum })) });
    if (!await adapter.acquireLock()) throw error('MIGRATION_LOCKED', 'Another migration execution is already active.');
    try {
      const current = await inspect({ createMetadata: false });
      const currentApplied = new Set(current.applied.map((item) => Number(item.version)));
      const lostPredecessors = requiredAppliedVersions.filter((version) => !currentApplied.has(version));
      if (lostPredecessors.length) throw error('MIGRATION_PREDECESSOR_MISSING', `Required predecessor migrations are not recorded: ${lostPredecessors.join(', ')}.`);
      if (currentApplied.has(ordered.at(-1).version) && ordered.some((migration) => !currentApplied.has(migration.version))) throw error('MIGRATION_LEDGER_GAP', 'A later selected migration is recorded while an earlier selected migration is missing.');
      if (typeof beforeApply === 'function') await beforeApply({ adapter, applied: current.applied, pending });
      const applied = [];
      for (const migration of ordered) {
        if (currentApplied.has(migration.version)) continue;
        if (isTiDB) await adapter.startMigration({ ...migration, startedAt: clock() });
        try { await adapter.transaction(async (transaction) => {
          const executor = transaction?.executeMigrationSql ?? adapter.executeMigrationSql;
          if (isTiDB && (typeof verifyMigration !== 'function' || typeof applyMigration === 'function')) throw error('MIGRATION_VERIFIER_REQUIRED', `TiDB migration ${migration.name} requires statement-level execution and DDL postcondition verification.`);
          if (typeof applyMigration === 'function') await applyMigration({ adapter: transaction ?? adapter, migration, executeMigrationSql: typeof executor === 'function' ? executor.bind(transaction ?? adapter) : null });
          else {
            if (typeof executor !== 'function') throw error('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql().');
            if (isTiDB) {
              for (const [index, statement] of splitStatements(migration.sql).entries()) {
                await executor.call(transaction ?? adapter, statement, { migrationName: migration.name, version: migration.version, statementIndex: index + 1 });
                await verifyMigration({ adapter: transaction ?? adapter, migration, statement, statementIndex: index + 1 });
              }
            } else await executor.call(transaction ?? adapter, migration.sql, { migrationName: migration.name, version: migration.version });
          }
          if (typeof verifyMigration === 'function' && !isTiDB) await verifyMigration({ adapter: transaction ?? adapter, migration });
          if (isTiDB && migration.version === 83 && typeof verifyMigration !== 'function') throw error('MIGRATION_VERIFIER_REQUIRED', 'TiDB migration 083 requires duplicate-scope preflight and DDL postcondition verification.');
          const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() };
          if (typeof transaction?.recordApplied === 'function') await transaction.recordApplied(record); else await adapter.recordApplied(record);
          applied.push(record);
        }); } catch (cause) { if (isTiDB) await adapter.failActiveMigration?.({ version:migration.version, failedAt: clock(), errorCode: cause?.code ?? 'MIGRATION_FAILED' }); if(cause.code==='MIGRATION_FAILED'||cause.code==='MIGRATION_RECOVERY_REQUIRED'||cause.code==='MIGRATION_VERIFIER_REQUIRED'||String(cause.code ?? '').startsWith('MIGRATION_'))throw cause; throw error('MIGRATION_FAILED','Migration execution failed safely; inspect migration run state before retrying.'); }
        if (isTiDB) await adapter.completeMigration({ version: migration.version, name: migration.name, checksum: migration.checksum, completedAt: clock() });
        currentApplied.add(migration.version);
      }
      return Object.freeze({ dryRun: false, baseline: current.baseline, applied });
    } catch (cause) { if (cause.code==='MIGRATION_FAILED'||cause.code==='MIGRATION_RECOVERY_REQUIRED'||cause.code==='MIGRATION_VERIFIER_REQUIRED'||String(cause.code ?? '').startsWith('MIGRATION_'))throw cause; throw error('MIGRATION_FAILED', 'Migration execution failed safely; inspect migration run state before retrying.'); }
    finally { await adapter.releaseLock(); }
  }
  async function apply({ dryRun = false, verifyMigration } = {}) {
    const health = await adapter.healthCheck(); if (!health?.healthy) throw error('DATABASE_UNAVAILABLE', 'Durable database is unavailable.');
    const before = await inspect({ createMetadata: !dryRun && !baselineRequired });
    if (before.baseline && before.historicalUntracked.length && baselineRequired === false) throw error('HISTORICAL_BASELINE_REQUIRED', 'Untracked historical migrations require explicit baseline-aware execution.');
    if (dryRun) return Object.freeze({ dryRun: true, baseline: before.baseline, historicalUntracked: before.historicalUntracked, pending: before.pending.map(({ version, name, checksum }) => ({ version, name, checksum })) });
    if (!await adapter.acquireLock()) throw error('MIGRATION_LOCKED', 'Another migration execution is already active.');
    try {
      const result = await inspect({ createMetadata: false }), applied = [];
      for (const migration of result.pending) {
        if (isTiDB) await adapter.startMigration({ ...migration, startedAt: clock() });
        try { await adapter.transaction(async (transaction) => {
          const executor = transaction?.executeMigrationSql ?? adapter.executeMigrationSql;
          if (typeof executor !== 'function') throw error('DATABASE_ADAPTER_INVALID', 'Database adapter is missing executeMigrationSql().');
          if (isTiDB) {
            for (const [index, statement] of splitStatements(migration.sql).entries()) {
              await executor.call(transaction ?? adapter, statement, { migrationName: migration.name, version: migration.version, statementIndex: index + 1 });
              if (typeof verifyMigration !== 'function') throw error('MIGRATION_VERIFIER_REQUIRED', `TiDB migration ${migration.name} has no DDL postcondition verifier.`);
              await verifyMigration({ adapter: transaction ?? adapter, migration, statement, statementIndex: index + 1 });
            }
          } else await executor.call(transaction ?? adapter, migration.sql, { migrationName: migration.name, version: migration.version });
          const record = { version: migration.version, name: migration.name, checksum: migration.checksum, appliedAt: clock() };
          if (typeof transaction?.recordApplied === 'function') await transaction.recordApplied(record); else await adapter.recordApplied(record);
          applied.push(record);
        }); } catch (cause) { if (isTiDB) await adapter.failActiveMigration?.({ version:migration.version, failedAt: clock(), errorCode: cause?.code ?? 'MIGRATION_FAILED' }); if(cause.code==='MIGRATION_FAILED'||cause.code==='MIGRATION_RECOVERY_REQUIRED'||cause.code==='MIGRATION_VERIFIER_REQUIRED')throw cause; throw error('MIGRATION_FAILED','Migration execution failed safely; inspect migration run state before retrying.'); }
        if (isTiDB) await adapter.completeMigration({ version: migration.version, name: migration.name, checksum: migration.checksum, completedAt: clock() });
      }
      return Object.freeze({ dryRun: false, baseline: result.baseline, historicalUntracked: result.historicalUntracked, applied });
    } catch (cause) { if (cause.code === 'MIGRATION_FAILED' || cause.code === 'MIGRATION_RECOVERY_REQUIRED' || cause.code === 'MIGRATION_CHECKSUM_MISMATCH' || cause.code === 'MIGRATION_VERIFIER_REQUIRED') throw cause; throw error('MIGRATION_FAILED', 'Migration execution failed safely; inspect migration run state before retrying.'); }
    finally { await adapter.releaseLock(); }
  }
  return Object.freeze({ status, validate, apply, applyVersions });
}
