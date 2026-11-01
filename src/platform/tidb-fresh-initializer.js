import { createHash } from 'node:crypto';

export const TIDB_FRESH_SCHEMA_DATABASE = 'osaahdaylightschool';
export const TIDB_FRESH_SCHEMA_VERSION = 1;
export const TIDB_SINGLE_SCHOOL_ID = 'sch_default_01';

const META_TABLES = new Set(['schema_migrations', 'schema_migration_lock', 'schema_migration_runs', 'schema_baselines', 'osaah_fresh_installations']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const rows = (value) => Array.isArray(value) ? value : [];

export function canonicalTiDBSchemaChecksum(plan) {
  const payload = JSON.stringify({ kind: plan?.kind, dialect: plan?.dialect, version: plan?.version, statements: plan?.statements, tables: plan?.tables, views: plan?.views ?? [] });
  return createHash('sha256').update(payload).digest('hex');
}

function requirePlan(plan) {
  if (!plan || plan.dialect !== 'tidb' || plan.version !== TIDB_FRESH_SCHEMA_VERSION
    || plan.kind !== 'canonical-fresh-install' || !/^[a-f0-9]{64}$/i.test(String(plan.checksum ?? ''))
    || !Array.isArray(plan.statements) || !plan.statements.length || !Array.isArray(plan.tables) || !plan.tables.length || !Array.isArray(plan.views)) {
    fail('FRESH_SCHEMA_PLAN_INVALID', 'A versioned TiDB canonical schema plan is required.');
  }
  for (const table of plan.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(String(table?.name ?? '')) || !Array.isArray(table.columns) || !table.columns.length
      || !Array.isArray(table.primaryKey) || !table.primaryKey.length || !Array.isArray(table.indexes)
      || !Array.isArray(table.uniqueConstraints) || !Array.isArray(table.foreignKeys)
      || String(table.engine ?? '').toUpperCase() !== 'INNODB'
      || !/^[a-z0-9_]+$/i.test(String(table.charset ?? ''))
      || !/^[a-z0-9_]+$/i.test(String(table.collation ?? ''))
      || !String(table.collation).toLowerCase().startsWith(`${String(table.charset).toLowerCase()}_`)) {
      fail('FRESH_SCHEMA_PLAN_INVALID', 'The TiDB canonical schema plan has an incomplete table contract.');
    }
    const columnNames = new Set();
    for (const column of table.columns) {
      if (!/^[a-z][a-z0-9_]*$/.test(String(column?.name ?? '')) || !String(column.type ?? '').trim()
        || typeof column.nullable !== 'boolean' || !Object.hasOwn(column, 'default') || columnNames.has(column.name.toLowerCase())) {
        fail('FRESH_SCHEMA_PLAN_INVALID', `The TiDB canonical schema plan has an incomplete column contract for ${table.name}.`);
      }
      columnNames.add(column.name.toLowerCase());
    }
    if (table.primaryKey.some((column) => !columnNames.has(String(column).toLowerCase()))) {
      fail('FRESH_SCHEMA_PLAN_INVALID', `The TiDB canonical schema plan has an invalid primary key for ${table.name}.`);
    }
    for (const index of [...table.indexes, ...table.uniqueConstraints]) {
      if (!index?.name || !Array.isArray(index.columns) || !index.columns.length
        || index.columns.some((column) => !columnNames.has(String(column).toLowerCase()))) {
        fail('FRESH_SCHEMA_PLAN_INVALID', `The TiDB canonical schema plan has an invalid index contract for ${table.name}.`);
      }
    }
    for (const foreignKey of table.foreignKeys) {
      const local = foreignKey?.columns ?? (foreignKey?.column ? [foreignKey.column] : []);
      const referenced = foreignKey?.referencedColumns ?? (foreignKey?.referencedColumn ? [foreignKey.referencedColumn] : []);
      if (!foreignKey?.name || !local.length || local.length !== referenced.length
        || local.some((column) => !columnNames.has(String(column).toLowerCase()))
        || !['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onDelete ?? '').toUpperCase())
        || !['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(String(foreignKey.onUpdate ?? '').toUpperCase())) {
        fail('FRESH_SCHEMA_PLAN_INVALID', `The TiDB canonical schema plan has an incomplete foreign-key contract for ${table.name}.`);
      }
    }
  }
  if (plan.views !== undefined && (!Array.isArray(plan.views) || plan.views.some((view) => !/^[a-z][a-z0-9_]*$/.test(view.name) || !Array.isArray(view.columns) || !view.columns.length))) {
    fail('FRESH_SCHEMA_PLAN_INVALID', 'The TiDB canonical schema plan has an invalid view contract.');
  }
  if (plan.statements.some((statement) => typeof statement !== 'string'
    || !/^\s*CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE|VIEW)\b/i.test(statement)
    || /;\s*\S/.test(statement))) {
    fail('FRESH_SCHEMA_PLAN_INVALID', 'Fresh schema plans may contain only single-object CREATE statements.');
  }
  if (canonicalTiDBSchemaChecksum(plan) !== String(plan.checksum).toLowerCase()) {
    fail('FRESH_SCHEMA_PLAN_INVALID', 'The TiDB canonical schema checksum does not match its statements and contract.');
  }
  return plan;
}
async function assertIdentity(adapter) {
  const identity = rows(await adapter.query('SELECT DATABASE() AS database_name, VERSION() AS server_version'))[0];
  if (identity?.database_name !== TIDB_FRESH_SCHEMA_DATABASE) fail('DATABASE_NAME_MISMATCH', 'Fresh initialization requires the canonical OSAAH database.');
  if (!/tidb/i.test(String(identity?.server_version ?? ''))) fail('DATABASE_ENGINE_MISMATCH', 'Fresh initialization requires a TiDB server.');
  return identity;
}

async function readObjects(adapter) {
  return rows(await adapter.query(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS tableCollation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME'
  ));
}

async function readUserObjects(adapter) {
  return (await readObjects(adapter)).filter((object) => !META_TABLES.has(String(object.name ?? object.TABLE_NAME ?? '').toLowerCase()));
}

function indexGroups(indexRows) {
  const groups = new Map();
  for (const row of rows(indexRows)) {
    const name = String(row.indexName ?? row.INDEX_NAME ?? '');
    if (!groups.has(name)) groups.set(name, { name, unique: Number(row.nonUnique ?? row.NON_UNIQUE) === 0, columns: [] });
    groups.get(name).columns[Number(row.sequence ?? row.SEQ_IN_INDEX ?? 0) - 1] = String(row.columnName ?? row.COLUMN_NAME ?? '');
  }
  return [...groups.values()].map((group) => ({ ...group, columns: group.columns.filter(Boolean) }));
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim().replace(/''/g, "'");
  if (normalized.length >= 2 && normalized.startsWith("'") && normalized.endsWith("'")) normalized = normalized.slice(1, -1);
  if (/^current_timestamp(?:\(\))?$/i.test(normalized)) return 'current_timestamp';
  return normalized;
}

function foreignKeyGroups(foreignRows) {
  const groups = new Map();
  for (const row of rows(foreignRows)) {
    const name = String(row.constraintName ?? row.CONSTRAINT_NAME ?? '');
    if (!groups.has(name)) groups.set(name, {
      name,
      columns: [],
      referencedTable: String(row.referencedTable ?? row.REFERENCED_TABLE_NAME ?? ''),
      referencedColumns: [],
      onDelete: String(row.deleteRule ?? row.DELETE_RULE ?? '').toUpperCase(),
      onUpdate: String(row.updateRule ?? row.UPDATE_RULE ?? '').toUpperCase()
    });
    const group = groups.get(name);
    const offset = Number(row.sequence ?? row.ORDINAL_POSITION ?? 0) - 1;
    group.columns[offset] = String(row.columnName ?? row.COLUMN_NAME ?? '');
    group.referencedColumns[offset] = String(row.referencedColumn ?? row.REFERENCED_COLUMN_NAME ?? '');
  }
  return [...groups.values()].map((group) => ({ ...group, columns: group.columns.filter(Boolean), referencedColumns: group.referencedColumns.filter(Boolean) }));
}

async function verifyObject(adapter, object) {
  const [columnRows, indexRows, foreignRows] = await Promise.all([
    adapter.query('SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [object.name]),
    adapter.query('SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [object.name]),
    adapter.query('SELECT k.CONSTRAINT_NAME AS constraintName, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, k.ORDINAL_POSITION AS sequence, r.DELETE_RULE AS deleteRule, r.UPDATE_RULE AS updateRule FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION', [object.name])
  ]);
  const columns = new Map(rows(columnRows).map((row) => [String(row.columnName ?? row.COLUMN_NAME).toLowerCase(), row]));
  const expectedColumns = new Map((object.columns ?? []).map((column) => [column.name.toLowerCase(), column]));
  const issues = [];
  for (const expected of object.columns ?? []) {
    const actual = columns.get(expected.name.toLowerCase());
    if (!actual) { issues.push(`COLUMN_MISSING:${object.name}.${expected.name}`); continue; }
    const type = String(actual.columnType ?? actual.COLUMN_TYPE ?? '').toLowerCase();
    if (expected.type && type !== expected.type.toLowerCase()) issues.push(`COLUMN_TYPE_MISMATCH:${object.name}.${expected.name}`);
    const nullable = String(actual.isNullable ?? actual.IS_NULLABLE ?? '').toUpperCase() === 'YES';
    if (typeof expected.nullable === 'boolean' && nullable !== expected.nullable) issues.push(`COLUMN_NULLABILITY_MISMATCH:${object.name}.${expected.name}`);
    if (Object.hasOwn(expected, 'default') && normalizeDefault(actual.columnDefault ?? actual.COLUMN_DEFAULT) !== normalizeDefault(expected.default)) issues.push(`COLUMN_DEFAULT_MISMATCH:${object.name}.${expected.name}`);
  }
  for (const columnName of columns.keys()) if (!expectedColumns.has(columnName)) issues.push(`COLUMN_UNEXPECTED:${object.name}.${columnName}`);

  const indexes = indexGroups(indexRows);
  const expectedIndexes = [
    ...(object.primaryKey?.length ? [{ name: 'PRIMARY', unique: true, columns: object.primaryKey }] : []),
    ...(object.uniqueConstraints ?? []).map((entry) => ({ ...entry, unique: true })),
    ...(object.indexes ?? []).map((entry) => ({ ...entry, unique: false }))
  ];
  const indexMatches = (actual, expected) => (!expected.name || actual.name.toLowerCase() === expected.name.toLowerCase())
    && actual.unique === Boolean(expected.unique)
    && actual.columns.map((column) => column.toLowerCase()).join('\0') === expected.columns.map((column) => column.toLowerCase()).join('\0');
  for (const expected of expectedIndexes) if (!indexes.some((actual) => indexMatches(actual, expected))) {
    issues.push(`INDEX_MISSING_OR_MISMATCH:${object.name}.${expected.name ?? expected.columns.join('_')}`);
  }
  for (const actual of indexes) if (!expectedIndexes.some((expected) => indexMatches(actual, expected))) issues.push(`INDEX_UNEXPECTED:${object.name}.${actual.name}`);

  const foreignKeys = foreignKeyGroups(foreignRows);
  const expectedForeignKey = (fk) => ({
    name: fk.name,
    columns: fk.columns ?? (fk.column ? [fk.column] : []),
    referencedTable: fk.referencedTable,
    referencedColumns: fk.referencedColumns ?? (fk.referencedColumn ? [fk.referencedColumn] : []),
    onDelete: String(fk.onDelete).toUpperCase(),
    onUpdate: String(fk.onUpdate).toUpperCase()
  });
  const foreignKeyMatches = (actual, fk) => (!fk.name || actual.name.toLowerCase() === fk.name.toLowerCase())
    && actual.columns.map((column) => column.toLowerCase()).join('\0') === fk.columns.map((column) => column.toLowerCase()).join('\0')
    && actual.referencedTable.toLowerCase() === String(fk.referencedTable).toLowerCase()
    && actual.referencedColumns.map((column) => column.toLowerCase()).join('\0') === fk.referencedColumns.map((column) => column.toLowerCase()).join('\0')
    && actual.onDelete === fk.onDelete && actual.onUpdate === fk.onUpdate;
  for (const item of object.foreignKeys ?? []) {
    const expected = expectedForeignKey(item);
    if (!foreignKeys.some((actual) => foreignKeyMatches(actual, expected))) issues.push(`FOREIGN_KEY_MISSING_OR_MISMATCH:${object.name}.${item.name}`);
  }
  for (const actual of foreignKeys) if (!(object.foreignKeys ?? []).some((item) => foreignKeyMatches(actual, expectedForeignKey(item)))) issues.push(`FOREIGN_KEY_UNEXPECTED:${object.name}.${actual.name}`);
  return issues;
}

export async function verifyTiDBFreshSchema(adapter, plan) {
  const schema = requirePlan(plan);
  await assertIdentity(adapter);
  const issues = [];
  const actualObjects = await readUserObjects(adapter);
  const actualByName = new Map(actualObjects.map((object) => [String(object.name ?? object.TABLE_NAME ?? '').toLowerCase(), object]));
  const contracts = [
    ...schema.tables.map((object) => ({ ...object, expectedObjectType: 'BASE TABLE' })),
    ...(schema.views ?? []).map((object) => ({ ...object, expectedObjectType: 'VIEW' }))
  ];
  const expectedByName = new Map(contracts.map((object) => [object.name.toLowerCase(), object]));
  for (const [name, expected] of expectedByName) {
    const actual = actualByName.get(name);
    if (!actual) { issues.push(`OBJECT_MISSING:${name}`); continue; }
    const actualType = String(actual.type ?? actual.TABLE_TYPE ?? '').toUpperCase();
    if (actualType !== expected.expectedObjectType) issues.push(`OBJECT_TYPE_MISMATCH:${name}`);
    if (expected.expectedObjectType === 'BASE TABLE') {
      if (String(actual.engine ?? actual.ENGINE ?? '').toUpperCase() !== String(expected.engine).toUpperCase()) issues.push(`TABLE_ENGINE_MISMATCH:${name}`);
      const actualCollation = String(actual.tableCollation ?? actual.TABLE_COLLATION ?? '').toLowerCase();
      if (actualCollation !== String(expected.collation).toLowerCase()) issues.push(`TABLE_COLLATION_MISMATCH:${name}`);
      const actualCharset = actualCollation.split('_')[0];
      if (actualCharset !== String(expected.charset).toLowerCase()) issues.push(`TABLE_CHARSET_MISMATCH:${name}`);
    }
    issues.push(...await verifyObject(adapter, expected));
  }
  for (const name of actualByName.keys()) if (!expectedByName.has(name)) issues.push(`OBJECT_UNEXPECTED:${name}`);
  return { valid: issues.length === 0, database: TIDB_FRESH_SCHEMA_DATABASE, schemaVersion: schema.version, expectedTableCount: schema.tables.length, expectedViewCount: schema.views?.length ?? 0, issues };
}
async function ensureInstallationLedger(adapter) {
  await adapter.execute(`CREATE TABLE IF NOT EXISTS osaah_fresh_installations (
    installation_id TINYINT NOT NULL PRIMARY KEY,
    canonical_database VARCHAR(128) NOT NULL,
    schema_version INT NOT NULL,
    schema_checksum CHAR(64) NOT NULL,
    completed_at DATETIME NOT NULL
  )`);
}

export async function initializeTiDBFreshDatabase({ adapter, plan, now = new Date() } = {}) {
  const schema = requirePlan(plan);
  if (!adapter || adapter.dialect !== 'tidb' || typeof adapter.query !== 'function' || typeof adapter.execute !== 'function'
    || typeof adapter.ensureMetadata !== 'function' || typeof adapter.acquireLock !== 'function' || typeof adapter.releaseLock !== 'function') {
    fail('TIDB_ADAPTER_REQUIRED', 'Fresh initialization requires the TiDB adapter and its migration lock.');
  }
  await assertIdentity(adapter);
  const preflightObjects = await readObjects(adapter);
  const preflightUserObjects = preflightObjects.filter((object) => !META_TABLES.has(String(object.name ?? object.TABLE_NAME ?? '').toLowerCase()));
  const installationLedgerExists = preflightObjects.some((object) => String(object.name ?? object.TABLE_NAME ?? '').toLowerCase() === 'osaah_fresh_installations');
  if (preflightUserObjects.length && !installationLedgerExists) {
    fail('FRESH_DATABASE_NOT_EMPTY', 'Fresh initialization stopped because the database already contains application objects.');
  }
  await adapter.ensureMetadata({ create: !installationLedgerExists });
  if (!await adapter.acquireLock()) fail('DATABASE_INITIALIZATION_LOCKED', 'Another schema initialization or migration holds the database lock.');
  try {
    const actualObjects = await readObjects(adapter);
    const userObjects = actualObjects.filter((object) => !META_TABLES.has(String(object.name ?? object.TABLE_NAME ?? '').toLowerCase()));
    const hasInstallationLedger = actualObjects.some((object) => String(object.name ?? object.TABLE_NAME ?? '').toLowerCase() === 'osaah_fresh_installations');
    if (userObjects.length && !hasInstallationLedger) {
      fail('FRESH_DATABASE_NOT_EMPTY', 'Fresh initialization stopped because the database contains application objects or migration history.');
    }
    const applied = rows(await adapter.listApplied());
    const baselines = typeof adapter.listBaselines === 'function' ? rows(await adapter.listBaselines()) : [];
    if (!hasInstallationLedger && (applied.length || baselines.length)) {
      fail('FRESH_DATABASE_NOT_EMPTY', 'Fresh initialization stopped because the database contains migration history.');
    }
    const installed = hasInstallationLedger
      ? rows(await adapter.query('SELECT canonical_database AS canonicalDatabase, schema_version AS schemaVersion, schema_checksum AS schemaChecksum FROM osaah_fresh_installations WHERE installation_id = 1'))[0]
      : null;
    if (installed) {
      if (installed.canonicalDatabase !== TIDB_FRESH_SCHEMA_DATABASE || Number(installed.schemaVersion) !== schema.version || installed.schemaChecksum !== schema.checksum) {
        fail('FRESH_SCHEMA_LEDGER_MISMATCH', 'The fresh schema ledger does not match the requested canonical schema.');
      }
      const verification = await verifyTiDBFreshSchema(adapter, schema);
      if (!verification.valid) fail('FRESH_SCHEMA_POSTCONDITION_FAILED', 'The installed schema does not satisfy its canonical postconditions.');
      return { status: 'ALREADY_INITIALIZED', ...verification };
    }
    if (hasInstallationLedger) {
      fail('FRESH_SCHEMA_RECOVERY_REQUIRED', 'A fresh-install ledger exists without a completion record; inspect actual TiDB DDL effects before any retry.');
    }
    if (userObjects.length || applied.length || baselines.length) {
      fail('FRESH_DATABASE_NOT_EMPTY', 'Fresh initialization stopped because the database contains application objects or migration history.');
    }
    await ensureInstallationLedger(adapter);
    for (const statement of schema.statements) await adapter.execute(statement);
    const verification = await verifyTiDBFreshSchema(adapter, schema);
    if (!verification.valid) fail('FRESH_SCHEMA_POSTCONDITION_FAILED', 'Fresh schema creation failed independent metadata verification.');
    await adapter.execute(
      'INSERT INTO osaah_fresh_installations (installation_id, canonical_database, schema_version, schema_checksum, completed_at) VALUES (1, ?, ?, ?, ?)',
      [TIDB_FRESH_SCHEMA_DATABASE, schema.version, schema.checksum, now.toISOString().replace('T', ' ').replace('Z', '')]
    );
    return { status: 'INITIALIZED', ...verification };
  } catch (error) {
    if (error?.code) throw error;
    fail('FRESH_SCHEMA_INITIALIZATION_FAILED', 'Fresh schema initialization failed; inspect TiDB metadata before any retry.');
  } finally {
    await adapter.releaseLock();
  }
}
