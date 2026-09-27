import { createHash } from 'node:crypto';
import { splitMigrationSql } from '../ai/tidb-database-adapter.js';

export const FINAL_RESULT_SLIP_CONFIRMATION = 'APPLY_FINAL_RESULT_SLIP_RECONCILIATION_049_054_055_056';
export const FINAL_RESULT_SLIP_DATABASE = 'osaahdaylightschool';
export const FINAL_RESULT_SLIP_VERSIONS = Object.freeze([49, 54, 55, 56]);
export const FINAL_RESULT_SLIP_PREDECESSORS = Object.freeze([50, 51, 52, 53]);

const fail = (code, message, details) => Object.assign(new Error(message), { code, details });
const identifier = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw fail('RECONCILIATION_IDENTIFIER_INVALID', 'A migration identifier was invalid.');
  return `\`${value}\``;
};

export function validateFinalReleaseInputs({ confirmation, releaseSha, databaseUrl }) {
  if (confirmation !== FINAL_RESULT_SLIP_CONFIRMATION) throw fail('CONFIRMATION_MISMATCH', 'Production confirmation phrase did not match.');
  if (typeof releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(releaseSha)) throw fail('RELEASE_SHA_INVALID', 'release_sha must be a full lowercase 40-character commit SHA.');
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) throw fail('DATABASE_URL_MISSING', 'Protected DATABASE_URL is unavailable.');
}

export function assertFinalProductionDatabase(name) {
  if (name !== FINAL_RESULT_SLIP_DATABASE) throw fail('DATABASE_TARGET_MISMATCH', 'Connected database does not match the protected production target.');
}

function splitTopLevel(input) {
  const parts = []; let start = 0; let depth = 0; let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) { if (ch === quote && input[i + 1] === quote) i += 1; else if (ch === quote && input[i - 1] !== '\\') quote = null; continue; }
    if (ch === '`' || ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { parts.push(input.slice(start, i).trim()); start = i + 1; }
  }
  if (input.slice(start).trim()) parts.push(input.slice(start).trim());
  return parts;
}

function parseColumnsAndIndexes(body) {
  const columns = [];
  const indexes = [];
  const foreignKeys = [];
  for (const part of splitTopLevel(body)) {
    const partText = part.trim();
    const fk = partText.match(/^(?:CONSTRAINT\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([^)]+)\)/i);
    if (fk) {
      const sourceColumns = fk[2].split(',').map((value) => value.trim().replace(/`/g, ''));
      const targetColumns = fk[4].split(',').map((value) => value.trim().replace(/`/g, ''));
      if (sourceColumns.length !== targetColumns.length) throw fail('MIGRATION_049_FOREIGN_KEY_CONTRACT_INVALID', 'A migration foreign key has mismatched source and target columns.');
      sourceColumns.forEach((column, index) => foreignKeys.push({ name: fk[1] ?? null, column, referencedTable: fk[3], referencedColumn: targetColumns[index] }));
      continue;
    }
    const idx = partText.match(/^(?:PRIMARY\s+KEY|UNIQUE(?:\s+(?:KEY|INDEX))?|(?:KEY|INDEX))\s*(?:`?([A-Za-z_][A-Za-z0-9_]*)`?\s*)?\(([^)]+)\)/i);
    if (idx) {
      const kind = /^PRIMARY/i.test(partText) ? 'PRIMARY' : (/^UNIQUE/i.test(partText) ? 'UNIQUE' : 'INDEX');
      const indexColumns = idx[2].split(',').map((value) => value.trim().replace(/`/g, ''));
      const name = kind === 'PRIMARY' ? 'PRIMARY' : (idx[1] || `${kind.toLowerCase()}_${indexColumns.join('_')}`);
      indexes.push({ name, unique: kind !== 'INDEX', primary: kind === 'PRIMARY', columns: indexColumns });
      continue;
    }
    const match = partText.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(.+)$/s);
    if (!match) continue;
    const [, first, tail] = match;
    if (/^(?:CONSTRAINT|FOREIGN|CHECK|KEY|INDEX|UNIQUE|PRIMARY)\b/i.test(first)) continue;
    columns.push(first);
    const inlinePk = tail.match(/\bPRIMARY\s+KEY\b/i);
    if (inlinePk) indexes.push({ name: 'PRIMARY', unique: true, primary: true, columns: [first] });
  }
  return { columns, indexes, foreignKeys };
}

export function parseReconciliation049(sql) {
  const contract = { tables: new Map(), columns: new Map(), indexes: [], foreignKeys: [], views: [] };
  for (const rawStatement of splitMigrationSql(sql)) {
    const statement = rawStatement.replace(/^(?:(?:[\t \r\n]+)|(?:--|#)[^\r\n]*(?:\r?\n|$))*/, '').trim();
    let match = statement.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([\s\S]*)\)\s*$/i);
    if (match) {
      const [table, body] = [match[1], match[2]];
      const parsed = parseColumnsAndIndexes(body);
      contract.tables.set(table, { statement, columns: parsed.columns });
      contract.indexes.push(...parsed.indexes.map((index) => ({ table, ...index })));
      contract.foreignKeys.push(...parsed.foreignKeys.map((foreignKey) => ({ table, ...foreignKey })));
      continue;
    }
    match = statement.match(/^ALTER\s+TABLE\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i);
    if (match) {
      const [, table, column] = match;
      if (!contract.columns.has(table)) contract.columns.set(table, new Map());
      contract.columns.get(table).set(column, statement);
      continue;
    }
    match = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+ON\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([^)]+)\)/i);
    if (match) {
      contract.indexes.push({ table: match[3], name: match[2], unique: Boolean(match[1]), primary: false, columns: match[4].split(',').map((value) => value.trim().replace(/`/g, '')), statement });
      continue;
    }
    match = statement.match(/^CREATE\s+OR\s+REPLACE\s+VIEW\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+AS\s+([\s\S]+)$/i);
    if (match) { contract.views.push({ name: match[1], statement, definition: match[2].replace(/;\s*$/, '') }); continue; }
    throw fail('MIGRATION_049_UNSUPPORTED_STATEMENT', 'Migration 049 contains a statement outside the bounded reconciliation contract.', statement.slice(0, 180));
  }
  for (const [table] of contract.columns) if (!contract.tables.has(table)) contract.tables.set(table, { statement: null, columns: [] });
  return contract;
}

