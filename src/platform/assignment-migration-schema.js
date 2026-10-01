export const ASSIGNMENT_SCHEMA_TABLES = Object.freeze(['assignments', 'assignment_files']);
export const ASSIGNMENT_MIGRATION_LEDGER_VERSIONS = Object.freeze([61, 62]);

const tablePlaceholders = ASSIGNMENT_SCHEMA_TABLES.map(() => '?').join(', ');

export const ASSIGNMENT_SCHEMA_QUERIES = Object.freeze({
  tables: `SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tablePlaceholders})
    ORDER BY TABLE_NAME`,
  columns: `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
      IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tablePlaceholders})
    ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  indexes: `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
      COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tablePlaceholders})
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  constraints: `SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS constraintName,
      k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
      k.COLUMN_NAME AS columnName, r.DELETE_RULE AS deleteRule
    FROM information_schema.KEY_COLUMN_USAGE AS k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
      AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN (${tablePlaceholders})
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
  ledger: 'SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations WHERE version IN (?, ?) ORDER BY version'
});

export async function readAssignmentSchemaSnapshot(adapter) {
  const parameters = [...ASSIGNMENT_SCHEMA_TABLES];
  const tables = await adapter.query(ASSIGNMENT_SCHEMA_QUERIES.tables, parameters);
  const columns = await adapter.query(ASSIGNMENT_SCHEMA_QUERIES.columns, parameters);
  const indexes = await adapter.query(ASSIGNMENT_SCHEMA_QUERIES.indexes, parameters);
  const constraints = await adapter.query(ASSIGNMENT_SCHEMA_QUERIES.constraints, parameters);
  return { tables, columns, indexes, constraints };
}

export async function readAssignmentMigrationLedger(adapter) {
  await adapter.ensureMetadata({ create: false });
  return adapter.query(ASSIGNMENT_SCHEMA_QUERIES.ledger, [...ASSIGNMENT_MIGRATION_LEDGER_VERSIONS]);
}

export function isAssignmentMigrationRecorded(rows, migration) {
  return rows.some((row) => Number(row.version) === Number(migration.version)
    && row.name === migration.name
    && row.checksum === migration.checksum);
}
