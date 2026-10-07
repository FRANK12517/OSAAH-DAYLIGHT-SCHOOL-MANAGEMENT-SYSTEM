import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const EXPECTED_059_INDEX_COLUMNS = ['student_id', 'academic_year_id', 'class_id'];
const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE|CALL|SET|DO|GRANT|REVOKE)\b/i;

async function select(connection, sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql) || WRITE_WORDS.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error('Diagnostic permits only a single SELECT statement per query.');
  }
  const [rows] = await connection.query(sql, params);
  return rows;
}

function groupIndexes(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.name)) {
      grouped.set(row.name, { name: row.name, unique: Number(row.nonUnique) === 0, orderedColumns: [] });
    }
    grouped.get(row.name).orderedColumns.push({
      name: row.columnName,
      prefixLength: row.prefixLength === null ? null : Number(row.prefixLength)
    });
  }
  return [...grouped.values()];
}

async function inspectTable(connection, tableName) {
  const existsRows = await select(connection, `SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
  if (existsRows.length === 0) return { status: 'ABSENT' };

  const columns = await select(connection, `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type,
      IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue,
      GENERATION_EXPRESSION AS generatedExpression
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION`, [tableName]);

  const primaryRows = await select(connection, `SELECT COLUMN_NAME AS columnName
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = 'PRIMARY' AND REFERENCED_TABLE_NAME IS NULL
    ORDER BY ORDINAL_POSITION`, [tableName]);

  const uniqueRows = await select(connection, `SELECT tc.CONSTRAINT_NAME AS name,
      kcu.COLUMN_NAME AS columnName, kcu.ORDINAL_POSITION AS ordinalPosition
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.KEY_COLUMN_USAGE kcu
      ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND kcu.TABLE_NAME = tc.TABLE_NAME
      AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = ?
      AND tc.CONSTRAINT_TYPE = 'UNIQUE'
    ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, [tableName]);

  const indexRows = await select(connection, `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS sequenceInIndex, COLUMN_NAME AS columnName, SUB_PART AS prefixLength
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [tableName]);

  const foreignRows = await select(connection, `SELECT CONSTRAINT_NAME AS constraintName,
      COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTable,
      REFERENCED_COLUMN_NAME AS referencedColumn, ORDINAL_POSITION AS ordinalPosition
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`, [tableName]);

  const uniqueConstraints = new Map();
  for (const row of uniqueRows) {
    if (!uniqueConstraints.has(row.name)) uniqueConstraints.set(row.name, []);
    uniqueConstraints.get(row.name).push(row.columnName);
  }

  return {
    status: 'PRESENT',
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      default: column.defaultValue,
      generatedExpression: column.generatedExpression || null
    })),
    primaryKey: primaryRows.map((row) => row.columnName),
    uniqueConstraints: [...uniqueConstraints].map(([name, orderedColumns]) => ({ name, orderedColumns })),
    indexes: groupIndexes(indexRows),
    foreignKeys: foreignRows.map((row) => ({
      constraint: row.constraintName,
      column: row.columnName,
      referencedTable: row.referencedTable,
      referencedColumn: row.referencedColumn
    }))
  };
}

export async function collectDiagnostic(connection) {
  const [database] = await select(connection, 'SELECT DATABASE() AS databaseName');
  if (database?.databaseName !== EXPECTED_DATABASE) {
    throw Object.assign(new Error('Protected database target did not match the expected production database.'), {
      code: 'DATABASE_TARGET_MISMATCH'
    });
  }

  const indexRows = await select(connection, `SELECT COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequenceInIndex
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_enrollments'
      AND INDEX_NAME = 'idx_student_enrollments_compat_scope'
    ORDER BY SEQ_IN_INDEX`);
  const orderedColumns = indexRows.map((row) => row.columnName);
  const indexResult = {
    orderedColumns,
    classification: orderedColumns.length === EXPECTED_059_INDEX_COLUMNS.length &&
      orderedColumns.every((column, index) => column === EXPECTED_059_INDEX_COLUMNS[index])
      ? '059_INDEX_MATCH_CURRENT'
      : '059_INDEX_MISMATCH'
  };

  const migration067 = await inspectTable(connection, 'academic_result_records');
  const migration068 = await inspectTable(connection, 'academic_score_records');
  const competingRows = await select(connection, `SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canonical_academic_scores'`);

  return {
    '059Index': indexResult,
    migration067,
    migration068,
    canonicalAcademicScores: competingRows.length === 0 ? 'ABSENT' : 'PRESENT',
    productionWrites: 'NONE'
  };
}

function safeFailure(error) {
  return {
    error: {
      code: error?.code ?? 'METADATA_DIAGNOSTIC_FAILED',
      sqlState: error?.sqlState ?? null,
      errno: error?.errno ?? null
    },
    productionWrites: 'NONE'
  };
}

export async function runDiagnostic({ databaseUrl = process.env.DATABASE_URL, output = process.stdout } = {}) {
  if (!databaseUrl) {
    output.write(`${JSON.stringify({ error: { code: 'DATABASE_URL_MISSING' }, productionWrites: 'NONE' })}\n`);
    return false;
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      uri: databaseUrl,
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectTimeout: 15000
    });
    output.write(`${JSON.stringify(await collectDiagnostic(connection))}\n`);
    return true;
  } catch (error) {
    output.write(`${JSON.stringify(safeFailure(error))}\n`);
    return false;
  } finally {
    if (connection) await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!(await runDiagnostic())) process.exitCode = 1;
}
