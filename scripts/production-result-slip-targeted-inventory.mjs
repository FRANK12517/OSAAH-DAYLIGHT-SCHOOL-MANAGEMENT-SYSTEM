import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

export const EXPECTED_DATABASE = 'osaahdaylightschool';

// Bounded to tables directly changed by migrations 049/054 or needed to verify
// the Result Slip student and subject-mapping contracts.
export const TARGET_TABLES = Object.freeze([
  'student_attendance', 'staff_attendance', 'staff_leave',
  'attendance_audit_history', 'staff_attendance_reconciliation_audit',
  'fee_obligations', 'fee_collection_records', 'fee_collection_corrections',
  'student_fee_accounts', 'student_fee_ledger', 'fee_invoices', 'fee_invoice_items',
  'student_fee_payments', 'student_fee_receipts', 'financial_audit_history',
  'fee_types', 'fee_structures',
  'students', 'student_profiles', 'student_enrollments', 'parent_student_links',
  'class_subjects', 'subject_class_assignments'
]);

export const TARGET_VIEWS = Object.freeze([
  'vw_student_fee_balances', 'vw_fee_overview', 'vw_fee_arrears',
  'vw_published_fee_structures', 'vw_invoice_receipt_register',
  'vw_fee_collection_summary'
]);

const TARGET_OBJECTS = Object.freeze([...TARGET_TABLES, ...TARGET_VIEWS]);
const placeholders = (values) => values.map(() => '?').join(',');

function resultRows(result) {
  if (Array.isArray(result?.[0])) return result[0];
  return Array.isArray(result) ? result : [];
}

export function assertReadOnlyMetadataQuery(sql) {
  if (!/^\s*SELECT\b/i.test(sql)
    || !/(?:information_schema|DATABASE\s*\(\s*\))/i.test(sql)
    || /;\s*\S/.test(sql)) {
    throw new Error('Targeted inventory accepts only a single metadata SELECT query.');
  }
}

async function queryMetadata(pool, sql, params = []) {
  assertReadOnlyMetadataQuery(sql);
  return resultRows(await pool.query(sql, params));
}

export async function collectTargetedProductionMetadata(pool, {
  expectedDatabase = EXPECTED_DATABASE
} = {}) {
  const databaseRow = (await queryMetadata(pool, 'SELECT DATABASE() AS inspected_database'))[0];
  const connectedDatabase = databaseRow?.inspected_database ?? null;
  if (connectedDatabase !== expectedDatabase) {
    throw Object.assign(new Error('Connected database does not match the protected inventory target.'), {
      code: 'DATABASE_NAME_MISMATCH', connectedDatabase, expectedDatabase
    });
  }

  const inClause = placeholders(TARGET_OBJECTS);
  const params = TARGET_OBJECTS;
  const tableInventory = await queryMetadata(pool, `SELECT TABLE_NAME,TABLE_TYPE
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME`, params);
  const columns = await queryMetadata(pool, `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,
    COLUMN_DEFAULT,IS_NULLABLE,DATA_TYPE,COLUMN_TYPE,CHARACTER_MAXIMUM_LENGTH,
    NUMERIC_PRECISION,NUMERIC_SCALE,COLUMN_KEY,EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME,ORDINAL_POSITION`, params);
  const indexes = await queryMetadata(pool, `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,
    SEQ_IN_INDEX,COLUMN_NAME,INDEX_TYPE,SUB_PART
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`, params);
  const constraints = await queryMetadata(pool, `SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME,CONSTRAINT_TYPE,CONSTRAINT_NAME`, params);
  const keyColumnUsage = await queryMetadata(pool, `SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,
    ORDINAL_POSITION,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${inClause})
    ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`, params);
  const views = await queryMetadata(pool, `SELECT TABLE_NAME,VIEW_DEFINITION,CHECK_OPTION,
    IS_UPDATABLE,SECURITY_TYPE
    FROM information_schema.VIEWS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders(TARGET_VIEWS)})
    ORDER BY TABLE_NAME`, TARGET_VIEWS);

  const presentObjects = new Set(tableInventory.map((row) => row.TABLE_NAME));
  return {
    ok: true,
    connectedDatabase,
    expectedDatabase,
    databaseMatch: true,
    readOnly: true,
    queriedRowData: false,
    productionWrites: 'NONE',
    targetTables: TARGET_TABLES,
    targetViews: TARGET_VIEWS,
    absentTargetObjects: TARGET_OBJECTS.filter((name) => !presentObjects.has(name)),
    tableInventory,
    columns,
    indexes,
    constraints,
    keyColumnUsage,
    views
  };
}

function safeFailure(error) {
  return {
    ok: false,
    ...(error?.code === 'DATABASE_NAME_MISMATCH' ? {
      connectedDatabase: error.connectedDatabase,
      expectedDatabase: error.expectedDatabase,
      databaseMatch: false
    } : {}),
    error: {
      code: error?.code ?? 'TARGETED_DATABASE_INVENTORY_FAILED',
      errno: error?.errno ?? null,
      sqlState: error?.sqlState ?? null
    }
  };
}

export async function runTargetedProductionInventory({
  databaseUrl = process.env.DATABASE_URL,
  output = process.stdout
} = {}) {
  if (!databaseUrl) {
    output.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
    return false;
  }

  const pool = mysql.createPool({
    uri: databaseUrl,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  try {
    const result = await collectTargetedProductionMetadata(pool);
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return true;
  } catch (error) {
    output.write(`${JSON.stringify(safeFailure(error))}\n`);
    return false;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const succeeded = await runTargetedProductionInventory();
  if (!succeeded) process.exitCode = 1;
}

