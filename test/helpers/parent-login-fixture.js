import { createConfiguredTestParent, TEST_PARENT_PHONE } from '../../src/test-parent-fixture.js';

const bucketColumns = [
  ['bucket_hash', 'char(64)'], ['window_started_at', 'varchar(64)'],
  ['request_count', 'int'], ['updated_at', 'varchar(64)']
].map(([columnName, columnType]) => ({ columnName, columnType }));
const legacyColumns = [
  ['id', 'varchar(191)'], ['phone', 'varchar(50)'], ['attempts', 'int'],
  ['first_attempt_at', 'datetime'], ['blocked_until', 'datetime'],
  ['created_at', 'datetime'], ['updated_at', 'datetime']
].map(([columnName, columnType]) => ({ columnName, columnType }));
const bucketIndexes = [
  { indexName: 'PRIMARY', columnName: 'bucket_hash', sequence: 1, nonUnique: 0 },
  { indexName: 'idx_parent_auth_rate_limits_updated', columnName: 'updated_at', sequence: 1, nonUnique: 1 }
];
const legacyIndexes = [
  { indexName: 'PRIMARY', columnName: 'id', sequence: 1, nonUnique: 0 },
  { indexName: 'idx_parent_rate_limit_phone', columnName: 'phone', sequence: 1, nonUnique: 1 },
  { indexName: 'idx_parent_rate_limit_blocked', columnName: 'blocked_until', sequence: 1, nonUnique: 1 }
];

function mysqlDateTimeToEpoch(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string') return NaN;
  return Date.parse(`${value.replace(' ', 'T').slice(0, 23)}Z`);
}

