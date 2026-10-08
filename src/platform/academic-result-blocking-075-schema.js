const TABLES = ['academic_result_blocks', 'academic_result_unblock_requests'];
const BASE_COLUMNS = Object.freeze({
  academic_result_blocks: [
    'id', 'school_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope', 'status',
    'reason', 'blocked_by', 'blocked_by_role', 'blocked_at', 'unblocked_by', 'unblocked_at'
  ],
  academic_result_unblock_requests: [
    'id', 'school_id', 'block_id', 'academic_year', 'term', 'class_id', 'student_id', 'scope',
    'reason', 'requested_by', 'requested_by_role', 'status', 'requested_at', 'decided_by', 'decided_at'
  ]
});
const OLD_INDEXES = Object.freeze([
  { table: 'academic_result_blocks', name: 'uq_academic_result_block_scope', unique: true, columns: ['school_id', 'academic_year', 'term', 'class_id', 'student_id'] },
  { table: 'academic_result_blocks', name: 'idx_academic_result_block_lookup', unique: false, columns: ['school_id', 'academic_year', 'term', 'class_id', 'status'] },
  { table: 'academic_result_unblock_requests', name: 'idx_academic_result_unblock_lookup', unique: false, columns: ['school_id', 'status', 'requested_at'] }
]);
const NEW_INDEXES = Object.freeze([
  { table: 'academic_result_blocks', name: 'uq_academic_result_block_examination_scope', unique: true, columns: ['school_id', 'academic_year', 'term', 'class_id', 'result_type', 'mock_examination', 'student_id'] },
  { table: 'academic_result_blocks', name: 'idx_academic_result_block_examination_lookup', unique: false, columns: ['school_id', 'academic_year', 'term', 'class_id', 'result_type', 'mock_examination', 'status'] },
  { table: 'academic_result_unblock_requests', name: 'idx_academic_result_unblock_examination_lookup', unique: false, columns: ['school_id', 'academic_year', 'term', 'class_id', 'result_type', 'mock_examination', 'status'] }
]);
const NEW_COLUMNS = Object.freeze([
  { table: 'academic_result_blocks', name: 'result_type', type: "enum('terminal','mock')", nullable: 'NO', defaultValue: 'TERMINAL', after: 'term' },
  { table: 'academic_result_blocks', name: 'mock_examination', type: 'varchar(32)', nullable: 'YES', defaultValue: null, after: 'result_type' },
  { table: 'academic_result_unblock_requests', name: 'result_type', type: "enum('terminal','mock')", nullable: 'NO', defaultValue: 'TERMINAL', after: 'term' },
  { table: 'academic_result_unblock_requests', name: 'mock_examination', type: 'varchar(32)', nullable: 'YES', defaultValue: null, after: 'result_type' }
]);
const NEW_INDEX_NAMES = new Set(NEW_INDEXES.map(({ name }) => name));
const placeholders = (values) => values.map(() => '?').join(',');

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function normalizedType(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function normalizedDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/^['"]|['"]$/g, '').toUpperCase();
}

function columnFor(snapshot, table, name) {
  return snapshot.columns.find((column) => column.tableName === table && column.columnName === name) ?? null;
}

function indexRows(snapshot, table, name) {
  return snapshot.indexes
    .filter((row) => row.tableName === table && row.indexName === name)
    .sort((left, right) => Number(left.seqInIndex) - Number(right.seqInIndex));
}

function indexMatches(snapshot, expected) {
  const rows = indexRows(snapshot, expected.table, expected.name);
  return rows.length === expected.columns.length
    && (Number(rows[0]?.nonUnique) === 0) === expected.unique
    && rows.every((row, index) => row.columnName === expected.columns[index]
      && (Number(row.nonUnique) === 0) === expected.unique
      && Number(row.seqInIndex) === index + 1);
}

function validateBaseSchema(snapshot) {
  const missingTables = TABLES.filter((table) => !snapshot.tables.includes(table));
  const missingColumns = [];
  for (const [table, required] of Object.entries(BASE_COLUMNS)) {
    for (const name of required) if (!columnFor(snapshot, table, name)) missingColumns.push(`${table}.${name}`);
  }
  const missingIndexes = OLD_INDEXES.filter((index) => index.name !== 'uq_academic_result_block_scope' && !indexMatches(snapshot, index));
  if (missingTables.length || missingColumns.length || missingIndexes.length) {
    fail('MIGRATION_075_BASE_SCHEMA_MISMATCH', 'Production does not match the verified Migration 064 base schema; refusing Migration 075.', {
      missingTables, missingColumns, missingIndexes: missingIndexes.map(({ table, name }) => `${table}.${name}`)
    });
  }
}

function allNewColumnsPresent(snapshot) {
  return NEW_COLUMNS.every((expected) => {
    const column = columnFor(snapshot, expected.table, expected.name);
    if (!column) return false;
    const prior = columnFor(snapshot, expected.table, expected.after);
    return normalizedType(column.columnType) === expected.type
      && String(column.nullable).toUpperCase() === expected.nullable
      && normalizedDefault(column.defaultValue) === expected.defaultValue
      && prior && Number(column.ordinalPosition) === Number(prior.ordinalPosition) + 1;
  });
}

function noNewColumns(snapshot) {
  return NEW_COLUMNS.every(({ table, name }) => !columnFor(snapshot, table, name));
}

function allNewIndexesPresent(snapshot) {
  return NEW_INDEXES.every((index) => indexMatches(snapshot, index));
}

function noNewIndexes(snapshot) {
  return snapshot.indexes.every((row) => !NEW_INDEX_NAMES.has(row.indexName));
}

function oldUniqueIndexPresent(snapshot) {
  return indexMatches(snapshot, OLD_INDEXES[0]);
}

export async function read075SchemaSnapshot(database) {
  const names = TABLES;
  const inClause = placeholders(names);
  const tables = await database.query(`SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME`, names);
  const columns = await database.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
      COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue,
      ORDINAL_POSITION AS ordinalPosition
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME, ORDINAL_POSITION`, names);
  const indexes = await database.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
      NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seqInIndex
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, names);
  return { tables: tables.map((row) => row.tableName), columns, indexes };
}

export function assert075Postconditions(snapshot) {
  validateBaseSchema(snapshot);
  const missingColumns = NEW_COLUMNS.filter((expected) => {
    const column = columnFor(snapshot, expected.table, expected.name);
    const prior = columnFor(snapshot, expected.table, expected.after);
    return !column || normalizedType(column.columnType) !== expected.type
      || String(column.nullable).toUpperCase() !== expected.nullable
      || normalizedDefault(column.defaultValue) !== expected.defaultValue
      || !prior || Number(column.ordinalPosition) !== Number(prior.ordinalPosition) + 1;
  }).map(({ table, name }) => `${table}.${name}`);
  const missingIndexes = NEW_INDEXES.filter((index) => !indexMatches(snapshot, index))
    .map(({ table, name }) => `${table}.${name}`);
  const oldScopeUniqueStillPresent = oldUniqueIndexPresent(snapshot);
  const missingBaseTables = TABLES.filter((table) => !snapshot.tables.includes(table));
  if (missingColumns.length || missingIndexes.length || oldScopeUniqueStillPresent || missingBaseTables.length) {
    fail('MIGRATION_075_POSTCONDITION_FAILED', 'Migration 075 physical schema does not match its required postconditions.', {
      missingBaseTables, missingColumns, missingIndexes, oldScopeUniqueStillPresent
    });
  }
  return true;
}

export function assert075SafeState(snapshot, appliedRows = []) {
  validateBaseSchema(snapshot);
  const record = appliedRows.find((row) => Number(row.version) === 75);
  const postconditions = allNewColumnsPresent(snapshot) && allNewIndexesPresent(snapshot) && !oldUniqueIndexPresent(snapshot);
  if (record) {
    if (!postconditions) fail('MIGRATION_075_LEDGER_SCHEMA_MISMATCH', 'Migration 075 is recorded but its expected physical schema is not present.');
    assert075Postconditions(snapshot);
    return 'ALREADY_APPLIED';
  }
  const unapplied = noNewColumns(snapshot) && noNewIndexes(snapshot) && oldUniqueIndexPresent(snapshot);
  if (unapplied) return 'UNAPPLIED';
  if (postconditions) fail('MIGRATION_075_SCHEMA_APPLIED_UNRECORDED', 'Migration 075 physical postconditions are present without a ledger record; refusing to apply or fabricate history.');
  fail('MIGRATION_075_PARTIAL_SCHEMA', 'Migration 075 has a partial or inconsistent physical schema without a matching ledger record; refusing to rerun non-idempotent DDL.', {
    presentNewColumns: NEW_COLUMNS.filter(({ table, name }) => columnFor(snapshot, table, name)).map(({ table, name }) => `${table}.${name}`),
    presentNewIndexes: NEW_INDEXES.filter(({ table, name }) => indexRows(snapshot, table, name).length > 0).map(({ table, name }) => `${table}.${name}`),
    oldScopeUniquePresent: oldUniqueIndexPresent(snapshot)
  });
}

export const migration075SchemaExpectations = Object.freeze({ tables: TABLES, baseColumns: BASE_COLUMNS, oldIndexes: OLD_INDEXES, newColumns: NEW_COLUMNS, newIndexes: NEW_INDEXES });
