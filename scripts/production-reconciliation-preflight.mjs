import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const migrationName = '049_production_schema_reconciliation.sql';
const migration = await readFile(new URL(`../schema/${migrationName}`, import.meta.url), 'utf8');
const normalize = (value) => String(value ?? '').replaceAll('`', '').trim().toLowerCase();
const unique = (items) => [...new Set(items)];
const tablesInMigration = unique([...migration.matchAll(/create\s+table\s+if\s+not\s+exists\s+`?([a-z0-9_]+)`?/gi)].map((m) => normalize(m[1])));
const columnsInMigration = unique([...migration.matchAll(/alter\s+table\s+`?([a-z0-9_]+)`?\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?`?([a-z0-9_]+)`?/gi)].map((m) => `${normalize(m[1])}.${normalize(m[2])}`));
const indexesInMigration = unique([...migration.matchAll(/create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+`?([a-z0-9_]+)`?\s+on\s+`?([a-z0-9_]+)`?/gi)].map((m) => `${normalize(m[2])}.${normalize(m[1])}`));
const viewsInMigration = unique([...migration.matchAll(/create\s+or\s+replace\s+view\s+`?([a-z0-9_]+)`?/gi)].map((m) => normalize(m[1])));
const destructive = [...migration.matchAll(/\b(drop\s+(?:table|database|index|column)|truncate|delete\s+from|update\s+|insert\s+into)\b/gi)].map((m) => m[1].toUpperCase());
const logicalRelationshipsToCheck = [
  ['attendance_audit_history', 'school_id', 'schools', 'id'], ['attendance_audit_history', 'changed_by', 'users', 'id'],
  ['staff_attendance_reconciliation_audit', 'school_id', 'schools', 'id'], ['staff_attendance_reconciliation_audit', 'leave_request_id', 'staff_leave', 'id'], ['staff_attendance_reconciliation_audit', 'staff_attendance_id', 'staff_attendance', 'id'], ['staff_attendance_reconciliation_audit', 'actor_id', 'users', 'id'],
  ['fee_collection_corrections', 'collection_id', 'fee_collection_records', 'id'],
  ['student_fee_accounts', 'school_id', 'schools', 'id'], ['student_fee_ledger', 'school_id', 'schools', 'id'], ['student_fee_ledger', 'account_id', 'student_fee_accounts', 'id'], ['student_fee_ledger', 'recorded_by', 'users', 'id'], ['student_fee_ledger', 'reversed_by', 'users', 'id'],
  ['fee_invoices', 'school_id', 'schools', 'id'], ['fee_invoices', 'account_id', 'student_fee_accounts', 'id'], ['fee_invoices', 'issued_by', 'users', 'id'], ['fee_invoices', 'created_by', 'users', 'id'], ['fee_invoices', 'updated_by', 'users', 'id'],
  ['fee_invoice_items', 'school_id', 'schools', 'id'], ['fee_invoice_items', 'invoice_id', 'fee_invoices', 'id'],
  ['student_fee_payments', 'school_id', 'schools', 'id'], ['student_fee_payments', 'account_id', 'student_fee_accounts', 'id'], ['student_fee_payments', 'invoice_id', 'fee_invoices', 'id'], ['student_fee_payments', 'received_by', 'users', 'id'], ['student_fee_payments', 'reversed_by', 'users', 'id'],
  ['student_fee_receipts', 'school_id', 'schools', 'id'], ['student_fee_receipts', 'payment_id', 'student_fee_payments', 'id'], ['student_fee_receipts', 'account_id', 'student_fee_accounts', 'id'], ['student_fee_receipts', 'issued_by', 'users', 'id'], ['student_fee_receipts', 'voided_by', 'users', 'id'],
  ['financial_audit_history', 'school_id', 'schools', 'id'], ['financial_audit_history', 'changed_by', 'users', 'id'], ['fee_types', 'school_id', 'schools', 'id']
];
const constraintsToCreate = ['uq_fee_obligation_scope', 'uq_student_fee_account_scope', 'uq_fee_invoice_number', 'uq_student_fee_payment_reference', 'uq_student_fee_receipt_number', 'uq_student_fee_receipt_payment', 'fee_types.school_id_code'];
const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'RECONCILIATION_PREFLIGHT_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } });

