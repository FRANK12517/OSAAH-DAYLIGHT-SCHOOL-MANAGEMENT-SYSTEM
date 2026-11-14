const LEGACY_COLUMN_TYPES = Object.freeze({
  id: /^varchar\(191\)$/i,
  phone: /^varchar\(50\)$/i,
  attempts: /^int(?:\(\d+\))?$/i,
  first_attempt_at: /^datetime(?:\(\d+\))?$/i,
  blocked_until: /^datetime(?:\(\d+\))?$/i,
  created_at: /^datetime(?:\(\d+\))?$/i,
  updated_at: /^datetime(?:\(\d+\))?$/i
});

const BUCKET_COLUMN_TYPES = Object.freeze({
  bucket_hash: /^char\(64\)$/i,
  window_started_at: /^varchar\(64\)$/i,
  request_count: /^int(?:\(\d+\))?$/i,
  updated_at: /^varchar\(64\)$/i
});

function nameOf(row) { return String(row?.columnName ?? row?.COLUMN_NAME ?? '').toLowerCase(); }
function typeOf(row) { return String(row?.columnType ?? row?.COLUMN_TYPE ?? '').toLowerCase(); }
function indexNameOf(row) { return String(row?.indexName ?? row?.INDEX_NAME ?? '').toLowerCase(); }
function indexColumnOf(row) { return String(row?.columnName ?? row?.COLUMN_NAME ?? '').toLowerCase(); }
function indexSequenceOf(row) { return Number(row?.sequence ?? row?.SEQ_IN_INDEX ?? 0); }
function nonUniqueOf(row) { return Number(row?.nonUnique ?? row?.NON_UNIQUE ?? 1); }

function collectIndexes(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = indexNameOf(row);
    if (!name) continue;
    const entries = grouped.get(name) ?? [];
    entries.push({ column: indexColumnOf(row), sequence: indexSequenceOf(row), nonUnique: nonUniqueOf(row) });
    grouped.set(name, entries);
  }
  return [...grouped.entries()].map(([name, entries]) => ({
    name,
    columns: entries.sort((a, b) => a.sequence - b.sequence).map((entry) => entry.column),
    unique: entries.every((entry) => entry.nonUnique === 0)
  }));
}

function hasIndex(indexes, columns, { unique = null, name = null } = {}) {
  return indexes.some((index) => (!name || index.name === name.toLowerCase())
    && JSON.stringify(index.columns) === JSON.stringify(columns)
    && (unique === null || index.unique === unique));
}

function matchesColumnContract(rows, contract, exact = true) {
  const actual = new Map((Array.isArray(rows) ? rows : []).map((row) => [nameOf(row), typeOf(row)]));
  if (actual.size === 0 || (exact && actual.size !== Object.keys(contract).length)) return false;
  return Object.entries(contract).every(([name, pattern]) => pattern.test(actual.get(name) ?? ''));
}

/** Return the complete supported limiter layout, or null for incomplete/unknown schemas. */
export function classifyParentRateLimitSchema(columns, indexRows) {
  const indexes = collectIndexes(indexRows);
  if (matchesColumnContract(columns, BUCKET_COLUMN_TYPES)
    && hasIndex(indexes, ['bucket_hash'], { unique: true, name: 'primary' })
    && hasIndex(indexes, ['updated_at'], { unique: false })) return 'bucket';

  if (matchesColumnContract(columns, LEGACY_COLUMN_TYPES)
    && hasIndex(indexes, ['id'], { unique: true, name: 'primary' })
    && hasIndex(indexes, ['phone'], { unique: false })
    && hasIndex(indexes, ['blocked_until'], { unique: false })) return 'legacy';

  return null;
}

export async function inspectParentRateLimitSchema(database) {
  if (!database?.query) throw Object.assign(new Error('Rate-limit schema inspection is unavailable.'), { code: 'PARENT_RATE_LIMIT_SCHEMA_UNAVAILABLE' });
  const [columns, indexes] = await Promise.all([
    database.query('SELECT COLUMN_NAME AS columnName,COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['parent_auth_rate_limits']),
    database.query('SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', ['parent_auth_rate_limits'])
  ]);
  const schema = classifyParentRateLimitSchema(columns, indexes);
  if (!schema) throw Object.assign(new Error('Parent rate-limit schema is incomplete or unsupported.'), { code: 'PARENT_RATE_LIMIT_SCHEMA_UNSUPPORTED' });
  return schema;
}

export function parentRateLimitSchemaRequirements() {
  return {
    legacy: { columns: Object.keys(LEGACY_COLUMN_TYPES), indexes: ['PRIMARY(id)', 'phone', 'blocked_until'] },
    bucket: { columns: Object.keys(BUCKET_COLUMN_TYPES), indexes: ['PRIMARY(bucket_hash)', 'updated_at'] }
  };
}
