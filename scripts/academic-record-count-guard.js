const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
const INTEGER_PATTERN = /^\d+$/;

function safeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return String(value);
}

function normalizeCount(value) {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value === 'string' && INTEGER_PATTERN.test(value)) return BigInt(value).toString();
  return null;
}

function normalizeSnapshot(snapshot, label) {
  const values = new Map();
  const invalid = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { values, invalid: [{ snapshot: label, reason: 'INVALID_SNAPSHOT' }] };
  }
  for (const [rawName, rawCount] of Object.entries(snapshot)) {
    const tableName = String(rawName).trim();
    if (!IDENTIFIER_PATTERN.test(tableName)) {
      invalid.push({ snapshot: label, table: tableName, reason: 'INVALID_TABLE_IDENTIFIER' });
      continue;
    }
    const key = tableName.toLowerCase();
    if (values.has(key)) {
      invalid.push({ snapshot: label, table: tableName, reason: 'DUPLICATE_NORMALIZED_TABLE_IDENTIFIER' });
      continue;
    }
    const count = normalizeCount(rawCount);
    if (count === null) {
      invalid.push({ snapshot: label, table: tableName, value: safeValue(rawCount), reason: 'INVALID_COUNT' });
      continue;
    }
    values.set(key, { table: key, count });
  }
  return { values, invalid };
}

function entriesObject(values) {
  return Object.fromEntries([...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, entry.count]));
}

/**
 * Compare protected academic counts semantically, not by object serialization.
 * The only newly appearing protected tables tolerated are explicitly named migration
 * outputs, and those must still be empty when created by the migration.
 */
export function compareAcademicRecordCounts(beforeCounts, afterCounts, { migrationCreatedTables = [] } = {}) {
  const before = normalizeSnapshot(beforeCounts, 'before');
  const after = normalizeSnapshot(afterCounts, 'after');
  const allowedNewTables = new Set(migrationCreatedTables.map((name) => String(name).trim().toLowerCase()));
  const beforeNames = new Set(before.values.keys());
  const afterNames = new Set(after.values.keys());
  const missingProtectedTables = [...beforeNames].filter((name) => !afterNames.has(name)).sort();
  const unexpectedProtectedTables = [...afterNames].filter((name) => !beforeNames.has(name) && !allowedNewTables.has(name)).sort();
  const changedCounts = [...beforeNames]
    .filter((name) => afterNames.has(name) && before.values.get(name).count !== after.values.get(name).count)
    .sort()
    .map((table) => ({ table, before: before.values.get(table).count, after: after.values.get(table).count }));
  const nonEmptyMigrationCreatedTables = [...afterNames]
    .filter((name) => !beforeNames.has(name) && allowedNewTables.has(name) && after.values.get(name).count !== '0')
    .sort()
    .map((table) => ({ table, after: after.values.get(table).count }));
  const invalidCounts = [...before.invalid, ...after.invalid];
  const differences = { missingProtectedTables, unexpectedProtectedTables, changedCounts, nonEmptyMigrationCreatedTables, invalidCounts };
  const ok = Object.values(differences).every((items) => items.length === 0);
  return { ok, before: entriesObject(before.values), after: entriesObject(after.values), differences };
}

export function assertAcademicRecordCountsPreserved(beforeCounts, afterCounts, options = {}) {
  const result = compareAcademicRecordCounts(beforeCounts, afterCounts, options);
  if (!result.ok) {
    throw Object.assign(new Error('Migration 064 changed protected academic record counts.'), {
      code: 'MIGRATION_064_ACADEMIC_RECORD_COUNT_CHANGED',
      details: { differences: result.differences, beforeAcademicCounts: result.before, afterAcademicCounts: result.after }
    });
  }
  return result;
}
