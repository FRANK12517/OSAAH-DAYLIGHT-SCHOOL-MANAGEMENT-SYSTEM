import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized = (value, kind) => {
  if (value === null || value === undefined || value === '') return null;
  if (kind === 'date') return String(value).slice(0, 10);
  if (kind === 'timestamp') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? `INVALID:${String(value)}` : date.toISOString();
  }
  return value;
};
const keyFor = (row, columns) => columns.length === 1 ? row?.[columns[0]] : columns.map((column) => row?.[column]);
const keyHash = (key) => sha(key);

function tableRows(snapshot, table) {
  const entry = snapshot?.tables?.[table];
  if (!entry || !Array.isArray(entry.rows)) throw new Error(`Snapshot table ${table} must contain a rows array.`);
  const pk = Array.isArray(entry.primaryKey) ? entry.primaryKey : [entry.primaryKey];
  if (!pk.length || pk.some((column) => typeof column !== 'string' || !column)) throw new Error(`Snapshot table ${table} has no valid primaryKey.`);
  return { entry, rows: entry.rows, pk };
}

export function reconcileSnapshots(source, target) {
  if (!source || !target || !source.tables || !target.tables) throw new Error('Both snapshots must have a tables object.');
  const tableNames = [...new Set([...Object.keys(source.tables), ...Object.keys(target.tables)])].sort();
  const tables = {};
  for (const table of tableNames) {
    if (!source.tables[table] || !target.tables[table]) {
      tables[table] = { status: 'MISMATCH', reason: source.tables[table] ? 'MISSING_TARGET_TABLE' : 'MISSING_SOURCE_TABLE' };
      continue;
    }
    const src = tableRows(source, table), dst = tableRows(target, table);
    if (JSON.stringify(src.pk) !== JSON.stringify(dst.pk)) throw new Error(`Primary-key definition differs for ${table}.`);
    const srcKeys = src.rows.map((row) => keyFor(row, src.pk)), dstKeys = dst.rows.map((row) => keyFor(row, dst.pk));
    const srcSet = new Set(srcKeys.map(keyHash)), dstSet = new Set(dstKeys.map(keyHash));
    const duplicateSourceKeys = srcKeys.filter((key, i) => srcKeys.findIndex((item) => keyHash(item) === keyHash(key)) !== i).map(keyHash);
    const duplicateTargetKeys = dstKeys.filter((key, i) => dstKeys.findIndex((item) => keyHash(item) === keyHash(key)) !== i).map(keyHash);
    const missingTargetKeys = [...srcSet].filter((key) => !dstSet.has(key));
    const extraTargetKeys = [...dstSet].filter((key) => !srcSet.has(key));
    const fields = new Set([...(src.entry.dateColumns ?? []).map((column) => `date:${column}`), ...(dst.entry.dateColumns ?? []).map((column) => `date:${column}`), ...(src.entry.timestampColumns ?? []).map((column) => `timestamp:${column}`), ...(dst.entry.timestampColumns ?? []).map((column) => `timestamp:${column}`)]);
    const srcByKey = new Map(src.rows.map((row) => [keyHash(keyFor(row, src.pk)), row]));
    const dstByKey = new Map(dst.rows.map((row) => [keyHash(keyFor(row, dst.pk)), row]));
    const conversionMismatches = [];
    for (const key of [...srcSet].filter((item) => dstSet.has(item))) {
      for (const field of fields) {
        const [kind, column] = field.split(':');
        if (normalized(srcByKey.get(key)?.[column], kind) !== normalized(dstByKey.get(key)?.[column], kind)) conversionMismatches.push({ keyHash: key, column, kind });
      }
    }
    const aggregateColumns = new Set([...(src.entry.aggregateColumns ?? []), ...(dst.entry.aggregateColumns ?? [])]);
    const aggregate = {};
    for (const column of aggregateColumns) {
      const sum = (rows) => rows.reduce((total, row) => total + (row[column] == null ? 0 : Number(row[column])), 0);
      aggregate[column] = { source: sum(src.rows), target: sum(dst.rows), matches: sum(src.rows) === sum(dst.rows) };
    }
    tables[table] = {
      status: src.rows.length === dst.rows.length && !duplicateSourceKeys.length && !duplicateTargetKeys.length && !missingTargetKeys.length && !extraTargetKeys.length && !conversionMismatches.length && Object.values(aggregate).every((item) => item.matches) ? 'MATCH' : 'MISMATCH',
      sourceRows: src.rows.length, targetRows: dst.rows.length,
      duplicateSourceKeys: [...new Set(duplicateSourceKeys)], duplicateTargetKeys: [...new Set(duplicateTargetKeys)],
      missingTargetKeys, extraTargetKeys, conversionMismatches, aggregate
    };
  }
  const foreignKeys = [];
  for (const [table, definition] of Object.entries(source.tables)) {
    if (!target.tables[table]) continue;
    for (const fk of definition.foreignKeys ?? []) {
      const parentTable = fk.references?.table, parentColumn = fk.references?.column;
      if (!parentTable || !parentColumn || !target.tables[parentTable] || !source.tables[parentTable]) {
        foreignKeys.push({ table, column: fk.column, status: 'UNVERIFIABLE_REFERENCE' });
        continue;
      }
      const childRows = tableRows(target, table).rows;
      const parentRows = tableRows(target, parentTable).rows;
      const parents = new Set(parentRows.map((row) => keyHash(row[parentColumn])));
      const orphans = childRows.filter((row) => row[fk.column] != null && !parents.has(keyHash(row[fk.column]))).map((row) => keyHash(keyFor(row, tableRows(target, table).pk)));
      foreignKeys.push({ table, column: fk.column, references: { table: parentTable, column: parentColumn }, status: orphans.length ? 'MISMATCH' : 'MATCH', orphanKeyHashes: orphans });
    }
  }
  const mismatches = Object.values(tables).filter((item) => item.status !== 'MATCH').length + foreignKeys.filter((item) => item.status !== 'MATCH').length;
  return { formatVersion: 1, generatedAt: new Date().toISOString(), source: source.metadata ?? null, target: target.metadata ?? null, status: mismatches ? 'MISMATCH' : 'MATCH', mismatchCount: mismatches, tables, foreignKeys };
}

async function main(args) {
  if (args.length < 2 || args.length > 3) throw new Error('Usage: node scripts/reconcile-postgres-snapshots.mjs <source-snapshot.json> <target-snapshot.json> [report.json]');
  const sourcePath = resolve(args[0]), targetPath = resolve(args[1]);
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const target = JSON.parse(await readFile(targetPath, 'utf8'));
  const report = reconcileSnapshots(source, target);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args[2]) await writeFile(resolve(args[2]), output, { flag: 'wx' });
  else process.stdout.write(output);
  if (report.status !== 'MATCH') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
