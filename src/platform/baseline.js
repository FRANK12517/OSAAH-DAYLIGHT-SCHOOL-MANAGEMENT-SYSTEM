import { createHash } from 'node:crypto';

const required = ['canonicalDatabase', 'baselineAt', 'repositoryCommit', 'schemaFingerprint', 'reconciliationMigration', 'workflowProvenance'];

export function schemaFingerprint({ tables = [], columns = [], indexes = [], foreignKeys = [] } = {}) {
  const canonical = JSON.stringify({
    tables: [...tables].sort(),
    columns: [...columns].sort(),
    indexes: [...indexes].sort(),
    foreignKeys: [...foreignKeys].sort()
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function createProductionBaseline(input = {}) {
  for (const field of required) if (!input[field]) throw new Error(`Baseline field is required: ${field}.`);
  if (!/^[a-f0-9]{40}$/i.test(input.repositoryCommit)) throw new Error('Baseline repositoryCommit must be a 40-character commit SHA.');
  if (!/^[a-f0-9]{64}$/i.test(input.schemaFingerprint)) throw new Error('Baseline schemaFingerprint must be a SHA-256 digest.');
  return Object.freeze({
    id: input.id ?? `baseline-${input.repositoryCommit.slice(0, 12)}`,
    canonicalDatabase: input.canonicalDatabase,
    baselineAt: input.baselineAt,
    repositoryCommit: input.repositoryCommit,
    schemaFingerprint: input.schemaFingerprint,
    reconciliationMigration: input.reconciliationMigration,
    workflowProvenance: input.workflowProvenance,
    createdAt: input.createdAt ?? input.baselineAt,
    baselineType: 'HISTORICAL_BASELINE',
    historicalMigrationsExecuted: false
  });
}

export function assertNotHistoricalExecution(record) {
  if (!record || record.baselineType !== 'HISTORICAL_BASELINE' || record.historicalMigrationsExecuted !== false) throw new Error('Baseline record must not assert historical migration execution.');
  return true;
}
