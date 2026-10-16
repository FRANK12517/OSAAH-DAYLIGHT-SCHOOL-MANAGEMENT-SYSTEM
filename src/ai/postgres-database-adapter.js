import pg from 'pg';

const { Pool } = pg;
const pgError = (code, message, details) => Object.assign(new Error(message), { code, details });
const SAFE_ISOLATION = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
const TRANSIENT_TRANSACTION_ERRORS = new Set(['40001', '40P01']);

function nativeParameterPositions(sql) {
  const positions = [];
  let state = 'normal';
  for (let index = 0; index < sql.length; index += 1) {
    const ch = sql[index], next = sql[index + 1];
    if (state === 'line') { if (ch === '\n') state = 'normal'; continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { index += 1; state = 'normal'; } continue; }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const end = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === end && next === end) { index += 1; continue; }
      if (ch === end) state = 'normal';
      continue;
    }
    if (ch === '-' && next === '-') { index += 1; state = 'line'; continue; }
    if (ch === '/' && next === '*') { index += 1; state = 'block'; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '`') { state = 'backtick'; continue; }
    if (ch === '$' && /\d/.test(next ?? '')) {
      let end = index + 1;
      while (/\d/.test(sql[end] ?? '')) end += 1;
      positions.push(Number(sql.slice(index + 1, end)));
      index = end - 1;
    }
  }
  return positions;
}

function hasUnboundQuestionParameter(sql) {
  let state = 'normal';
  for (let index = 0; index < sql.length; index += 1) {
    const ch = sql[index], next = sql[index + 1];
    if (state === 'line') { if (ch === '\n') state = 'normal'; continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { index += 1; state = 'normal'; } continue; }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const end = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === end && next === end) { index += 1; continue; }
      if (ch === end) state = 'normal';
      continue;
    }
    if (ch === '-' && next === '-') { index += 1; state = 'line'; continue; }
    if (ch === '/' && next === '*') { index += 1; state = 'block'; continue; }
    if (ch === "'") { state = 'single'; continue; }
    if (ch === '"') { state = 'double'; continue; }
    if (ch === '`') { state = 'backtick'; continue; }
    if (ch === '?') {
      let following = index + 1;
      while (/\s/.test(sql[following] ?? '')) following += 1;
      if (sql[following] !== "'") return true;
    }
  }
  return false;
}

/** Translate legacy positional markers without touching quoted strings, identifiers, or comments. */
export function bindPostgresParameters(sql, params = []) {
  if (typeof sql !== 'string') throw new TypeError('SQL must be a string.');
  if (!Array.isArray(params)) throw new TypeError('SQL parameters must be an array.');
  if (params.length === 0) {
    if (hasUnboundQuestionParameter(sql)) throw pgError('DATABASE_PARAMETER_COUNT_MISMATCH', 'SQL contains a parameter marker but no values were supplied.');
    return { text: sql, values: params };
  }
  const nativePositions = nativeParameterPositions(sql);
  if (nativePositions.length) {
    const positions = nativePositions;
    if (Math.max(...positions) !== params.length || positions.some((position) => position < 1)) throw pgError('DATABASE_PARAMETER_COUNT_MISMATCH', 'SQL parameter count does not match supplied values.');
    return { text: sql, values: params };
  }
  let output = '', state = 'normal', index = 0, parameterIndex = 0;
  while (index < sql.length) {
    const ch = sql[index], next = sql[index + 1];
    if (state === 'line') { output += ch; if (ch === '\n') state = 'normal'; index += 1; continue; }
    if (state === 'block') { output += ch; if (ch === '*' && next === '/') { output += next; index += 2; state = 'normal'; } else index += 1; continue; }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      output += ch;
      if (ch === '\\' && next) { output += next; index += 2; continue; }
      const closing = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === closing) {
        if (next === closing) { output += next; index += 2; continue; }
        state = 'normal';
      }
      index += 1; continue;
    }
    if (ch === '-' && next === '-') { output += '--'; index += 2; state = 'line'; continue; }
    if (ch === '/' && next === '*') { output += '/*'; index += 2; state = 'block'; continue; }
    if (ch === "'") { output += ch; state = 'single'; index += 1; continue; }
    if (ch === '"') { output += ch; state = 'double'; index += 1; continue; }
    if (ch === '`') { output += ch; state = 'backtick'; index += 1; continue; }
    if (ch === '?') {
      if (parameterIndex >= params.length) throw pgError('DATABASE_PARAMETER_COUNT_MISMATCH', 'SQL contains more parameter markers than supplied values.');
      output += `$${++parameterIndex}`; index += 1; continue;
    }
    output += ch; index += 1;
  }
  if (state !== 'normal') throw pgError('DATABASE_SQL_UNTERMINATED_LITERAL', 'SQL contains an unterminated literal or comment.');
  if (parameterIndex !== params.length) throw pgError('DATABASE_PARAMETER_COUNT_MISMATCH', 'SQL parameter count does not match supplied values.', { expected: parameterIndex, received: params.length });
  return { text: output, values: params };
}

