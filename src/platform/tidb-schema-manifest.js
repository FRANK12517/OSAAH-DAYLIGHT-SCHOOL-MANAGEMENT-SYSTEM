const identifier = /^[a-z][a-z0-9_]*$/;
const supportedType = /^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|bool|boolean|char|varchar|binary|varbinary|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|json|date|datetime|timestamp|time|year|enum|set)(?:\s*\([^;]*\))?(?:\s+unsigned)?$/i;

function isSupportedType(value) {
  const type = String(value ?? '').trim();
  if (!supportedType.test(type)) return false;
  return !/^(?:varchar|char|varbinary|binary)\s*$/i.test(type);
}

function indexedByPrefix(table, columns) {
  const declarations = [
    ...(Array.isArray(table?.primaryKey) && table.primaryKey.length ? [{ columns: table.primaryKey }] : []),
    ...(table?.indexes ?? []),
    ...(table?.uniqueConstraints ?? [])
  ];
  return declarations.some((index) => Array.isArray(index?.columns)
    && columns.every((column, position) => String(index.columns[position]).toLowerCase() === String(column).toLowerCase()));
}

function normalizeCharset(value) {
  return value == null ? null : String(value).trim().toLowerCase();
}

export function validateCanonicalTiDBSchemaManifest(manifest, { runtimeRequirements = {}, requiredDefaults = {} } = {}) {
  const issues = [];
  if (!manifest || manifest.status !== 'CANONICAL' || manifest.dialect !== 'tidb') issues.push('MANIFEST_NOT_CANONICAL_TIDB');
  if (manifest?.database !== 'osaahdaylightschool') issues.push('CANONICAL_DATABASE_MISMATCH');
  if (manifest?.schoolId !== 'sch_default_01') issues.push('SINGLE_SCHOOL_ID_MISMATCH');
  if (!Array.isArray(manifest?.tables) || manifest.tables.length === 0) return { valid: false, issues: [...issues, 'TABLES_REQUIRED'], tableCount: 0 };
  if (!Array.isArray(manifest?.views)) issues.push('VIEWS_CONTRACT_REQUIRED');

  const tables = new Map();
  for (const table of manifest.tables) {
    const name = String(table?.name ?? '');
    if (!identifier.test(name)) issues.push(`INVALID_TABLE_NAME:${name || '(empty)'}`);
    const key = name.toLowerCase();
    if (tables.has(key)) issues.push(`DUPLICATE_TABLE:${key}`);
    else tables.set(key, table);
    if (String(table?.engine ?? '').toUpperCase() !== 'INNODB') issues.push(`TABLE_ENGINE_REQUIRED:${name}`);
    if (!/^[a-z0-9_]+$/i.test(String(table?.charset ?? '')) || !/^[a-z0-9_]+$/i.test(String(table?.collation ?? '')) || !String(table?.collation ?? '').toLowerCase().startsWith(`${String(table?.charset ?? '').toLowerCase()}_`)) issues.push(`TABLE_CHARSET_COLLATION_REQUIRED:${name}`);
    for (const property of ['indexes', 'uniqueConstraints', 'foreignKeys']) if (!Array.isArray(table?.[property])) issues.push(`TABLE_${property.toUpperCase()}_CONTRACT_REQUIRED:${name}`);
    const columns = new Map();
    for (const column of table?.columns ?? []) {
      const columnName = String(column?.name ?? '');
      if (!identifier.test(columnName)) issues.push(`INVALID_COLUMN_NAME:${name}.${columnName || '(empty)'}`);
      const columnKey = columnName.toLowerCase();
      if (columns.has(columnKey)) issues.push(`DUPLICATE_COLUMN:${name}.${columnKey}`);
      else columns.set(columnKey, column);
      if (!isSupportedType(column?.type)) issues.push(`UNSUPPORTED_TIDB_TYPE:${name}.${columnName}`);
      if (typeof column?.nullable !== 'boolean') issues.push(`NULLABILITY_REQUIRED:${name}.${columnName}`);
      if (!Object.hasOwn(column ?? {}, 'default')) issues.push(`COLUMN_DEFAULT_CONTRACT_REQUIRED:${name}.${columnName}`);
      else if (!(column.default === null || ['string', 'number', 'boolean'].includes(typeof column.default)) || (typeof column.default === 'number' && !Number.isFinite(column.default))) issues.push(`COLUMN_DEFAULT_INVALID:${name}.${columnName}`);
    }
    const primaryKey = table?.primaryKey;
    if (!Array.isArray(primaryKey) || primaryKey.length === 0) issues.push(`PRIMARY_KEY_REQUIRED:${name}`);
    else for (const column of primaryKey) if (!columns.has(String(column).toLowerCase())) issues.push(`PRIMARY_KEY_COLUMN_MISSING:${name}.${column}`);
    for (const [column, value] of Object.entries(requiredDefaults[name] ?? {})) {
      const declared = columns.get(column.toLowerCase());
      if (!declared || !Object.hasOwn(declared, 'default') || declared.default !== value) issues.push(`REQUIRED_DEFAULT_MISSING:${name}.${column}`);
    }
  }

  for (const [tableName, requiredColumns] of Object.entries(runtimeRequirements)) {
    const table = tables.get(tableName.toLowerCase());
    if (!table) { issues.push(`RUNTIME_TABLE_MISSING:${tableName}`); continue; }
    const columns = new Map((table.columns ?? []).map((column) => [String(column.name).toLowerCase(), column]));
    for (const column of requiredColumns) if (!columns.has(String(column).toLowerCase())) issues.push(`RUNTIME_COLUMN_MISSING:${tableName}.${column}`);
  }

  for (const table of manifest.tables) {
    const tableName = String(table?.name ?? '');
    const columns = new Map((table?.columns ?? []).map((column) => [String(column.name).toLowerCase(), column]));
    const indexes = [...(table?.indexes ?? []), ...(table?.uniqueConstraints ?? [])];
    const indexNames = new Set();
    for (const index of indexes) {
      if (!index?.name || !Array.isArray(index.columns) || !index.columns.length) issues.push(`INDEX_DEFINITION_INVALID:${tableName}.${index?.name ?? '(unnamed)'}`);
      const indexName = String(index?.name ?? '').toLowerCase();
      if (indexName && indexNames.has(indexName)) issues.push(`DUPLICATE_INDEX:${tableName}.${indexName}`);
      if (indexName) indexNames.add(indexName);
      for (const column of index?.columns ?? []) if (!columns.has(String(column).toLowerCase())) issues.push(`INDEX_COLUMN_MISSING:${tableName}.${column}`);
    }
    for (const foreignKey of table?.foreignKeys ?? []) {
      if (!foreignKey || typeof foreignKey !== 'object') { issues.push(`FOREIGN_KEY_DEFINITION_INVALID:${tableName}`); continue; }
      const localColumns = foreignKey.columns ?? [];
      const remoteColumns = foreignKey.referencedColumns ?? [];
      if (!Array.isArray(localColumns) || !Array.isArray(remoteColumns) || !localColumns.length || localColumns.length !== remoteColumns.length) {
        issues.push(`FOREIGN_KEY_ARITY_INVALID:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
        continue;
      }
      const referenced = tables.get(String(foreignKey.referencedTable ?? '').toLowerCase());
      if (!referenced) { issues.push(`FOREIGN_KEY_TABLE_MISSING:${tableName}.${foreignKey.referencedTable}`); continue; }
      const referencedColumns = new Map((referenced.columns ?? []).map((column) => [String(column.name).toLowerCase(), column]));
      for (let index = 0; index < localColumns.length; index += 1) {
        const localName = String(localColumns[index]).toLowerCase();
        const remoteName = String(remoteColumns[index]).toLowerCase();
        const local = columns.get(localName), remote = referencedColumns.get(remoteName);
        if (!local) issues.push(`FOREIGN_KEY_LOCAL_COLUMN_MISSING:${tableName}.${localName}`);
        if (!remote) issues.push(`FOREIGN_KEY_REMOTE_COLUMN_MISSING:${foreignKey.referencedTable}.${remoteName}`);
        if (local && remote) {
          if (String(local.type).replace(/\s+/g, '').toLowerCase() !== String(remote.type).replace(/\s+/g, '').toLowerCase()) issues.push(`FOREIGN_KEY_TYPE_MISMATCH:${tableName}.${localName}`);
          for (const property of ['charset', 'collation']) if (normalizeCharset(local[property]) !== normalizeCharset(remote[property])) issues.push(`FOREIGN_KEY_${property.toUpperCase()}_MISMATCH:${tableName}.${localName}`);
        }
      }
      if (remoteColumns.every((column) => referencedColumns.has(String(column).toLowerCase())) && !indexedByPrefix(referenced, remoteColumns)) issues.push(`FOREIGN_KEY_REMOTE_INDEX_MISSING:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
      if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onDelete ?? '').toUpperCase())) issues.push(`FOREIGN_KEY_ON_DELETE_REQUIRED:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
      if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onUpdate ?? '').toUpperCase())) issues.push(`FOREIGN_KEY_ON_UPDATE_REQUIRED:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
      if (foreignKey.onDelete && !['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onDelete).toUpperCase())) issues.push(`FOREIGN_KEY_ACTION_UNSUPPORTED:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
      if (foreignKey.onUpdate && !['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onUpdate).toUpperCase())) issues.push(`FOREIGN_KEY_ACTION_UNSUPPORTED:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
      if (String(foreignKey.onDelete).toUpperCase() === 'SET NULL' && localColumns.some((column) => columns.get(String(column).toLowerCase())?.nullable === false)) issues.push(`FOREIGN_KEY_SET_NULL_NON_NULLABLE:${tableName}.${foreignKey.name ?? '(unnamed)'}`);
    }
  }
  const objectNames = new Set(tables.keys());
  for (const view of manifest.views ?? []) {
    const name = String(view?.name ?? ''), key = name.toLowerCase();
    if (!identifier.test(name)) issues.push(`INVALID_VIEW_NAME:${name || '(empty)'}`);
    if (objectNames.has(key)) issues.push(`DUPLICATE_SCHEMA_OBJECT:${key}`);
    objectNames.add(key);
    if (!Array.isArray(view?.columns) || view.columns.length === 0) issues.push(`VIEW_COLUMNS_REQUIRED:${name}`);
    for (const column of view?.columns ?? []) {
      if (!identifier.test(String(column?.name ?? ''))) issues.push(`INVALID_VIEW_COLUMN:${name}.${column?.name ?? '(empty)'}`);
      if (!isSupportedType(column?.type)) issues.push(`UNSUPPORTED_VIEW_TYPE:${name}.${column?.name ?? '(empty)'}`);
      if (typeof column?.nullable !== 'boolean') issues.push(`VIEW_NULLABILITY_REQUIRED:${name}.${column?.name ?? '(empty)'}`);
    }
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)], tableCount: tables.size };
}

export function validateTiDBSchemaEvidenceManifest(manifest) {
  const issues = [];
  if (manifest?.status !== 'EVIDENCE_ONLY_NOT_CANONICAL') issues.push('EVIDENCE_MANIFEST_STATUS_INVALID');
  if (!Array.isArray(manifest?.tables)) issues.push('EVIDENCE_TABLES_REQUIRED');
  const names = new Set();
  for (const table of manifest?.tables ?? []) {
    const name = String(table?.name ?? '').toLowerCase();
    if (names.has(name)) issues.push(`DUPLICATE_EVIDENCE_TABLE:${name}`);
    names.add(name);
    if (table?.status !== 'UNRESOLVED_NOT_CANONICAL') issues.push(`EVIDENCE_TABLE_MARKED_CANONICAL:${name}`);
    for (const operation of table?.runtimeSqlEvidence ?? []) if (!table.sourceFiles?.includes(operation.source)) issues.push(`EVIDENCE_SOURCE_MISSING:${name}:${operation.source}`);
  }
  const tableNames = new Set((manifest?.tables ?? []).map((table) => String(table?.name ?? '').toLowerCase()));
  for (const table of manifest?.tables ?? []) {
    for (const operation of table?.runtimeSqlEvidence ?? []) if (!tableNames.has(String(operation.table).toLowerCase())) issues.push(`RUNTIME_SQL_TABLE_MISSING_FROM_MATRIX:${operation.table}`);
  }
  if (manifest?.unresolvedSummary?.allObjectsRemainUnresolvedForCanonicalDdl !== true) issues.push('UNRESOLVED_STATUS_NOT_EXPLICIT');
  return { valid: issues.length === 0, issues: [...new Set(issues)], tableCount: names.size, canonical: false };
}