export function createParentLoginDatabase({
  user = createConfiguredTestParent(), rows = null, rateLimitSchema = 'bucket', legacyRateRows = [],
  incompleteRateLimitSchema = false
} = {}) {
  const persisted = { session: null };
  const buckets = new Map();
  const legacyBuckets = new Map();
  const originalLegacyRows = structuredClone(legacyRateRows);
  const bucket = { windowStartedAt: new Date(0).toISOString(), requestCount: 0 };
  const calls = [];
  let duplicateConflicts = 0;
  let transactionTail = Promise.resolve();
  const metadata = rateLimitSchema === 'legacy'
    ? { columns: legacyColumns, indexes: legacyIndexes }
    : rateLimitSchema === 'bucket'
      ? { columns: bucketColumns, indexes: bucketIndexes }
      : { columns: legacyColumns.filter(({ columnName }) => columnName !== 'blocked_until'), indexes: legacyIndexes.filter(({ columnName }) => columnName !== 'blocked_until') };
  if (incompleteRateLimitSchema) metadata.indexes = metadata.indexes.filter(({ columnName }) => columnName !== 'phone');

  async function read(sql, params = []) {
    calls.push({ sql, params });
    if (/information_schema\.COLUMNS/i.test(sql) && params.includes('parent_auth_rate_limits')) return metadata.columns;
    if (/information_schema\.STATISTICS/i.test(sql) && params.includes('parent_auth_rate_limits')) return metadata.indexes;
    if (/FROM terms t JOIN academic_years/i.test(sql)) return [{ id: 'term-1', academicYearId: 'year-1', name: 'Term 1', startsOn: '2026-01-01', endsOn: '2026-04-01', isCurrent: true }];
    if (/FROM academic_years/i.test(sql)) return [{ id: 'year-1', name: '2026/2027', startsOn: '2026-01-01', endsOn: '2026-12-31', isCurrent: true }];
    if (/FROM classes c/i.test(sql)) return [{ id: 'class-1', name: 'Basic 1', displayOrder: 1, levelName: 'Primary 1' }];
    if (/FROM users u JOIN schools school/i.test(sql)) return rows ?? (params.at(-1) === user.schoolId ? [{
      id: user.id, schoolId: user.schoolId, username: user.username, email: user.email,
      status: 'ACTIVE', parentPhone: user.phone ?? TEST_PARENT_PHONE, phoneMatchCount: 1
    }] : []);
    if (/FROM auth_sessions s JOIN users u/i.test(sql)) {
      if (!persisted.session || params[0] !== persisted.session.tokenHash) return [];
      return [{ sessionId: persisted.session.sessionId, userId: user.id, schoolId: user.schoolId,
        expiresAt: persisted.session.expiresAt, username: user.username, email: user.email,
        status: 'ACTIVE', roleKey: 'PARENT', permissionKey: null }];
    }
    return [];
  }

  async function execute(sql, params = []) {
    calls.push({ sql, params });
    if (/INSERT INTO parent_auth_rate_limits \(bucket_hash/i.test(sql)) {
      const id = params[0];
      if (buckets.has(id)) { const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      buckets.set(id, { windowStartedAt: params[2], requestCount: 0 });
    } else if (/UPDATE parent_auth_rate_limits SET window_started_at/i.test(sql)) {
      buckets.set(params[3], { windowStartedAt: params[0], requestCount: params[1] });
      Object.assign(bucket, buckets.get(params[3]));
    } else if (/INSERT INTO parent_auth_rate_limits \(id,phone/i.test(sql)) {
      const id = params[0];
      if (legacyBuckets.has(id) || legacyRateRows.some((row) => row.id === id)) {
        const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      legacyBuckets.set(id, { id, phone: params[1], attempts: 0, firstAttemptAt: params[2], blockedUntil: params[3], createdAt: params[4], updatedAt: params[5] });
    } else if (/UPDATE parent_auth_rate_limits\s+SET attempts=/i.test(sql)) {
      const state = legacyBuckets.get(params[4]);
      if (!state) throw new Error('legacy limiter row missing');
      Object.assign(state, { attempts: params[0], firstAttemptAt: params[1], blockedUntil: params[2], updatedAt: params[3] });
    } else if (/INSERT INTO auth_sessions/i.test(sql)) {
      persisted.session = { sessionId: params[0], tokenHash: params[3], expiresAt: params[5] };
    } else if (/UPDATE auth_sessions SET revoked_at=/i.test(sql)) persisted.session = null;
    return { affectedRows: 1 };
  }

  const database = {
    dialect: 'tidb', supportsDurableAuthSessions: true, calls, buckets, legacyBuckets,
    get legacyRateRows() { return legacyRateRows; },
    get originalLegacyRows() { return originalLegacyRows; },
    get duplicateConflicts() { return duplicateConflicts; },
    async query(sql, params = []) { return read(sql, params); },
    async execute(sql, params = []) { return execute(sql, params); },
    async transaction(callback) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const previous = transactionTail;
      transactionTail = previous.then(() => gate);
      await previous;
      const tx = {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (/information_schema\.COLUMNS/i.test(sql) && params.includes('parent_auth_rate_limits')) return metadata.columns;
          if (/information_schema\.STATISTICS/i.test(sql) && params.includes('parent_auth_rate_limits')) return metadata.indexes;
          if (/SELECT bucket_hash FROM parent_auth_rate_limits WHERE bucket_hash/i.test(sql)) return buckets.has(params[0]) ? [{ bucket_hash: params[0] }] : [];
          if (/SELECT window_started_at AS windowStartedAt,request_count AS requestCount FROM parent_auth_rate_limits/i.test(sql)) {
            const state = buckets.get(params[0]);
            return state ? [{ windowStartedAt: state.windowStartedAt, requestCount: state.requestCount }] : [];
          }
          if (/SELECT id FROM parent_auth_rate_limits WHERE id=/i.test(sql)) return legacyBuckets.has(params[0]) || legacyRateRows.some((row) => row.id === params[0]) ? [{ id: params[0] }] : [];
          if (/FROM parent_auth_rate_limits WHERE id=\? FOR UPDATE/i.test(sql)) {
            const state = legacyBuckets.get(params[0]) ?? legacyRateRows.find((row) => row.id === params[0]);
            return state ? [{ phone: state.phone, attempts: state.attempts, firstAttemptAt: state.firstAttemptAt, blockedUntil: state.blockedUntil }] : [];
          }
          if (/FROM parent_auth_rate_limits\s+WHERE phone IN/i.test(sql)) {
            const ids = new Set(params.slice(0, -1));
            const excludedId = params.at(-1);
            const matches = [...legacyRateRows, ...legacyBuckets.values()].filter((row) => row.id !== excludedId && ids.has(String(row.phone ?? '')));
            return matches.map((row) => ({ id: row.id, attempts: row.attempts, firstAttemptAt: row.firstAttemptAt, blockedUntil: row.blockedUntil }));
          }
          return read(sql, params);
        },
        async execute(sql, params = []) {
          if (/INSERT INTO parent_auth_rate_limits/i.test(sql)) {
            try { return await execute(sql, params); }
            catch (error) { if (error.code === 'ER_DUP_ENTRY') duplicateConflicts += 1; throw error; }
          }
          return execute(sql, params);
        }
      };
      try { return await callback(tx); }
      finally { release(); }
    }
  };
  return { database, persisted, bucket, buckets, legacyBuckets, calls, originalLegacyRows };
}

export async function createCredentialedTestParent(schoolId = 'sch_default_01') {
  const user = { ...createConfiguredTestParent(schoolId), schoolId };
  const { database, persisted } = createParentLoginDatabase({ user });
  return { user, database, persisted, phone: user.phone ?? TEST_PARENT_PHONE };
}