if (!process.env.DATABASE_URL) { process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`); process.exitCode = 1; }
else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[db]] = await pool.query('SELECT DATABASE() AS database_name');
    if (db?.database_name !== expectedDatabase) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const [tableRows] = await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const [columnRows] = await pool.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
    const [indexRows] = await pool.query('SELECT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()');
    const tables = new Set(tableRows.map((row) => normalize(row.TABLE_NAME)));
    const columns = new Set(columnRows.map((row) => `${normalize(row.TABLE_NAME)}.${normalize(row.COLUMN_NAME)}`));
    const indexes = new Set(indexRows.map((row) => `${normalize(row.TABLE_NAME)}.${normalize(row.INDEX_NAME)}`));
    const duplicates = {};
    const orphanCounts = {};
    const aggregate = async (key, sql) => { const [rows] = await pool.query(sql); duplicates[key] = Number(rows[0]?.duplicate_groups ?? 0); };
    const orphan = async (key, sql) => { const [rows] = await pool.query(sql); orphanCounts[key] = Number(rows[0]?.orphan_count ?? 0); };
    if (['student_attendance.school_id','student_attendance.academic_year','student_attendance.term','student_attendance.attendance_date','student_attendance.class_id','student_attendance.student_id','student_attendance.subject_key'].every((item) => columns.has(item))) await aggregate('student_attendance_scope_identity', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id, academic_year, term, attendance_date, class_id, student_id, subject_key FROM student_attendance GROUP BY school_id, academic_year, term, attendance_date, class_id, student_id, subject_key HAVING COUNT(*) > 1) d');
    if (['staff_attendance.school_id','staff_attendance.academic_year','staff_attendance.term','staff_attendance.attendance_date','staff_attendance.staff_id','staff_attendance.attendance_type'].every((item) => columns.has(item))) await aggregate('staff_attendance_scope_identity', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id, academic_year, term, attendance_date, staff_id, attendance_type FROM staff_attendance GROUP BY school_id, academic_year, term, attendance_date, staff_id, attendance_type HAVING COUNT(*) > 1) d');
    if (['student_fee_accounts.school_id','student_fee_accounts.permanent_student_id','student_fee_accounts.academic_year_id','student_fee_accounts.term_id'].every((item) => columns.has(item))) await aggregate('student_fee_account_scope', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id, permanent_student_id, academic_year_id, term_id FROM student_fee_accounts GROUP BY school_id, permanent_student_id, academic_year_id, term_id HAVING COUNT(*) > 1) d');
    if (['fee_collection_corrections.collection_id','fee_collection_records.id'].every((item) => columns.has(item))) await orphan('fee_collection_corrections.collection_id', 'SELECT COUNT(*) AS orphan_count FROM fee_collection_corrections c LEFT JOIN fee_collection_records r ON r.id = c.collection_id WHERE r.id IS NULL');
    if (['staff_attendance_reconciliation_audit.leave_request_id','staff_leave.id'].every((item) => columns.has(item))) await orphan('staff_attendance_reconciliation_audit.leave_request_id', 'SELECT COUNT(*) AS orphan_count FROM staff_attendance_reconciliation_audit a LEFT JOIN staff_leave l ON l.id = a.leave_request_id WHERE l.id IS NULL');
    if (['student_fee_ledger.account_id','student_fee_accounts.id'].every((item) => columns.has(item))) await orphan('student_fee_ledger.account_id', 'SELECT COUNT(*) AS orphan_count FROM student_fee_ledger l LEFT JOIN student_fee_accounts a ON a.id = l.account_id WHERE a.id IS NULL');
    if (['fee_invoices.account_id','student_fee_accounts.id'].every((item) => columns.has(item))) await orphan('fee_invoices.account_id', 'SELECT COUNT(*) AS orphan_count FROM fee_invoices i LEFT JOIN student_fee_accounts a ON a.id = i.account_id WHERE a.id IS NULL');
    if (['student_fee_payments.account_id','student_fee_accounts.id'].every((item) => columns.has(item))) await orphan('student_fee_payments.account_id', 'SELECT COUNT(*) AS orphan_count FROM student_fee_payments p LEFT JOIN student_fee_accounts a ON a.id = p.account_id WHERE a.id IS NULL');
    if (['student_fee_receipts.payment_id','student_fee_payments.id'].every((item) => columns.has(item))) await orphan('student_fee_receipts.payment_id', 'SELECT COUNT(*) AS orphan_count FROM student_fee_receipts r LEFT JOIN student_fee_payments p ON p.id = r.payment_id WHERE p.id IS NULL');
    if (['student_fee_receipts.account_id','student_fee_accounts.id'].every((item) => columns.has(item))) await orphan('student_fee_receipts.account_id', 'SELECT COUNT(*) AS orphan_count FROM student_fee_receipts r LEFT JOIN student_fee_accounts a ON a.id = r.account_id WHERE a.id IS NULL');
    const [viewRows] = await pool.query('SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()');
    const views = new Set(viewRows.map((row) => normalize(row.TABLE_NAME)));
    const potentiallyUnsafeOperations = Object.entries({ ...duplicates, ...orphanCounts }).filter(([, count]) => count > 0).map(([key, count]) => ({ key, count }));
    const plan = {
      tablesToCreate: tablesInMigration.filter((item) => !tables.has(item)),
      columnsToAdd: columnsInMigration.filter((item) => !columns.has(item)),
      indexesToCreate: indexesInMigration.filter((item) => !indexes.has(item)),
      foreignKeysToCreate: [],
      logicalRelationshipsToCheck,
      foreignKeyCompatibility: { enforcedInMigration: false, reason: 'TiDB does not support foreign keys on TEXT columns used by the existing identifier contract; relationships are checked read-only for orphan rows.' },
      constraintsToCreate,
      viewsToCreateOrReplace: viewsInMigration,
      existingObjects: { tables: tablesInMigration.filter((item) => tables.has(item)), views: viewsInMigration.filter((item) => views.has(item)), indexes: indexesInMigration.filter((item) => indexes.has(item)) },
      backfills: [],
      duplicateGroups: duplicates,
      orphanCounts,
      potentiallyUnsafeOperations,
      destructiveOperations: destructive,
      existingTablesAltered: unique(columnsInMigration.filter((item) => columns.has(item)).map((item) => item.split('.')[0]))
    };
    const result = { ok: true, mode: 'READ_ONLY_PREFLIGHT', connectedDatabase: db.database_name, migration: migrationName, plan, destructiveOperationCount: destructive.length, dropTableCount: destructive.filter((item) => item.startsWith('DROP TABLE')).length, truncateCount: destructive.filter((item) => item === 'TRUNCATE').length, deleteCount: destructive.filter((item) => item.startsWith('DELETE')).length, sensitiveRowsRead: false };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (destructive.length || potentiallyUnsafeOperations.length) process.exitCode = 2;
  } catch (error) { process.stdout.write(`${JSON.stringify(safeError(error))}\n`); process.exitCode = 1; }
  finally { await pool.end(); }
}
