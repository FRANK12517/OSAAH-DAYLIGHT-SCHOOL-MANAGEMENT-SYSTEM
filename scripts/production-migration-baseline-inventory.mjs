import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const directory = resolve(new URL('../schema', import.meta.url).pathname);
const filePattern = /^(\d+)_([^.]+)\.sql$/;
const normalize = (value) => String(value ?? '').replaceAll('`', '').trim().toLowerCase();
const unique = (items) => [...new Set(items.filter(Boolean))];

function parseEffects(name, sql) {
  const tables = unique([...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?`?([a-z0-9_]+)`?/gi)].map((match) => normalize(match[1])));
  const columns = unique([...sql.matchAll(/alter\s+table\s+`?([a-z0-9_]+)`?\s+add\s+(?:column\s+)?`?([a-z0-9_]+)`?/gi)].map((match) => `${normalize(match[1])}.${normalize(match[2])}`));
  const indexes = unique([
    ...[...sql.matchAll(/create\s+(?:unique\s+)?index\s+`?([a-z0-9_]+)`?\s+on\s+`?([a-z0-9_]+)`?/gi)].map((match) => `${normalize(match[2])}.${normalize(match[1])}`),
    ...[...sql.matchAll(/(?:key|index|unique\s+key)\s+`?([a-z0-9_]+)`?\s*\(/gi)].map((match) => normalize(match[1]))
  ]);
  const foreignKeys = unique([...sql.matchAll(/foreign\s+key\s*\(\s*`?([a-z0-9_]+)`?\s*\)\s+references\s+`?([a-z0-9_]+)`?\s*\(\s*`?([a-z0-9_]+)`?/gi)].map((match) => `${normalize(match[2])}.${normalize(match[1])}->${normalize(match[3])}`));
  const views = unique([...sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+`?([a-z0-9_]+)`?/gi)].map((match) => normalize(match[1])));
  const triggers = unique([...sql.matchAll(/create\s+trigger\s+`?([a-z0-9_]+)`?/gi)].map((match) => normalize(match[1])));
  const dataOperations = unique([...sql.matchAll(/\b(insert\s+into|update|delete\s+from|replace\s+into)\b/gi)].map((match) => match[1].toUpperCase()));
  const drops = unique([...sql.matchAll(/\bdrop\s+(table|column|index|constraint)\b/gi)].map((match) => match[1].toUpperCase()));
  return { name, tables, columns, indexes, foreignKeys, views, triggers, dataOperations, drops };
}

async function loadManifest() {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort((a, b) => Number(a.slice(0, 3)) - Number(b.slice(0, 3)));
  const migrations = [];
  for (const name of names) {
    const match = filePattern.exec(name);
    if (!match) continue;
    const sql = await readFile(resolve(directory, name), 'utf8');
    migrations.push({ version: Number(match[1]), ...parseEffects(name, sql) });
  }
  return migrations;
}

function safeFailure(error) {
  return { ok: false, error: { code: error?.code ?? 'DATABASE_BASELINE_INVENTORY_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } };
}

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const manifest = await loadManifest();
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    const database = databaseRow?.database_name ?? null;
    const [tableRows] = await pool.query('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    const [columnRows] = await pool.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
    const [statisticRows] = await pool.query('SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX');
    const [constraintRows] = await pool.query('SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME');
    const [keyRows] = await pool.query('SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION');
    const tables = new Set(tableRows.map((row) => normalize(row.TABLE_NAME)));
    const columns = new Set(columnRows.map((row) => `${normalize(row.TABLE_NAME)}.${normalize(row.COLUMN_NAME)}`));
    const indexes = new Set(statisticRows.map((row) => `${normalize(row.TABLE_NAME)}.${normalize(row.INDEX_NAME)}`));
    const foreignKeys = new Set(keyRows.map((row) => `${normalize(row.REFERENCED_TABLE_NAME)}.${normalize(row.COLUMN_NAME)}->${normalize(row.REFERENCED_COLUMN_NAME)}`));
    const migrationCandidates = tableRows.map((row) => normalize(row.TABLE_NAME)).filter((name) => name.includes('migration'));
    const matrix = manifest.map((migration) => {
      const missingTables = migration.tables.filter((item) => !tables.has(item));
      const missingColumns = migration.columns.filter((item) => !columns.has(item));
      const missingIndexes = migration.indexes.filter((item) => item.includes('.') && !indexes.has(item));
      const missingForeignKeys = migration.foreignKeys.filter((item) => !foreignKeys.has(item));
      const missingEffects = { tables: missingTables, columns: missingColumns, indexes: missingIndexes, foreignKeys: missingForeignKeys, views: migration.views, triggers: migration.triggers, dataOperations: migration.dataOperations };
      const expectedCount = migration.tables.length + migration.columns.length + migration.indexes.filter((item) => item.includes('.')).length + migration.foreignKeys.length;
      const missingCount = missingTables.length + missingColumns.length + missingIndexes.length + missingForeignKeys.length;
      let status = 'MATERIALIZED';
      if (migration.dataOperations.length || migration.views.length || migration.triggers.length) status = missingCount === expectedCount && expectedCount > 0 ? 'MISSING' : 'NOT SAFELY DETERMINABLE';
      else if (missingCount === expectedCount && expectedCount > 0) status = 'MISSING';
      else if (missingCount > 0) status = 'PARTIALLY MATERIALIZED';
      else if (expectedCount === 0) status = 'NOT SAFELY DETERMINABLE';
      return { migration: migration.name, version: migration.version, status, evidence: { presentTables: migration.tables.filter((item) => tables.has(item)), presentColumns: migration.columns.filter((item) => columns.has(item)), presentIndexes: migration.indexes.filter((item) => item.includes('.') && indexes.has(item)), presentForeignKeys: migration.foreignKeys.filter((item) => foreignKeys.has(item)) }, missingEffects };
    });
    const result = {
      ok: true,
      connectedDatabase: database,
      expectedDatabase,
      databaseMatch: database === expectedDatabase,
      migrationCount: manifest.length,
      migrationHistoryTableCandidates: migrationCandidates,
      schemaCounts: { tables: tableRows.length, columns: columnRows.length, indexes: statisticRows.length, constraints: constraintRows.length, foreignKeys: keyRows.length },
      protectedMetadataOnly: true,
      matrix,
      summary: Object.fromEntries(['MATERIALIZED', 'PARTIALLY MATERIALIZED', 'MISSING', 'NOT SAFELY DETERMINABLE'].map((status) => [status, matrix.filter((item) => item.status === status).map((item) => item.migration)])),
      sensitiveRowsRead: false
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailure(error))}\n`);
    process.exitCode = 1;
  } finally { await pool.end(); }
}
