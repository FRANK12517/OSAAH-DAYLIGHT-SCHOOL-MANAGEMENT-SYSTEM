import { loadConfiguredDatabaseAdapter, inspectDatabaseConfiguration } from '../src/ai/durable-stores.js';
import { TIDB_READINESS_DATABASE, validateTiDBReadinessPreconditions, verifyTiDBTarget } from '../src/ai/tidb-readiness.js';

const verifyMode = process.argv.includes('--verify-tidb');
const emit = (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

async function main() {
  if (!verifyMode) {
    const result = await inspectDatabaseConfiguration({ environment: process.env });
    emit(result);
    process.exitCode = result.configurationStatus === 'CONFIGURATION_VALID' && result.conflicts.length === 0 ? 0 : 1;
    return;
  }

  const preconditionFailure = validateTiDBReadinessPreconditions({ environment: process.env });
  if (preconditionFailure) {
    emit(preconditionFailure);
    process.exitCode = 1;
    return;
  }
  const configuration = await inspectDatabaseConfiguration({ environment: process.env });
  if (configuration.configurationStatus !== 'CONFIGURATION_VALID'
    || configuration.selectedAdapter !== 'tidb'
    || configuration.selectedDatabase !== TIDB_READINESS_DATABASE
    || configuration.conflicts.length > 0) {
    emit({
      status: 'CONFIGURATION_INVALID',
      code: configuration.selectedDatabase && configuration.selectedDatabase !== TIDB_READINESS_DATABASE
        ? 'DATABASE_NAME_MISMATCH'
        : configuration.conflicts.length ? 'DATABASE_CONFIGURATION_CONFLICT' : 'TIDB_CONFIGURATION_INVALID',
      configurationStatus: configuration.configurationStatus,
      selectedAdapter: configuration.selectedAdapter,
      selectedDatabase: configuration.selectedDatabase ?? null,
      missingSettings: configuration.missingSettings,
      invalidSettings: configuration.invalidSettings,
      conflicts: configuration.conflicts,
      connectionStatus: 'NOT_ATTEMPTED'
    });
    process.exitCode = 1;
    return;
  }

  let database;
  try {
    database = await loadConfiguredDatabaseAdapter({ environment: process.env, required: true });
    const result = await verifyTiDBTarget({ database, environment: process.env });
    emit(result);
    process.exitCode = result.status === 'READY_FOR_AUTHENTICATION_TESTS' ? 0 : 1;
  } catch {
    emit({ status: 'CONNECTION_FAILED', code: 'DATABASE_ADAPTER_UNAVAILABLE', database: TIDB_READINESS_DATABASE, engine: null, serverVersion: null, isolationApproved: true, schema: { status: 'NOT_CHECKED', checks: [] } });
    process.exitCode = 1;
  } finally {
    try { await database?.close?.(); } catch { /* Cleanup errors must not expose driver details. */ }
  }
}

main().catch(() => {
  emit({ status: 'FAILED', code: 'DATABASE_READINESS_FAILED', connectionStatus: 'UNVERIFIED' });
  process.exitCode = 1;
});
