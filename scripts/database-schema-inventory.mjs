import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const schemaDirectory = resolve(root, 'schema');
const sourceDirectory = resolve(root, 'src');
const outputFile = resolve(root, 'docs/database-schema-inventory.md');
const migrationFiles = (await readdir(schemaDirectory)).filter((name) => /^\d+_.*\.sql$/i.test(name)).sort();

function splitTopLevel(value) {
  const items = [];
  let start = 0, depth = 0, quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { items.push(value.slice(start, index).trim()); start = index + 1; }
  }
  if (value.slice(start).trim()) items.push(value.slice(start).trim());
  return items;
}

function createBlocks(sql) {
  const blocks = [];
  const startPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z_][\w$]*))/ig;
  for (const match of sql.matchAll(startPattern)) {
    const open = sql.indexOf('(', match.index + match[0].length);
    if (open < 0) continue;
    let depth = 0, quote = null, end = -1;
    for (let index = open; index < sql.length; index += 1) {
      const character = sql[index];
      if (quote) {
        if (character === quote && sql[index + 1] === quote) index += 1;
        else if (character === quote && sql[index - 1] !== '\\') quote = null;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) { end = index; break; }
    }
    if (end > open) blocks.push({ name: match[1] ?? match[2], body: sql.slice(open + 1, end) });
  }
  return blocks;
}

const tables = new Map();
function getTable(name) {
  if (!tables.has(name)) tables.set(name, { name, columns: new Map(), primaryKeys: [], foreignKeys: [], uniqueConstraints: [], indexes: new Map(), migrations: new Set(), modules: new Set() });
  return tables.get(name);
}
function addIndex(table, name, columns, { unique = false, primary = false } = {}) {
  const cleanColumns = columns.split(',').map((item) => item.trim().replace(/^`|`$/g, '').replace(/\s+.*$/, '')).filter(Boolean);
  if (primary) table.primaryKeys = cleanColumns;
  else if (unique) table.uniqueConstraints.push(`${name ?? 'UNIQUE'}(${cleanColumns.join(', ')})`);
  else if (name) table.indexes.set(name, cleanColumns);
}

for (const file of migrationFiles) {
  const sql = await readFile(resolve(schemaDirectory, file), 'utf8');
  for (const { name, body } of createBlocks(sql)) {
    const table = getTable(name); table.migrations.add(file);
    for (const item of splitTopLevel(body)) {
      let match;
      if ((match = item.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i))) { addIndex(table, 'PRIMARY', match[1], { primary: true }); continue; }
      if ((match = item.match(/^(?:CONSTRAINT\s+`?([\w]+)`?\s+)?UNIQUE(?:\s+(?:KEY|INDEX)\s+`?([\w]+)`?)?\s*\(([^)]+)\)/i))) { addIndex(table, match[2] ?? match[1], match[3], { unique: true }); continue; }
      if ((match = item.match(/^(?:CONSTRAINT\s+`?([\w]+)`?\s+)?(?:KEY|INDEX)\s+`?([\w]+)`?\s*\(([^)]+)\)/i))) { addIndex(table, match[2] ?? match[1], match[3]); continue; }
      if ((match = item.match(/^(?:CONSTRAINT\s+`?([\w]+)`?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([\w]+)`?\s*\(([^)]+)\)/i))) { table.foreignKeys.push(`${match[2]} → ${match[3]}(${match[4]})`); continue; }
      if ((match = item.match(/^`?([\w]+)`?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/))) {
        const column = match[1], type = match[2].replace(/\s+/g, ' ').trim();
        table.columns.set(column, type);
        if (/\bPRIMARY\s+KEY\b/i.test(item)) addIndex(table, 'PRIMARY', column, { primary: true });
        if (/\bUNIQUE\b/i.test(item)) table.uniqueConstraints.push(`UNIQUE(${column})`);
        const ref = item.match(/REFERENCES\s+`?([\w]+)`?\s*\(\s*`?([\w]+)`?\s*\)/i);
        if (ref) table.foreignKeys.push(`${column} → ${ref[1]}(${ref[2]})`);
      }
    }
  }
  for (const match of sql.matchAll(/ALTER\s+TABLE\s+`?([\w]+)`?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?`?([\w]+)`?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/ig)) {
    const table = getTable(match[1]); table.migrations.add(file); table.columns.set(match[2], match[3].replace(/\s+/g, ' ').trim());
  }
  for (const match of sql.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([\w]+)`?\s+ON\s+`?([\w]+)`?\s*\(([^)]+)\)/ig)) {
    const table = getTable(match[3]); table.migrations.add(file);
    if (match[1]) table.uniqueConstraints.push(`${match[2]}(${match[4]})`);
    else table.indexes.set(match[2], match[4].split(',').map((column) => column.trim().replace(/^`|`$/g, '')));
  }
  for (const match of sql.matchAll(/ALTER\s+TABLE\s+`?([\w]+)`?\s+ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([\w]+)`?\s*\(([^)]+)\)/ig)) {
    const table = getTable(match[1]); table.migrations.add(file);
    if (/ADD\s+UNIQUE/i.test(match[0])) table.uniqueConstraints.push(`${match[2]}(${match[3]})`);
    else table.indexes.set(match[2], match[3].split(',').map((column) => column.trim().replace(/^`|`$/g, '')));
  }
}

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(path));
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name) && !/database-schema-inventory\.mjs$/.test(entry.name)) found.push(path);
  }
  return found;
}

const files = await sourceFiles(sourceDirectory);
const contents = await Promise.all(files.map(async (path) => [relative(root, path).replaceAll('\\', '/'), await readFile(path, 'utf8')]));
for (const table of tables.values()) {
  const escaped = table.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  for (const [path, source] of contents) if (pattern.test(source)) table.modules.add(path);
}

const rows = [...tables.values()].sort((a, b) => a.name.localeCompare(b.name));
const lines = [
  '# Database schema inventory',
  '',
  `Generated from ${migrationFiles.length} numbered SQL migrations in \`schema/\` and ${files.length} runtime source files. It records ${rows.length} distinct table names encountered in CREATE/ALTER/INDEX DDL.`,
  '',
  '> This is a repository-derived inventory, not a live TiDB schema report. “Runtime references” are lexical source-file matches, not proof that every match is a SQL operation. Repeated and historical definitions are retained as migration provenance. Confirm every item against read-only production metadata before applying migrations.',
  '',
  '| Table | Columns (name: type) | Primary key | Foreign keys | Unique constraints | Secondary indexes | Migration provenance | Runtime source references |',
  '|---|---|---|---|---|---|---|---|'
];
const cell = (value) => String(value || '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
for (const table of rows) {
  const columns = [...table.columns].map(([name, type]) => `${name}: ${type}`).join('<br>');
  lines.push(`| \`${table.name}\` | ${cell(columns)} | ${cell(table.primaryKeys.join(', '))} | ${cell([...new Set(table.foreignKeys)].join('<br>'))} | ${cell([...new Set(table.uniqueConstraints)].join('<br>'))} | ${cell([...table.indexes].map(([name, cols]) => `${name}(${Array.isArray(cols) ? cols.join(', ') : cols})`).join('<br>'))} | ${cell([...table.migrations].sort().join('<br>'))} | ${cell([...table.modules].sort().join('<br>'))} |`);
}
lines.push('', '## Migration files', '', ...migrationFiles.map((file) => `- \`${file}\``), '');
await writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`Wrote ${relative(root, outputFile)} with ${rows.length} tables from ${migrationFiles.length} migrations.\n`);