function normalizeRows(rows, aliases = []) {
  if (!aliases.length) return rows;
  const keyMap = new Map(aliases.map((alias) => [alias.name.toLowerCase(), alias.name]));
  return rows.map((row) => {
    const result = { ...row };
    for (const [key, value] of Object.entries(row)) {
      const exact = keyMap.get(key.toLowerCase());
      if (exact && exact !== key) { result[exact] = value; delete result[key]; }
    }
    return result;
  });
}

// Compatibility for the existing JS API: PostgreSQL folds unquoted aliases to lower case.
// Only simple AS identifiers are captured; SQL expression semantics are left untouched.
function queryAliases(sql) {
  const aliases = [];
  let state = 'normal', token = '', previous = '';
  const flush = () => {
    if (!token) return;
    if (previous.toUpperCase() === 'AS') aliases.push({ name: token });
    previous = token; token = '';
  };
  for (let index = 0; index < sql.length; index += 1) {
    const ch = sql[index], next = sql[index + 1];
    if (state === 'line') { if (ch === '\n') state = 'normal'; continue; }
    if (state === 'block') { if (ch === '*' && next === '/') { index += 1; state = 'normal'; } continue; }
    if (state === 'single' || state === 'double' || state === 'backtick') {
      const end = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === end && next === end) { index += 1; continue; }
      if (ch === end) state = 'normal';
      continue;
    }
    if (ch === '-' && next === '-') { flush(); index += 1; state = 'line'; continue; }
    if (ch === '/' && next === '*') { flush(); index += 1; state = 'block'; continue; }
    if (ch === "'") { flush(); state = 'single'; continue; }
    if (ch === '"') { flush(); state = 'double'; continue; }
    if (ch === '`') { flush(); state = 'backtick'; continue; }
    if (/[A-Za-z0-9_$]/.test(ch)) token += ch;
    else flush();
  }
  flush();
  return aliases;
}

function resultMetadata(result) {
  return {
    affectedRows: Number(result.rowCount ?? 0),
    rowCount: Number(result.rowCount ?? 0),
    command: result.command,
    rows: normalizeRows(result.rows ?? [])
  };
}

function pgTypes() {
  const defaultParser = pg.types.getTypeParser;
  return {
    getTypeParser(oid, format) {
      if (oid === 1082 || oid === 1114 || oid === 1184 || oid === 114 || oid === 3802) return (value) => value;
      return defaultParser(oid, format);
    }
  };
}