function normalizedDefinition(value) {
  return String(value ?? '').toLowerCase().replace(/`/g, '').replace(/osaahdaylightschool\./g, '').replace(/_utf8mb4/g, '').replace(/\bas\s+([a-z_][a-z0-9_]*)/g, (all, alias, offset, source) => {
    const before = source.slice(0, offset).trimEnd();
    const expression = before.split(',').at(-1).trim().replace(/\s+/g, ' ');
    const terminal = expression.split('.').at(-1).replace(/[()]/g, '');
    return terminal === alias ? '' : all;
  }).replace(/count\(\s*\*\s*\)/g, 'count(1)').replace(/\s+/g, ' ').replace(/\s*([(),=<>])\s*/g, '$1').trim();
}

const VIEW_COLUMNS = Object.freeze({
  vw_student_fee_balances: ['account_id','school_id','student_id','permanent_student_id','academic_year_id','term_id','class_id','total_charged','total_discount','total_paid','balance'],
  vw_fee_overview: ['school_id','academic_year_id','term_id','student_accounts','expected_fees','discounts','collected','outstanding'],
  vw_fee_arrears: ['account_id','school_id','student_id','permanent_student_id','academic_year_id','term_id','class_id','total_charged','total_discount','total_paid','balance'],
  vw_published_fee_structures: ['id','school_id','academic_year_id','term_id','class_id','fee_type','amount','status'],
  vw_invoice_receipt_register: ['school_id','permanent_student_id','academic_year_id','term_id','class_id','invoice_number','payment_reference','receipt_number','amount_paid','payment_method','payment_date','previous_balance','new_balance','issued_at','payment_status','receipt_status'],
  vw_fee_collection_summary: ['school_id','collection_type','academic_year_id','term_id','collection_period','collection_date','transaction_count','amount_received_minor']
});

const VIEW_RULES = Object.freeze({
  vw_student_fee_balances: ['student_fee_accounts','student_fee_ledger','transaction_type','total_charged','total_discount','total_paid','balance'],
  vw_fee_overview: ['vw_student_fee_balances','student_accounts','expected_fees','outstanding','group by'],
  vw_fee_arrears: ['vw_student_fee_balances','balance>0'],
  vw_published_fee_structures: ['fee_structures','academic_year','category_name','published'],
  vw_invoice_receipt_register: ['student_fee_payments','fee_invoices','student_fee_receipts','amount_paid','payment_reference'],
  vw_fee_collection_summary: ['fee_collection_records','amount_received_minor','group by']
});

async function tableExists(adapter, table) {
  const rows = await adapter.query('SELECT TABLE_NAME AS tableName,TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
  return rows.some((row) => row.tableName === table && row.tableType === 'BASE TABLE');
}

async function inspectTable(adapter, table) {
  const [columns, indexes, foreignKeys] = await Promise.all([
    adapter.query('SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]),
    adapter.query('SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [table]),
    adapter.query('SELECT COLUMN_NAME AS columnName,CONSTRAINT_NAME AS constraintName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table])
  ]);
  const grouped = new Map();
  for (const row of indexes) {
    if (!grouped.has(row.indexName)) grouped.set(row.indexName, { name: row.indexName, unique: Number(row.nonUnique) === 0, columns: [] });
    grouped.get(row.indexName).columns[Number(row.sequence) - 1] = row.columnName;
  }
  return { columns: new Set(columns.map((row) => row.columnName)), indexes: [...grouped.values()], foreignKeys: foreignKeys.filter((row) => row.referencedTable).map((row) => [row.columnName,row.referencedTable,row.referencedColumn]).sort() };
}

function signatureExists(actual, expected) {
  return actual.some((index) => index.unique === expected.unique && JSON.stringify(index.columns) === JSON.stringify(expected.columns));
}

async function inspectView(adapter, name) {
  const rows = await adapter.query('SELECT TABLE_NAME AS viewName,VIEW_DEFINITION AS viewDefinition FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [name]);
  if (!rows.length) return null;
  const columns = await adapter.query('SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [name]);
  return { definition: rows[0].viewDefinition, columns: columns.map((row) => row.columnName) };
}

export function isViewCompatible(name, actual) {
  if (!actual || JSON.stringify(actual.columns) !== JSON.stringify(VIEW_COLUMNS[name])) return false;
  const normalized = normalizedDefinition(actual.definition);
  const rule = VIEW_RULES[name] ?? [];
  if (!rule.every((fragment) => normalized.includes(fragment))) return false;
  if (name === 'vw_invoice_receipt_register' && /\bp\.amount\b/.test(normalized)) return false;
  if (name === 'vw_fee_arrears') return normalized.includes('vw_student_fee_balances') && normalized.includes('balance>0');
  return true;
}

async function executeSql(adapter, executeMigrationSql, sql, version = 49) {
  if (typeof executeMigrationSql === 'function') return executeMigrationSql(sql, { migrationName: version === 49 ? '049_production_schema_reconciliation.sql' : null, version });
  if (typeof adapter.execute === 'function') return adapter.execute(sql);
  throw fail('DATABASE_ADAPTER_INVALID', 'Database adapter cannot execute migration statements.');
}

async function ensureIndex(adapter, executeMigrationSql, expected, executed) {
  const meta = await inspectTable(adapter, expected.table);
  if (signatureExists(meta.indexes, expected)) return;
  if (expected.primary && meta.indexes.some((index) => index.name === 'PRIMARY')) throw fail('MIGRATION_049_PRIMARY_KEY_CONFLICT', `A different primary key exists on ${expected.table}.`);
  const baseName = expected.name || `uq_${expected.table}_${expected.columns.join('_')}`;
  let name = baseName;
  if (meta.indexes.some((index) => index.name === name)) {
    name = `reconcile_${createHash('sha256').update(`${expected.table}:${expected.unique}:${expected.columns.join(',')}`).digest('hex').slice(0, 20)}`;
    if (meta.indexes.some((index) => index.name === name)) throw fail('MIGRATION_049_INDEX_CONFLICT', `A conflicting reconciliation index name exists on ${expected.table}.`);
  }
  const keyword = expected.unique ? 'UNIQUE ' : '';
  await executeSql(adapter, executeMigrationSql, `CREATE ${keyword}INDEX IF NOT EXISTS ${identifier(name)} ON ${identifier(expected.table)} (${expected.columns.map(identifier).join(', ')})`);
  executed.push(`index:${expected.table}.${name}`);
}

export async function inspect049Postconditions(adapter, sql, { createdTables = [] } = {}) {
  const contract = parseReconciliation049(sql);
  const missingTables = [];
  const missingColumns = [];
  const missingIndexes = [];
  const missingViews = [];
  const incompatibleViews = [];
  const foreignKeys = {};
  const tableMetadata = new Map();
  const created = new Set(createdTables);
  for (const [table, expected] of contract.tables) {
    if (!(await tableExists(adapter, table))) { missingTables.push(table); continue; }
    const actual = await inspectTable(adapter, table);
    tableMetadata.set(table, actual);
    const requiredColumns = new Set(contract.columns.get(table)?.keys() ?? []);
    if (created.has(table)) for (const column of expected.columns) requiredColumns.add(column);
    for (const column of requiredColumns) if (!actual.columns.has(column)) missingColumns.push(`${table}.${column}`);
    foreignKeys[table] = actual.foreignKeys;
  }
  // The existing production payments table uses amount_paid. amount is the
  // fresh-table spelling in the legacy CREATE declaration and is not required
  // for this existing table; the reporting view contract requires amount_paid.
  for (const [table, columns] of Object.entries({ student_fee_payments: ['amount_paid'] })) {
    const actual = tableMetadata.get(table);
    if (actual) for (const column of columns) if (!actual.columns.has(column)) missingColumns.push(`${table}.${column}`);
  }
  const missingForeignKeys = contract.foreignKeys.filter((expected) => !foreignKeys[expected.table]?.some(([column, referencedTable, referencedColumn]) => column === expected.column && referencedTable === expected.referencedTable && referencedColumn === expected.referencedColumn));
  for (const expected of contract.indexes) {
    if (!(await tableExists(adapter, expected.table))) { missingIndexes.push(`${expected.table}:${expected.columns.join(',')}`); continue; }
    const actual = await inspectTable(adapter, expected.table);
    if (!signatureExists(actual.indexes, expected)) missingIndexes.push(`${expected.table}:${expected.columns.join(',')}:${expected.unique ? 'unique' : 'index'}`);
  }
  for (const view of contract.views) {
    const actual = await inspectView(adapter, view.name);
    if (!actual) missingViews.push(view.name);
    else if (!isViewCompatible(view.name, actual)) incompatibleViews.push(view.name);
  }
  return { complete: !missingTables.length && !missingColumns.length && !missingIndexes.length && !missingViews.length && !incompatibleViews.length && !missingForeignKeys.length, missingTables, missingColumns, missingIndexes, missingViews, incompatibleViews, missingForeignKeys, foreignKeys };
}

export async function reconcile049(adapter, executeMigrationSql, sql) {
  const contract = parseReconciliation049(sql);
  const executed = [];
  const createdTables = [];
  for (const [table, expected] of contract.tables) {
    if (await tableExists(adapter, table)) continue;
    if (!expected.statement) throw fail('MIGRATION_049_TABLE_CONTRACT_MISSING', `No safe create statement exists for ${table}.`);
    await executeSql(adapter, executeMigrationSql, expected.statement);
    executed.push(`table:${table}`);
    createdTables.push(table);
  }
  for (const [table, fields] of contract.columns) {
    for (const [column, statement] of fields) {
      const current = await inspectTable(adapter, table);
      if (current.columns.has(column)) continue;
      await executeSql(adapter, executeMigrationSql, statement);
      executed.push(`column:${table}.${column}`);
    }
  }
  const uniqueIndexes = new Map();
  for (const expected of contract.indexes) {
    const signature = `${expected.table}:${expected.unique}:${expected.columns.join(',')}`;
    if (!uniqueIndexes.has(signature)) uniqueIndexes.set(signature, expected);
  }
  for (const expected of uniqueIndexes.values()) await ensureIndex(adapter, executeMigrationSql, expected, executed);
  for (const view of contract.views) {
    const actual = await inspectView(adapter, view.name);
    if (isViewCompatible(view.name, actual)) continue;
    const statement = actual ? view.statement : view.statement.replace(/^CREATE\s+OR\s+REPLACE\s+VIEW/i, 'CREATE VIEW');
    await executeSql(adapter, executeMigrationSql, statement);
    executed.push(`view:${view.name}`);
  }
  const postconditions = await inspect049Postconditions(adapter, sql, { createdTables });
  if (!postconditions.complete) throw fail('MIGRATION_049_POSTCONDITION_FAILED', 'Migration 049 reconciliation did not satisfy its complete postcondition contract.', postconditions);
  return { executed, createdTables, postconditions };
}

export async function verify054Postconditions(adapter) {
  const required = {
    students: ['current_class_id'],
    student_profiles: ['school_id','student_master_id','student_id','enrollment_status','updated_at'],
    parent_student_links: ['permanent_student_id','relationship_type','link_status','updated_at'],
    student_enrollments: ['school_id','enrollment_status','is_current']
  };
  const missing = [];
  const actual = {};
  for (const [table, columns] of Object.entries(required)) {
    const state = await inspectTable(adapter, table); actual[table] = state;
    for (const column of columns) if (!state.columns.has(column)) missing.push(`${table}.${column}`);
  }
  const has = (table, columns) => signatureExists(actual[table].indexes, { unique: false, columns });
  const missingIndexes = [];
  if (!has('student_profiles', ['school_id','student_master_id'])) missingIndexes.push('student_profiles(school_id,student_master_id)');
  if (!has('student_profiles', ['school_id','student_id'])) missingIndexes.push('student_profiles(school_id,student_id)');
  if (!has('student_enrollments', ['school_id','academic_year_id','class_id','is_current','enrollment_status'])) missingIndexes.push('student_enrollments(school_id,academic_year_id,class_id,is_current,enrollment_status)');
  const profileIds = actual.student_profiles.columns;
  const fks = await adapter.query('SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?) AND REFERENCED_TABLE_NAME IS NOT NULL', ['student_profiles','student_enrollments','students','parent_student_links']);
  const requiredFks = [['student_profiles','student_master_id','students','id'],['student_profiles','school_id','schools','id'],['student_enrollments','student_id','students','id'],['student_enrollments','class_id','classes','id'],['student_enrollments','academic_year_id','academic_years','id']];
  const missingFks = requiredFks.filter(([table,column,target,ref]) => !fks.some((fk) => fk.tableName === table && fk.columnName === column && fk.referencedTable === target && fk.referencedColumn === ref));
  const idColumns = await adapter.query('SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['students']);
  const canonicalPresent = idColumns.some((row) => row.columnName === 'permanent_student_id');
  const profileDuplicateAbsent = !profileIds.has('permanent_student_id');
  if (!signatureExists(actual.students.indexes, { unique: true, columns: ['permanent_student_id'] })) missingIndexes.push('students(permanent_student_id) UNIQUE');
  const mappingExists = await tableExists(adapter, 'class_subjects');
  const mapping = mappingExists ? await inspectTable(adapter, 'class_subjects') : { columns: new Set() };
  if (!mappingExists || !mapping.columns.has('class_id') || !mapping.columns.has('subject_id')) missing.push('class_subjects(class_id,subject_id)');
  if (missing.length || missingIndexes.length || missingFks.length || !canonicalPresent || !profileDuplicateAbsent) throw fail('MIGRATION_054_POSTCONDITION_FAILED', 'Corrected migration 054 postconditions failed.', { missing, missingIndexes, missingFks, canonicalPermanentStudentIdPresent: canonicalPresent, profilePermanentStudentIdAbsent: profileDuplicateAbsent });
  return { verifiedTables: [...Object.keys(required), 'class_subjects'], permanentStudentIdSource: 'students.permanent_student_id', profileDuplicateIdentityAbsent: profileDuplicateAbsent, enrollmentMapping: 'class_subjects-compatible', subjectClassAssignmentsRequired: false };
}

export async function verifyMigrationLedger(adapter, expected = [49,50,51,52,53,54,55,56]) {
  const rows = await adapter.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
  const versions = new Set(rows.map((row) => Number(row.version)));
  const missing = expected.filter((version) => !versions.has(version));
  const unexpected = rows.map((row) => Number(row.version)).filter((version) => version > 56);
  if (missing.length || unexpected.length) throw fail('FINAL_MIGRATION_LEDGER_FAILED', 'Final migration ledger does not match the required 049–056 chain.', { missing, unexpected });
  return { verified: expected, unexpected };
}