export function createDatabaseAdapter({
  environment = process.env,
  poolFactory = (options) => new Pool(options),
  retryDelay = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.min(25 * 2 ** attempt, 250)))
} = {}) {
  const connectionString = environment?.OSAAH_POSTGRES_URL;
  if (!connectionString) throw pgError('POSTGRES_URL_REQUIRED', 'OSAAH_POSTGRES_URL is required for the PostgreSQL adapter.');
  let url;
  try { url = new URL(connectionString); }
  catch { throw pgError('DATABASE_URL_INVALID', 'PostgreSQL connection URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw pgError('DATABASE_URL_INVALID', 'PostgreSQL adapter requires a postgres:// or postgresql:// URL.');
  const sslMode = environment.OSAAH_PG_SSL_MODE ?? 'verify';
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!['verify', 'disable'].includes(sslMode) || (sslMode === 'disable' && !loopbackHosts.has(url.hostname.toLowerCase()))) {
    throw pgError('DATABASE_SSL_CONFIGURATION_INVALID', 'PostgreSQL SSL may be disabled only for a loopback database URL.');
  }
  const configuredSslCa = environment.OSAAH_PG_SSL_CA;
  if (configuredSslCa !== undefined && typeof configuredSslCa !== 'string') throw pgError('DATABASE_SSL_CONFIGURATION_INVALID', 'PostgreSQL SSL CA configuration must be PEM text.');
  const sslCa = configuredSslCa?.trim();
  if (sslCa && (!sslCa.includes('-----BEGIN CERTIFICATE-----') || !sslCa.includes('-----END CERTIFICATE-----'))) {
    throw pgError('DATABASE_SSL_CONFIGURATION_INVALID', 'PostgreSQL SSL CA configuration must contain a PEM certificate.');
  }
  if (sslCa && sslMode === 'disable') throw pgError('DATABASE_SSL_CONFIGURATION_INVALID', 'A PostgreSQL SSL CA cannot be configured when SSL is disabled.');
  // node-postgres lets SSL query parameters in connectionString replace the
  // explicit `ssl` option. Strip them so the adapter's verified TLS policy,
  // including an optional server-managed CA, is always the effective config.
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) url.searchParams.delete(key);
  url.hash = '';
  const safeConnectionString = url.toString();
  const pool = poolFactory({
    connectionString: safeConnectionString,
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) },
    max: Number(environment.OSAAH_PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(environment.OSAAH_PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(environment.OSAAH_PG_CONNECT_TIMEOUT_MS || 15000),
    application_name: environment.OSAAH_PG_APPLICATION_NAME || 'osaah-daylight',
    types: pgTypes()
  });

  async function run(client, sql, params = []) {
    const { text, values } = bindPostgresParameters(sql, params);
    const result = await client.query(text, values);
    const aliases = queryAliases(sql);
    return { result, rows: normalizeRows(result.rows ?? [], aliases) };
  }
  function scopedClient(client) {
    return {
      async query(sql, params = []) { return (await run(client, sql, params)).rows; },
      async execute(sql, params = []) {
        const { result, rows } = await run(client, sql, params);
        const returnedId = rows[0]?.id ?? rows[0]?.insertId ?? null;
        return { insertId: returnedId, affectedRows: Number(result.rowCount ?? 0), rowCount: Number(result.rowCount ?? 0), command: result.command, rows };
      },
      async executeMigrationSql(sql, context = {}) {
        if (typeof sql !== 'string' || !sql.trim()) throw pgError('MIGRATION_SQL_EMPTY', 'Migration SQL is empty.');
        try { await client.query(sql); }
        catch (cause) {
          throw pgError('MIGRATION_STATEMENT_FAILED', 'Migration statement failed.', {
            migration: context.migrationName ?? null,
            version: context.version ?? null,
            databaseCode: cause?.code ?? null,
            databaseMessage: String(cause?.message ?? 'Database rejected migration statement.')
              .replace(/(password|passwd|secret|token|key)=([^\s&]+)/gi, '$1=[redacted]')
          });
        }
      }
    };
  }
  const rootClient = scopedClient(pool);
  const tableNames = ['schema_migrations', 'schema_migration_lock', 'schema_baselines'];
  const adapter = {
    supportsDurableAuthSessions: true,
    query: rootClient.query,
    execute: rootClient.execute,
    executeMigrationSql: rootClient.executeMigrationSql,
    async transaction(callback, { isolationLevel = 'READ COMMITTED', retries = 0 } = {}) {
      const isolation = String(isolationLevel).toUpperCase();
      if (!SAFE_ISOLATION.has(isolation)) throw pgError('DATABASE_ISOLATION_INVALID', 'Unsupported PostgreSQL isolation level.');
      if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw pgError('DATABASE_RETRY_COUNT_INVALID', 'Transaction retries must be an integer from 0 to 5.');
      for (let attempt = 0; ; attempt += 1) {
        const client = await pool.connect();
        let released = false;
        try {
          await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          const tx = scopedClient(client);
          tx.recordApplied = async (record) => tx.execute('INSERT INTO schema_migrations (version,name,checksum,applied_at) VALUES (?,?,?,?)', [Number(record.version), record.name, record.checksum, record.appliedAt]);
          const value = await callback(tx);
          await client.query('COMMIT');
          return value;
        } catch (cause) {
          try { await client.query('ROLLBACK'); } catch { /* Keep the original transaction failure. */ }
          if (attempt < retries && TRANSIENT_TRANSACTION_ERRORS.has(cause?.code)) { client.release(); released = true; await retryDelay(attempt); continue; }
          throw cause;
        } finally {
          if (!released) client.release();
        }
      }
    },
    async healthCheck() { try { await pool.query('SELECT 1'); return { healthy: true }; } catch (cause) { return { healthy: false, error: cause.message }; } },
    async ensureMetadata({ create = true } = {}) {
      if (create) {
        await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (version integer PRIMARY KEY,name varchar(255) NOT NULL,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_migration_lock (lock_id smallint PRIMARY KEY,locked boolean NOT NULL DEFAULT false,acquired_at timestamptz)`);
        await pool.query(`INSERT INTO public.schema_migration_lock(lock_id,locked) VALUES (1,false) ON CONFLICT(lock_id) DO NOTHING`);
        await pool.query(`CREATE TABLE IF NOT EXISTS public.schema_baselines (id varchar(64) PRIMARY KEY,canonical_database varchar(128) NOT NULL,baseline_at timestamptz NOT NULL,repository_commit char(40) NOT NULL,schema_fingerprint char(64) NOT NULL,reconciliation_migration varchar(255) NOT NULL,workflow_provenance varchar(255) NOT NULL,baseline_type varchar(32) NOT NULL DEFAULT 'HISTORICAL_BASELINE',historical_migrations_executed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL)`);
        return { created: true, tables: tableNames };
      }
      const rows = await pool.query(`SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`, [tableNames]);
      const present = new Set(rows.rows.map((row) => row.tableName));
      const missing = tableNames.filter((name) => !present.has(name));
      if (missing.length) throw pgError('MIGRATION_METADATA_MISSING', `Migration metadata is missing: ${missing.join(', ')}`);
      return { created: false, tables: tableNames };
    },
    async listApplied() { return adapter.query('SELECT version,name,checksum,applied_at AS appliedAt FROM public.schema_migrations ORDER BY version ASC'); },
    async recordApplied(record) {
      if (!record || !Number.isInteger(Number(record.version)) || !record.name || !record.checksum || !record.appliedAt) throw new Error('Invalid migration metadata.');
      return adapter.execute('INSERT INTO public.schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)', [Number(record.version), record.name, record.checksum, record.appliedAt]);
    },
    async acquireLock() { return Number((await adapter.execute('UPDATE public.schema_migration_lock SET locked=true,acquired_at=now() WHERE lock_id=1 AND locked=false')).affectedRows) === 1; },
    async releaseLock() { await adapter.execute('UPDATE public.schema_migration_lock SET locked=false,acquired_at=NULL WHERE lock_id=1'); },
    async listBaselines() { return adapter.query('SELECT id,canonical_database AS canonicalDatabase,baseline_at AS baselineAt,repository_commit AS repositoryCommit,schema_fingerprint AS schemaFingerprint,reconciliation_migration AS reconciliationMigration,workflow_provenance AS workflowProvenance,baseline_type AS baselineType,historical_migrations_executed AS historicalMigrationsExecuted,created_at AS createdAt FROM public.schema_baselines ORDER BY baseline_at DESC'); },
    async recordBaseline(record) {
      if (!record?.id || !record.canonicalDatabase || !record.baselineAt || !record.repositoryCommit || !record.schemaFingerprint || !record.reconciliationMigration || !record.workflowProvenance || !record.createdAt) throw new Error('Invalid schema baseline metadata.');
      return adapter.execute('INSERT INTO public.schema_baselines(id,canonical_database,baseline_at,repository_commit,schema_fingerprint,reconciliation_migration,workflow_provenance,baseline_type,historical_migrations_executed,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [record.id, record.canonicalDatabase, record.baselineAt, record.repositoryCommit, record.schemaFingerprint, record.reconciliationMigration, record.workflowProvenance, record.baselineType ?? 'HISTORICAL_BASELINE', Boolean(record.historicalMigrationsExecuted), record.createdAt]);
    },
    async close() { await pool.end(); }
  };
  return adapter;
}

export default createDatabaseAdapter;
