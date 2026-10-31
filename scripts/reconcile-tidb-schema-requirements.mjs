import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = resolve(root, 'src');
const schemaRoot = resolve(root, 'schema');
const inventoryPath = resolve(root, 'docs/database-schema-inventory.md');
const manifestPath = resolve(root, 'docs/tidb-schema-requirements-manifest.json');
const reportPath = resolve(root, 'docs/tidb-canonical-schema-plan.md');

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (/\.(?:mjs|cjs|js|ts)$/.test(entry.name)) result.push(path);
  }
  return result.sort();
}

function inventoryRows(markdown) {
  const tables = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 8) continue;
    const name = cells[0].match(/^`([^`]+)`$/)?.[1];
    if (!name) continue;
    const columns = [...cells[1].matchAll(/`?([a-zA-Z_][\w$]*)`?:\s*([^<]+?)(?=<br>|$)/g)].map((match) => ({ name: match[1], observedType: match[2].trim() }));
    const decodeList = (cell) => cell.split(/<br\s*\/?\s*>/i).map((item) => item.replace(/^`|`$/g, '').trim()).filter((item) => item && item !== '—');
    const sourceFiles = decodeList(cells[7]).filter((item) => item.startsWith('src/'));
    tables.set(name, {
      name,
      historicalColumnCandidates: columns,
      historicalPrimaryKeyEvidence: decodeList(cells[2]),
      historicalForeignKeyEvidence: decodeList(cells[3]),
      historicalUniqueEvidence: decodeList(cells[4]),
      historicalIndexEvidence: decodeList(cells[5]),
      migrationFiles: decodeList(cells[6]),
      sourceFiles
    });
  }
  return tables;
}

function quotedSqlStrings(source) {
  const strings = [];
  for (let i = 0; i < source.length; i += 1) {
    const quote = source[i];
    if (!['\'', '"', '`'].includes(quote)) continue;
    const start = i + 1;
    let content = '', closed = false;
    for (i += 1; i < source.length; i += 1) {
      const character = source[i];
      if (character === '\\' && quote !== '`') { content += source[i + 1] ?? ''; i += 1; continue; }
      if (character === quote) {
        if (quote === '`' && source[i + 1] === '`') { content += '`'; i += 1; continue; }
        closed = true; break;
      }
      content += character;
    }
    if (!closed) break;
    const selectSql = /^\s*SELECT\b/i.test(content)
      && /^\s*SELECT\s+[\s\S]+?\s+FROM\s+`?[A-Za-z_][\w$]*`?(?:\s+(?:AS\s+)?[A-Za-z_][\w$]*)?\s*(?=WHERE\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|CROSS\b|ORDER\b|GROUP\b|HAVING\b|LIMIT\b|FOR\b|UNION\b|;|$)/i.test(content);
    if (selectSql || /^\s*(?:WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(content)) strings.push({ content, offset: start });
  }
  return strings;
}

function cleanIdentifier(value) { return value.replace(/^[`"[]|[`"\]]$/g, '').replace(/^\w+\./, ''); }
function operationColumns(sql, operation, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableToken = `(?:\\x60)?${escaped}(?:\\x60)?`;
  if (operation === 'insert') {
    const match = sql.match(new RegExp(`\\b(?:INSERT\\s+(?:IGNORE\\s+)?)?INTO\\s+${tableToken}\\s*\\(([^)]+)\\)`, 'i'));
    return match ? match[1].split(',').map((column) => cleanIdentifier(column.trim())).filter((column) => /^[A-Za-z_][\\w$]*$/.test(column)) : [];
  }
  if (operation === 'update') {
    const match = sql.match(new RegExp(`^\\s*UPDATE\\s+${tableToken}\\s+SET\\s+([\\s\\S]*?)(?:\\bWHERE\\b|;|$)`, 'i'));
    if (!match) return [];
    return [...match[1].matchAll(/(?:^|,)\s*`?([A-Za-z_][\w$]*)`?\s*=/g)].map((item) => item[1]);
  }
  return [];
}

function sqlEvidence(source, sourcePath) {
  const operations = [];
  const patterns = [
    ['insert', /\bINSERT\s+(?:IGNORE\s+)?INTO\s+(`?[A-Za-z_][\w$]*`?)/ig],
    ['insert', /\bREPLACE\s+INTO\s+(`?[A-Za-z_][\w$]*`?)/ig],
    ['update', /^\s*UPDATE\s+(`?[A-Za-z_][\w$]*`?)/ig],
    ['delete', /\bDELETE\s+FROM\s+(`?[A-Za-z_][\w$]*`?)/ig],
    ['read', /\bFROM\s+(`?[A-Za-z_][\w$]*`?)/ig],
    ['join', /\bJOIN\s+(`?[A-Za-z_][\w$]*`?)/ig]
  ];
  for (const { content, offset } of quotedSqlStrings(source)) {
    for (const [operation, pattern] of patterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const table = cleanIdentifier(match[1]);
        if (!/^[A-Za-z_][\w$]*$/.test(table)) continue;
        const line = source.slice(0, offset + (match.index ?? 0)).split('\n').length;
        const projection = operation === 'read' || operation === 'join' ? content.match(/\bSELECT\s+([\s\S]*?)\s+FROM\b/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null : null;
        operations.push({ table, operation, source: sourcePath, line, writeColumns: operationColumns(content, operation, table), selectProjectionEvidence: projection, parameterized: /\?|\$\d+/.test(content), statementPrefix: content.slice(0, 160).replace(/\s+/g, ' ').trim() });
      }
    }
  }
  return operations;
}

function historicalFacts(sqlFiles) {
  const facts = new Map();
  for (const { name, text } of sqlFiles) {
    const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][\w$]*)`?/ig;
    for (const match of text.matchAll(createPattern)) {
      const table = match[1];
      if (!facts.has(table)) facts.set(table, { createCount: 0, alterCount: 0, migrations: new Set(), sqliteMarkers: new Set(), tidbMarkers: new Set() });
      const fact = facts.get(table); fact.createCount += 1; fact.migrations.add(name);
    }
    for (const match of text.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z_][\w$]*)`?/ig)) {
      const table = match[1];
      if (!facts.has(table)) facts.set(table, { createCount: 0, alterCount: 0, migrations: new Set(), sqliteMarkers: new Set(), tidbMarkers: new Set() });
      const fact = facts.get(table); fact.alterCount += 1; fact.migrations.add(name);
    }
    const clean = text.replace(/--[^\r\n]*/g, ' ').toUpperCase();
    for (const [table, fact] of facts) {
      if (!fact.migrations.has(name)) continue;
      if (/\bPRAGMA\b|\bINSERT\s+OR\s+IGNORE\b|\bTEXT\s+PRIMARY\s+KEY\b/.test(clean)) fact.sqliteMarkers.add(name);
      if (/\bAUTO_INCREMENT\b|\bENGINE\s*=\s*INNODB\b|\bENUM\s*\(/.test(clean)) fact.tidbMarkers.add(name);
    }
  }
  return facts;
}

function splitSqlItems(value) {
  const items = []; let start = 0, depth = 0, quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (["'", '"', '`'].includes(character)) { quote = character; continue; }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { items.push(value.slice(start, index).trim()); start = index + 1; }
  }
  if (value.slice(start).trim()) items.push(value.slice(start).trim());
  return items;
}

function parseParallelPostgresDefinitions(sql, sourcePath) {
  const definitions = new Map();
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z_][\w$]*)"?\s*\(/ig;
  for (const match of sql.matchAll(pattern)) {
    const open = sql.indexOf('(', match.index + match[0].length - 1); let depth = 0, quote = null, end = -1;
    for (let index = open; index < sql.length; index += 1) {
      const character = sql[index];
      if (quote) {
        if (character === quote && sql[index + 1] === quote) index += 1;
        else if (character === quote && sql[index - 1] !== '\\') quote = null;
        continue;
      }
      if (["'", '"', '`'].includes(character)) { quote = character; continue; }
      if (character === '(') depth += 1;
      else if (character === ')' && --depth === 0) { end = index; break; }
    }
    if (end < 0) continue;
    const tableName = match[1], body = sql.slice(open + 1, end), columns = [], primaryKey = [], foreignKeys = [], unique = [];
    for (const item of splitSqlItems(body)) {
      const pk = item.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) { primaryKey.push(...pk[1].split(',').map(cleanIdentifier)); continue; }
      const fk = item.match(/(?:CONSTRAINT\s+"?([\w$]+)"?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:public\.)?"?([\w$]+)"?\s*\(([^)]+)\)/i);
      if (fk) { foreignKeys.push({ name: fk[1] ?? null, columns: fk[2].split(',').map(cleanIdentifier), referencedTable: fk[3], referencedColumns: fk[4].split(',').map(cleanIdentifier) }); continue; }
      if (/^(?:CONSTRAINT|UNIQUE\b|CHECK\b|FOREIGN\b|EXCLUDE\b)/i.test(item)) { if (/\bUNIQUE\b/i.test(item)) unique.push(item); continue; }
      const column = item.match(/^"?([A-Za-z_][\w$]*)"?\s+([\s\S]+)$/);
      if (!column) continue;
      const rawDefinition = column[2].trim();
      const typeCandidate = rawDefinition.match(/^([A-Za-z][A-Za-z ]*(?:\([^)]*\))?(?:\[\])?)/)?.[1]?.trim() ?? null;
      const nullable = /\bNOT\s+NULL\b/i.test(rawDefinition) ? false : /\bNULL\b/i.test(rawDefinition) ? true : null;
      const defaultDefinition = rawDefinition.match(/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|CHECK|REFERENCES|UNIQUE|GENERATED|COLLATE)\b|$)/i)?.[1] ?? null;
      const references = rawDefinition.match(/REFERENCES\s+(?:public\.)?"?([\w$]+)"?\s*\(\s*"?([\w$]+)"?\s*\)/i);
      if (/\bPRIMARY\s+KEY\b/i.test(rawDefinition)) primaryKey.push(column[1]);
      if (/\bUNIQUE\b/i.test(rawDefinition)) unique.push(`UNIQUE(${column[1]})`);
      if (references) foreignKeys.push({ name: null, columns: [column[1]], referencedTable: references[1], referencedColumns: [references[2]] });
      columns.push({ name: column[1], type: typeCandidate, nullable, defaultDefinition, rawDefinition });
    }
    if (!definitions.has(tableName)) definitions.set(tableName, []);
    definitions.get(tableName).push({ source: sourcePath, columns, primaryKey, foreignKeys, unique });
  }
  return definitions;
}

const inventory = inventoryRows(await readFile(inventoryPath, 'utf8'));
const files = (await sourceFiles(sourceRoot)).filter((path) => ![
  resolve(sourceRoot, 'platform/tidb-fresh-initializer.js'),
  resolve(sourceRoot, 'platform/tidb-schema-manifest.js')
].includes(path));
const sourceContents = await Promise.all(files.map(async (path) => ({ path, text: await readFile(path, 'utf8') })));
const runtimeOperations = sourceContents.flatMap(({ path, text }) => sqlEvidence(text, relative(root, path).replaceAll('\\', '/')));
const migrationFiles = (await readdir(schemaRoot)).filter((name) => /^\d+_.*\.sql$/i.test(name)).sort();
const migrationContents = await Promise.all(migrationFiles.map(async (name) => ({ name, text: await readFile(resolve(schemaRoot, name), 'utf8') })));
const history = historicalFacts(migrationContents);
const postgresEvidenceFiles = ['supabase/migrations/202610150001_osaah_daylight_schema.sql', 'supabase/migrations/202610150002_reconcile_existing_supabase.sql', 'supabase/migrations/202610280001_parent_sms_auth.sql'];
const postgresDefinitions = new Map();
for (const path of postgresEvidenceFiles) {
  const parsed = parseParallelPostgresDefinitions(await readFile(resolve(root, path), 'utf8'), path);
  for (const [name, definitions] of parsed) postgresDefinitions.set(name, [...(postgresDefinitions.get(name) ?? []), ...definitions]);
}
const runtimeNativeDdlPaths = ['src/ai/tidb-database-adapter.js', 'src/platform/tidb-fresh-initializer.js'];
const runtimeNativeDdl = new Map();
for (const path of runtimeNativeDdlPaths) {
  const parsed = parseParallelPostgresDefinitions(await readFile(resolve(root, path), 'utf8'), path);
  for (const [name, definitions] of parsed) runtimeNativeDdl.set(name, [...(runtimeNativeDdl.get(name) ?? []), ...definitions]);
}
const operationsByTable = new Map();
for (const operation of runtimeOperations) {
  const key = operation.table.toLowerCase();
  if (!operationsByTable.has(key)) operationsByTable.set(key, []);
  operationsByTable.get(key).push(operation);
}

const historicalTableNames = new Set([...inventory.keys(), ...history.keys()]);
const tableNames = new Set([...historicalTableNames, ...postgresDefinitions.keys(), ...runtimeNativeDdl.keys(), ...[...operationsByTable.keys()].map((name) => {
  const found = [...historicalTableNames, ...postgresDefinitions.keys(), ...runtimeNativeDdl.keys()].find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return found ?? name;
})]);
const tables = [...tableNames].sort().map((name) => {
  const historical = inventory.get(name) ?? {
    name, historicalColumnCandidates: [], historicalPrimaryKeyEvidence: [], historicalForeignKeyEvidence: [],
    historicalUniqueEvidence: [], historicalIndexEvidence: [], migrationFiles: [], sourceFiles: []
  };
  const operations = operationsByTable.get(name.toLowerCase()) ?? [];
  const historicalDefinition = history.get(name) ?? { createCount: 0, alterCount: 0, migrations: new Set(), sqliteMarkers: new Set(), tidbMarkers: new Set() };
  const nativeDdl = runtimeNativeDdl.get(name) ?? [];
  const legacyOptionalFallback = name === 'class_subjects';
  const sourceFilesUsed = [...new Set([...historical.sourceFiles, ...operations.map((operation) => operation.source), ...nativeDdl.map((definition) => definition.source)])].sort();
  const schemaEvidenceColumns = new Set([
    ...historical.historicalColumnCandidates.map((column) => column.name.toLowerCase()),
    ...(postgresDefinitions.get(name) ?? []).flatMap((definition) => definition.columns.map((column) => column.name.toLowerCase())),
    ...nativeDdl.flatMap((definition) => definition.columns.map((column) => column.name.toLowerCase()))
  ]);
  const runtimeWriteColumnsWithoutSchemaEvidence = [...new Set(operations.flatMap((operation) => operation.writeColumns))]
    .filter((column) => !schemaEvidenceColumns.has(column.toLowerCase())).sort();
  const classification = operations.length ? 'RUNTIME_SQL_CONFIRMED'
    : nativeDdl.length ? 'TIDB_NATIVE_PLATFORM_METADATA_DDL'
    : historical.sourceFiles.length ? 'RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED'
      : !historicalTableNames.has(name) && postgresDefinitions.has(name) ? 'PARALLEL_POSTGRES_BASELINE_ONLY_NOT_TIDB_CONFIRMED'
        : 'HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT';
  return {
    name,
    classification,
    runtimeRequiredness: legacyOptionalFallback
      ? 'OPTIONAL_LEGACY_COMPATIBILITY_FALLBACK_NOT_REQUIRED_FOR_FRESH_INSTALL'
      : operations.length ? 'RUNTIME_SQL_PRESENT_REQUIREDNESS_REQUIRES_WORKFLOW_REVIEW' : 'UNRESOLVED',
    runtimeModules: [...new Set(sourceFilesUsed.map((path) => path.replace(/^src\//, '').replace(/\.(?:mjs|cjs|js|ts)$/, '')))],
    sourceFiles: sourceFilesUsed,
    runtimeOperations: {
      read: operations.filter((item) => item.operation === 'read').length,
      join: operations.filter((item) => item.operation === 'join').length,
      insert: operations.filter((item) => item.operation === 'insert').length,
      update: operations.filter((item) => item.operation === 'update').length,
      delete: operations.filter((item) => item.operation === 'delete').length
    },
    runtimeSqlEvidence: operations,
    runtimeWriteColumns: [...new Set(operations.flatMap((operation) => operation.writeColumns))].sort(),
    runtimeWriteColumnsWithoutSchemaEvidence,
    historicalOrParallelColumnEvidenceCount: schemaEvidenceColumns.size,
    runtimeSelectProjectionEvidence: [...new Set(operations.map((operation) => operation.selectProjectionEvidence).filter(Boolean))],
    transactionSourceFiles: sourceContents.filter(({ path, text }) => /\.transaction\s*\(/.test(text) && new RegExp(`\\b${name}\\b`, 'i').test(text)).map(({ path }) => relative(root, path).replaceAll('\\', '/')),
    aggregationEvidence: [...new Set(operations.filter((operation) => /\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(|\bGROUP\s+BY\b/i.test(operation.statementPrefix)).map((operation) => operation.source))],
    historicalColumnCandidates: historical.historicalColumnCandidates,
    historicalPrimaryKeyEvidence: historical.historicalPrimaryKeyEvidence,
    historicalForeignKeyEvidence: historical.historicalForeignKeyEvidence,
    historicalUniqueEvidence: historical.historicalUniqueEvidence,
    historicalIndexEvidence: historical.historicalIndexEvidence,
    historicalCreateOccurrences: historicalDefinition.createCount,
    historicalAlterOccurrences: historicalDefinition.alterCount,
    historicalMigrations: [...new Set([...historical.migrationFiles, ...historicalDefinition.migrations])].sort(),
    parallelPostgresDefinitionEvidence: postgresDefinitions.get(name) ?? [],
    runtimeTiDBDefinitionEvidence: nativeDdl,
    status: 'UNRESOLVED_NOT_CANONICAL',
    unresolvedDimensions: ['authoritative current column types', 'nullability', 'defaults', 'current primary/unique/index constraints', 'current foreign keys and delete/update actions', 'query predicate and join-column requirements', 'transaction boundaries and retry/idempotency behavior', 'TiDB-specific DDL and runtime compatibility'],
    unresolved: [
      ...(!operations.length ? ['No statically extracted runtime SQL operation; verify indirect, dynamically composed, or workflow persistence.'] : []),
      'Historical merged column types do not establish current type, nullability, or defaults.',
      'Historical key and index evidence may be superseded or incomplete.',
      'TiDB DDL and current runtime compatibility require explicit review.'
    ]
  };
});

const viewNames = new Map();
for (const { name, text } of migrationContents) {
  for (const match of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?([A-Za-z_][\w$]*)`?/ig)) {
    if (!viewNames.has(match[1])) viewNames.set(match[1], []);
    viewNames.get(match[1]).push(name);
  }
}
const platformMetadataNames = new Set(['schema_migrations', 'schema_migration_lock', 'schema_baselines', 'schema_migration_runs', 'osaah_fresh_installations']);
const runtimeContractReconciliation = {
  dispositionTaxonomy: ['REQUIRED_CURRENT_RUNTIME', 'REQUIRED_SUPPORTED_WORKFLOW', 'LEGACY_COMPATIBILITY_ONLY', 'OBSOLETE_WITH_EVIDENCE', 'UNRESOLVED'],
  tableDispositions: tables.map((table) => {
    if (table.name === 'class_subjects') return { name: table.name, disposition: 'LEGACY_COMPATIBILITY_ONLY', evidence: ['src/durable-academic.js optional fallback', 'schema/054 describes installations that retain the legacy mapping'], unresolved: ['Fresh-install requirement is not established.'], missingEvidence: ['No product decision confirms whether installations retaining the optional compatibility fallback remain supported.', 'No fresh-install need or retirement evidence exists.'], whyRepositoryEvidenceIsInsufficient: 'An optional fallback and historical migration establish compatibility history, not a fresh-install requirement or supported lifecycle.', requiredExternalDecision: 'Product/academic-domain owner must decide whether to preserve this legacy fallback for supported deployments or retire it with a documented compatibility plan.', affectedWorkflowEvidence: ['src/durable-academic.js', 'schema/054'] };
    if (table.name === 'portal_users') return { name: table.name, disposition: 'REQUIRED_CURRENT_RUNTIME', evidence: ['src/server.mjs wires POST /api/auth/proprietor/login when a database adapter exists', 'src/proprietor-authentication-controller.js selects id, portal_name, email, password_hash, role, is_active', 'PostgreSQL baselines define a separate portal_users table'], unresolved: ['No numbered TiDB migration defines it; the separate route does not create the normal osaah_session cookie; provision/identity linkage policy is unresolved.'] };
    if (platformMetadataNames.has(table.name)) return { name: table.name, disposition: 'REQUIRED_SUPPORTED_WORKFLOW', evidence: table.sourceFiles, unresolved: ['Platform metadata column/index definitions and versioned initializer ownership still require canonical DDL review.'] };
    if (table.classification === 'RUNTIME_SQL_CONFIRMED') return { name: table.name, disposition: 'REQUIRED_CURRENT_RUNTIME', evidence: table.sourceFiles, qualification: 'SQL reference exists in a current source path; this does not prove every branch is mandatory on every installation, and optional fallback/readiness use must be reviewed.', unresolved: ['Exact active workflow, current columns, constraints, and TiDB definition remain unresolved.'] };
    if (table.classification === 'RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED') return { name: table.name, disposition: 'UNRESOLVED', evidence: table.sourceFiles, unresolved: ['Lexical/module references exist but no SQL operation was extracted; inspect indirect, feature-gated, and dynamically assembled paths.'] };
    return { name: table.name, disposition: 'UNRESOLVED', evidence: table.historicalMigrations, unresolved: ['Historical DDL/inventory evidence exists without a statically extracted runtime operation. Absence of an extracted query is not evidence of obsolescence.'] };
  }).map((item) => {
    const table = tables.find((candidate) => candidate.name === item.name);
    const criticalGaps = {
      users: ['Cross-workflow username/email uniqueness differs; parent insertion omits updated_at; current TiDB types/nullability/defaults and existing duplicate state are not available.'],
      user_roles: ['Writers and migration 032 insert id, while schema/001 declares only a composite key; the physical primary-key choice remains unapproved.'],
      portal_users: ['Endpoint projection is known, but no TiDB DDL or provisioning writer establishes required extra columns or linkage.'],
      staff_profiles: ['Current writer requires caller-supplied staff_number, checks duplicates within school scope in both staff and staff_profiles, and writes staff_number, user_id, department, position, date_hired, and qualification. Historical HR DDL instead defines staff_id/employee_id and a different profile shape.', 'No current physical uniqueness/FK rule proves the application-level school-scoped staff-number check is race-safe or reconciles it with historical employee_id uniqueness.'],
      parent_student_links: ['Active-link readers and enrollment writer are known; product rules for primary guardian, deactivation, archival, and deletion are absent.'],
      student_profiles: ['Runtime bridges master id and permanent Student ID; physical relationship type, nullability, uniqueness, and lifecycle are not authoritative.'],
      auth_sessions: ['Runtime lifecycle and VARCHAR(32) ISO representation are known; exact TiDB constraints, FK action policy, charset, and cleanup job remain unverified.']
    };
    const externalDecisionRequired = item.disposition === 'UNRESOLVED'
      ? 'A product/domain owner must identify the supported workflow or explicitly retire it; if supported, provide its current writer/reader contract and required retention before disposition.'
      : 'A database/domain owner must approve the physical type, length/precision, null/default, keys/indexes, FK actions, charset/collation, and target TiDB version after reviewing the cited runtime operations and historical candidates.';
    return {
      ...item,
      missingEvidence: criticalGaps[item.name] ?? (item.disposition === 'UNRESOLVED'
        ? ['No complete current runtime operation or approved retirement record establishes whether this object is still used.', 'Current TiDB column types, nullability/defaults, keys, indexes, relationships, and lifecycle are not established.']
        : ['The scanner establishes literal operation references and source paths, not a complete per-column physical TiDB contract.', 'Current TiDB types, nullability/defaults, keys, indexes, FK actions, charset/collation, and lifecycle are not established.']),
      whyRepositoryEvidenceIsInsufficient: item.disposition === 'UNRESOLVED'
        ? 'Historical migrations and/or lexical source links are not proof of current use, complete DDL, or obsolescence.'
        : 'Runtime SQL constrains names and operations but does not establish physical SQL types, all null/default semantics, database-enforced uniqueness, referential actions, or target-version behavior.',
      requiredExternalDecision: externalDecisionRequired,
      affectedWorkflowEvidence: table?.sourceFiles ?? item.evidence ?? []
    };
  }),
  viewDispositions: [...viewNames].map(([name, migrations]) => {
    const isFeeView = name.startsWith('vw_fee_') || name === 'vw_student_fee_balances' || name === 'vw_invoice_receipt_register';
    const definitionHistory = migrationContents.flatMap(({ name: migration, text }) => [...text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z_][\w$]*)\s+AS\s+([\s\S]*?);/ig)].filter((match) => match[1].toLowerCase() === name.toLowerCase()).map((match) => {
      const definition = match[2].trim();
      const dependencies = [...new Set([...definition.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w$]*)/ig)].map((dependency) => dependency[1]))];
      return { migration, definition, dependencies };
    }));
    return {
      name,
      disposition: isFeeView ? 'REQUIRED_SUPPORTED_WORKFLOW' : 'UNRESOLVED',
      evidence: [...new Set(migrations)],
      definitionHistory,
      definitionAssessment: definitionHistory.length > 1 ? 'CONFLICTING_HISTORICAL_DEFINITIONS_REQUIRES_EXPLICIT_CANONICAL_SELECTION' : 'SINGLE_HISTORICAL_DEFINITION_NOT_LIVE_VERIFIED',
      runtimeEvidence: isFeeView ? ['src/platform/final-result-slip-reconciliation.js declares expected view columns and migration/reconciliation behavior; direct application SELECT was not found.'] : ['No direct runtime SELECT was found; historical definitions and schema tests exist.'],
      missingEvidence: ['No authoritative current application query contract selects a canonical output shape.', 'Base-table physical definitions and exact joins, filters, null behavior, aggregation, and aliases are not reconciled across migrations.', 'No isolated target-version TiDB view creation/query validation exists.'],
      whyRepositoryEvidenceIsInsufficient: 'Historical view definitions conflict and the runtime reconciler checks metadata/shape but does not establish which query is the approved current business contract.',
      requiredExternalDecision: isFeeView ? 'Finance/product owner must identify the supported report consumer, approve its output columns and financial semantics, and designate the intended base-table contract.' : 'Product owner must confirm a supported workflow or provide evidence to retire the historical view; absence of direct SELECT is insufficient.',
      affectedWorkflowEvidence: isFeeView ? ['src/platform/final-result-slip-reconciliation.js'] : [],
      unresolved: ['Current consumer lifecycle and exact TiDB view definition/compatibility are not fully established.']
    };
  }),
  targetTiDBAssessment: {
    targetVersion: 'UNKNOWN_NOT_FOUND_IN_REPOSITORY_DEPLOYMENT_CONFIGURATION',
    minimumIfForeignKeysAreRequired: 'TiDB v8.5.0 or later is the documented GA baseline; foreign-key support exists from v6.6.0 but was experimental before v8.5.0.',
    connectionContract: {
      adapter: 'OSAAH_DATABASE_ADAPTER=tidb; mysql2 createPool is used.',
      connection: 'DATABASE_URL mysql:// or mysql2:// is supported; alternatively host/user/password/database/port component variables are accepted. Database is enforced as osaahdaylightschool; default port is 3306.',
      tls: 'TLS minVersion TLSv1.2 and rejectUnauthorized=true; optional TIDB_CA_CERT may supply a CA certificate.',
      pool: 'waitForConnections=true, connectionLimit=10, queueLimit=0, connectTimeout=15000ms.',
      transactions: 'A checked-out pool connection runs beginTransaction, callback work, commit; callback errors trigger rollback; connection is released in finally.',
      sessionSettings: 'Adapter does not explicitly set sql_mode, charset/collation, or time_zone; deployment/session defaults are not established by repository configuration.',
      versions: 'No server version is configured; readiness reads VERSION() only when invoked against a database.'
    },
    versionSensitiveConstructs: ['foreign-key enforcement and referential actions', 'generated-column indexed uniqueness in migration 083', 'JSON column and function behavior in runtime contracts', 'DATE/TIME/TIMESTAMP session timezone behavior', 'transaction semantics and DDL auto-commit/retry boundaries'],
    evidence: ['.env.example selects the TiDB adapter and canonical database but specifies no server version', 'vercel.json and repository workflows specify no TiDB server version', 'src/ai/tidb-readiness.js obtains SELECT VERSION() only when a database connection is run; no live query was performed'],
    unresolved: ['Obtain approved target TiDB version/cluster configuration and test generated columns, JSON, transaction, FK, and session-time semantics against that version.', 'Deployment owner must specify SQL mode, default character set/collation, session time zone, and whether foreign keys are mandatory.']
  },
  contracts: [
    {
      object: 'users', status: 'PARTIALLY_RESOLVED_SCHEMA_UNRESOLVED',
      runtime: { id: 'randomUUID() in durable staff/admission writers', schoolId: 'single-school sch_default_01', fullName: 'Required in staff provisioning; parent enrollment writes provided name or Parent fallback', phone: 'Optional for staff; valid normalized Ghana phone required for parent identity and used as username', role: 'Writers persist role for compatibility; authentication resolves authority through user_roles/roles and permissions', username: 'Required by staff provisioning; parent writer uses normalized phone', email: 'Required/validated for staff; optional for parents; duplicate checks differ by workflow', passwordHash: 'Staff/admin credential writes use scrypt salt:hex format; admission-generated parent uses bcrypt cost 12; verifier accepts both scrypt and bcrypt; proprietor endpoint is bcrypt-only', status: 'Writers use ACTIVE; login requires ACTIVE (legacy NULL status is treated as ACTIVE in some reset paths, but login defaults missing status to ACTIVE)', createdAt: 'UTC ISO-8601 strings', updatedAt: 'Staff writer sets it; parent enrollment omits it, so schema must permit omission via default or nullability'},
      uniqueness: { username: 'Historical unique scope is (school_id, username); runtime checks school scope', email: 'No historical unique constraint established; staff duplicate check is global while parent duplicate check is school-scoped and login searches without school scope', status: 'UNRESOLVED_POLICY_AND_EXISTING_DUPLICATE_STATE' },
      unresolved: ['TiDB type/length/collation/nullability/defaults', 'safe email uniqueness policy and duplicate data state', 'parent writer updated_at omission/default contract', 'whether to retain users.role as a compatibility field']
    },
    {
      object: 'user_roles', status: 'ID_COLUMN_AND_PAIR_SEMANTICS_RESOLVED_PRIMARY_KEY_UNRESOLVED',
      evidence: ['schema/001_foundation.sql and current relational model use composite primary key (user_id, role_id), no id', 'src/admission-enrollment.js and src/durable-staff-provisioning.js insert a generated id', 'schema/032_production_rbac_reconciliation.sql inserts id but does not define it', 'PostgreSQL baseline contains nullable unique id plus composite primary key'],
      runtime: ['id is a required inserted column in staff and admission writers and migration 032; all use randomUUID() for new assignments', 'No current query reads user_roles.id', 'Duplicate user-role pairs are treated as conflicts; role changes delete scoped assignments then insert a new pair', 'No status, expiry, or school_id is written on the relationship; school scope is enforced through user and role joins'],
      proposedContract: 'Retain non-null unique UUID id to satisfy existing writes and preserve UNIQUE(user_id, role_id) to prevent duplicate assignments. Choosing id as PRIMARY KEY versus retaining the historical composite PRIMARY KEY is a physical-schema decision; either must preserve both constraints and cannot be settled from current query behavior alone.',
      unresolved: ['Primary-key choice, UUID SQL type/length, timestamp nullability/default, and table-level FK actions']
    },
    {
      object: 'RBAC relationship', status: 'RELATIONAL_FLOW_ESTABLISHED_SCHEMA_UNRESOLVED',
      relationship: 'users -> user_roles -> roles -> role_permissions -> permissions',
      evidence: ['src/auth.js password and durable-session queries join all five tables', 'src/durable-staff-provisioning.js assigns roles through user_roles and roles', 'schema/001_foundation.sql declares composite mapping keys; schema/032 defines role_permissions composite key'],
      permissions: 'Database permission rows are loaded when available; auth.js falls back to hard-coded role permission sets when the permission result is empty. Parent permissions are added in application code.',
      unresolved: ['RBAC seed/assignment completeness, school/global role scoping, FK enforcement, and whether empty database permissions should imply fallback grants']
    },
    {
      object: 'portal_users', status: 'CURRENT_ENDPOINT_DEPENDENCY_SEPARATE_AUTH_UNRESOLVED',
      evidence: ['src/server.mjs exposes POST /api/auth/proprietor/login when database adapter exists', 'controller requires id, portal_name, email, password_hash, role, is_active; accepts only active PROPRIETOR and verifies bcrypt', 'PostgreSQL baseline adds school_id, phone, full_name, status, linked_user_id, created_at, updated_at and unique email'],
      behavior: 'Separate bcrypt login path; it returns metadata but does not establish the standard osaah_session cookie/session row. No portal_users writer/provisioning path was found.',
      disposition: 'Required for a clean install while the endpoint is retained; a unified users/RBAC design would require an explicit backward-compatible application decision.',
      unresolved: ['No numbered TiDB migration; which baseline-only fields are actually required; account creation/linkage/retirement policy']
    },
    {
      object: 'staff_profiles', status: 'CONTRACT_CONFLICT_UNRESOLVED',
      staffNumber: 'Current durable writer copies the supplied staffId to staff.staff_number and staff_profiles.staff_number; duplicate checks are school-scoped; list/API output exposes staff.staff_number as staffId. It is an externally supplied employee/display identifier, not generated by this writer.',
      relationship: 'Current writer gives users.id, staff.id, and staff_profiles.id the same UUID and joins profile to staff via user_id; it does not FK staff_profiles.staff_number to a staff row.',
      historical: 'schema/009_staff_hr.sql instead defines staff_id and employee_id as separate unique identifiers plus HR profile fields; it has no staff_profiles.staff_number or user_id. PostgreSQL baseline mirrors that HR shape.',
      unresolved: ['Current writer also inserts department, position, date_hired, and qualification with a shape not defined by schema/009 or PostgreSQL baseline', 'No authoritative decision whether staff_profiles remains a rich HR profile or is a parallel provisioning projection', 'Uniqueness and FK contract must not be guessed']
    },
    {
      object: 'parent_student_links and student_profiles.student_master_id', status: 'IDENTITY_PATH_ESTABLISHED_REFERENTIAL_CONTRACT_UNRESOLVED',
      relationship: 'parent_student_links.parent_user_id -> users.id; parent_student_links.student_id -> student_profiles.id; student_profiles.student_master_id -> students.id; student_profiles.student_id carries the permanent Student ID compatibility bridge.',
      keys: 'schema/003 uses composite primary key (parent_user_id, student_id), preventing duplicate pairs; relationship id is the pair, not a separate generated id.',
      runtime: 'Enrollment writes relationship, relationship_type, ACTIVE, created_at, updated_at; parent auth and fee/student portal paths filter ACTIVE. No current link-status update/delete workflow or primary-guardian column/rule was found.',
      unresolved: ['schema/054 adds nullable student_master_id and link_status but no TiDB table-level FKs', 'Soft archival/deactivation and multiple-guardian policy', 'Identifier type/length/charset equality and delete actions']
    },
    {
      object: 'auth_sessions', status: 'REPRESENTATION_DECISION_RESOLVED_SCHEMA_REMAINDER_UNRESOLVED',
      decision: 'Keep VARCHAR(32) for created_at, expires_at, revoked_at, last_used_at; store canonical UTC ISO-8601 text exactly as JavaScript Date.toISOString() emits. Do not convert to DATETIME/TIMESTAMP in this phase.',
      evidence: ['schema/052 and schema/053 declare VARCHAR(32) timestamps', 'src/auth.js uses a 30-minute TTL and serializes timestamps using toISOString()', 'Session restore parses expires_at with Date.parse and compares stored expires_at to the same canonical UTC string', 'Creation uses UUID id and stores SHA-256 token hash; token_hash is unique', 'Expiration is fixed at creation; restore updates last_used_at but does not extend expires_at; logout/password changes/account changes revoke rows. No durable expired-session deletion/cleanup job was found.'],
      indexes: ['PRIMARY KEY(id)', 'UNIQUE(token_hash)', 'idx_auth_sessions_user_active(user_id, revoked_at, expires_at)', 'idx_auth_sessions_school(school_id)', 'idx_auth_sessions_expiry(expires_at, revoked_at)'],
      unresolved: ['Explicit UTC validation/driver string settings are not currently enforced', 'user_id and school_id inline REFERENCES in schema/052 are ignored by TiDB; decide table-level FKs after type reconciliation', 'Expired/revoked row retention and cleanup owner/retention period are not established']
    },
    {
      object: 'historical foreign keys', status: 'PARTIALLY_AUDITED_TARGET_VERSION_UNRESOLVED',
      findings: ['The 82 numbered migration files contain 402 REFERENCES token occurrences and 35 FOREIGN KEY token occurrences; these static token counts include historical definitions and are not the count of current enforceable constraints.', 'Most foundation-era declarations use inline REFERENCES; TiDB parses but ignores these. The explicit table-level constraints in later migrations are candidate enforcement only and still need target version, matching types/length/charset/collation/indexes and delete/update action review.', 'Migration 082 contains two inline REFERENCES declarations; neither establishes a TiDB foreign key as written.'],
      targetVersion: 'Not observed in this read-only repository review; TiDB FK support begins at v6.6 and is generally available from v8.5.0.',
      unresolved: ['Per-relationship full enforcement matrix and exact target version']
    },
    {
      object: 'academic_result_blocks generated scope', status: 'STRUCTURE_RESOLVED_VERSION_GATE_OPEN',
      decision: 'Retain the unique scope index and the VIRTUAL VARCHAR(32) key derived from IFNULL(mock_examination, \'\'); do not remove the uniqueness protection.',
      evidence: ['schema/064 defines original scope/index', 'schema/075 adds result_type/mock_examination and the examination-scoped unique index', 'schema/083 adds mock_examination_key as VIRTUAL and a unique index that normalizes NULL labels', 'TiDB stable docs support indexing virtual/stored generated columns; IFNULL is documented; the expression is deterministic.'],
      unresolved: ['The actual target TiDB version is unknown; integration validation of the exact ALTER/CREATE INDEX IF NOT EXISTS statements and duplicate-scope precondition remains required.']
    }
  ],
  dynamicDependencyReview: {
    orm: 'No ORM/query-builder dependency is declared; runtime database packages are mysql2 and pg.',
    reviewedPatterns: ['Parameterized literal SQL in database.query/execute and transaction callbacks', 'Dynamic WHERE predicate fragments in src/existing-student-linking.js and src/parent-fee-obligations-repository.js', 'Allowlisted table/column identifiers in src/general-finance.js and src/durable-student-profile.js', 'Generic repository identifier validation in src/platform/repositories.js', 'Migration-parsed view definitions in src/platform/final-result-slip-reconciliation.js'],
    sidecarObjects: 'No CREATE PROCEDURE, CREATE TRIGGER, or CREATE EVENT statement was found in the numbered migrations or scanned application source.',
    limitation: 'Dynamic call-site analysis remains incomplete for the 17 manifest entries with lexical runtime-file links but no extracted SQL, and for feature-gated or indirect service calls.'
  },
  domainCompletionMatrix: [
    { domain: 'Authentication and RBAC', status: 'PARTIAL', coreTables: ['users','user_roles','roles','role_permissions','permissions','auth_sessions'], evidence: ['src/auth.js','src/durable-staff-provisioning.js','schema/001_foundation.sql','schema/032_production_rbac_reconciliation.sql','schema/052_durable_auth_sessions.sql'], blockers: ['users uniqueness/nullability/defaults and cross-school identifier policy unresolved','user_roles primary-key/type choice and FK contract unresolved although id writes and pair uniqueness behavior are established','RBAC seeding/scope and empty-permission fallback authorization policy unresolved','TiDB FK/type/action contract unresolved'] },
    { domain: 'Proprietor and Administrator', status: 'PARTIAL', coreTables: ['portal_users','users','roles','user_roles','auth_sessions'], evidence: ['src/proprietor-authentication-controller.js','src/server.mjs','src/durable-staff-provisioning.js'], blockers: ['portal_users lacks TiDB DDL/provisioner','separate proprietor login does not establish standard durable session','secure bootstrap policy must be implemented as an explicit operational workflow'] },
    { domain: 'Staff and Teachers', status: 'PARTIAL', coreTables: ['staff','staff_profiles','users','user_roles','roles','subject_register_teachers'], evidence: ['src/durable-staff-provisioning.js','src/staff-attendance-overview.js','src/server.mjs','schema/009_staff_hr.sql'], blockers: ['staff_profiles writer/history shape conflict','staff_number is externally supplied and school-scoped in application checks; physical uniqueness/FK not established','teacher assignment contracts remain table-specific'] },
    { domain: 'Students and Parents', status: 'PARTIAL', coreTables: ['students','student_profiles','parent_student_links','student_enrollments','admission_applications','users'], evidence: ['src/admission-enrollment.js','src/parent-sms-auth.js','src/durable-student-profile.js','src/existing-student-linking.js','src/parent-historical-records.js'], blockers: ['link archival/guardian policy unresolved','legacy student identity bridges remain','physical types, FKs and delete actions unresolved'] },
    { domain: 'School Configuration and Academics', status: 'PARTIAL', coreTables: ['schools','system_settings','academic_years','terms','classes','streams','subjects','class_subjects','subject_class_assignments','student_enrollments'], evidence: ['src/school-settings.js','src/academic-calendar.js','src/durable-academic.js','src/production-three-term-config.js','src/module-registry.js'], blockers: ['historical schema drift across academic modules','scoped key and FK contracts need full per-table reconciliation','class_subjects is optional compatibility only'] },
    { domain: 'Attendance and Assessments', status: 'PARTIAL', coreTables: ['student_attendance','staff_attendance','examinations','examination_marks','academic_score_records','grading_systems'], evidence: ['src/attendance-repository.js','src/student-attendance-overview.js','src/staff-attendance-overview.js','src/durable-academic.js','src/academic-results.js'], blockers: ['assessment/result stores have parallel historical shapes','score precision, uniqueness, version, and FK contracts require field-level reconciliation'] },
    { domain: 'Results and Report Cards', status: 'PARTIAL', coreTables: ['examinations','examination_marks','academic_result_blocks','academic_result_records','academic_score_records','student_transcript_versions'], evidence: ['src/durable-academic.js','src/academic-results.js','src/platform/final-result-slip-reconciliation.js','src/platform/result-blocking-083-preflight.js'], blockers: ['legacy/current result sources coexist','view/result reconciliation inputs need canonical selection','generated uniqueness migration needs target-version validation'] },
    { domain: 'Financial Management', status: 'PARTIAL', coreTables: ['fee_types','fee_structures','student_fee_accounts','student_fee_ledger','student_fee_payments','fee_invoices','student_fee_receipts','fee_obligations','fee_collection_records'], views: ['vw_student_fee_balances','vw_fee_overview','vw_fee_arrears','vw_invoice_receipt_register','vw_fee_collection_summary'], evidence: ['src/durable-fee-payments.js','src/durable-fee-reader.js','src/parent-fee-obligations-repository.js','src/fee-collections-repository.js','src/platform/final-result-slip-reconciliation.js'], blockers: ['conflicting historical fee view definitions','amount precision/minor-unit contracts and payment allocation constraints not fully reconciled','view dependencies need canonical base-table definitions'] },
    { domain: 'Reports, Notifications and Auditing', status: 'PARTIAL', coreTables: ['audit_logs','announcements','announcement_records','notifications'], views: ['vw_class_database','vw_completed_class_database'], evidence: ['src/ai/operational-intelligence.js','src/durable-announcements.js','src/platform/final-result-slip-reconciliation.js','src/single-school-overview.js'], blockers: ['dynamic/reporting dependencies incompletely traced','historical class views lack current direct consumers','92 historical tables lack sufficiently evidenced dispositions'] }
  ],
  completionStatus: 'INCOMPLETE_REQUIRED_CONTRACTS_AND_OBJECT_DISPOSITIONS_REMAIN_UNRESOLVED'
};
runtimeContractReconciliation.tableDispositions.sort((a, b) => a.name.localeCompare(b.name));
runtimeContractReconciliation.viewDispositions.sort((a, b) => a.name.localeCompare(b.name));
runtimeContractReconciliation.tableDispositionCounts = Object.fromEntries(runtimeContractReconciliation.dispositionTaxonomy.map((disposition) => [disposition, runtimeContractReconciliation.tableDispositions.filter((item) => item.disposition === disposition).length]));
runtimeContractReconciliation.viewDispositionCounts = Object.fromEntries(runtimeContractReconciliation.dispositionTaxonomy.map((disposition) => [disposition, runtimeContractReconciliation.viewDispositions.filter((item) => item.disposition === disposition).length]));
const manifest = {
  formatVersion: 1,
  repositoryHead: 'e142db137ac3cfd1a60c6981774763df59612333',
  targetDatabase: 'osaahdaylightschool',
  singleSchoolId: 'sch_default_01',
  status: 'EVIDENCE_ONLY_NOT_CANONICAL',
  schemaReconciliationFindings: [
    { object: 'users', evidence: ['schema/001_foundation.sql defines id,school_id,username,email,password_hash,status,created_at,updated_at', 'runtime writers in src/admission-enrollment.js and src/durable-staff-provisioning.js also write full_name,phone,role', 'schema/069 adds username and updated_at only', 'parallel PostgreSQL baseline includes full_name,phone,role'], status: 'UNRESOLVED_CURRENT_TIDB_COLUMN_CONTRACT' },
    { object: 'user_roles', evidence: ['schema/001_foundation.sql uses composite primary key (user_id,role_id) without id', 'runtime writers in src/admission-enrollment.js and src/durable-staff-provisioning.js insert id,user_id,role_id,created_at', 'schema/032 inserts id into user_roles without declaring its column in that migration', 'parallel PostgreSQL baseline declares nullable unique id plus composite primary key'], status: 'UNRESOLVED_CURRENT_TIDB_KEY_CONTRACT' },
    { object: 'parent_student_links', evidence: ['schema/003 creates original link table', 'schema/054 adds permanent_student_id,relationship_type,link_status,updated_at', 'runtime parent login filters link_status=ACTIVE', 'parallel PostgreSQL baseline reflects these later fields'], status: 'REQUIRES_FULL_COLUMN_AND_FOREIGN_KEY_RECONCILIATION' },
    { object: 'student_profiles', evidence: ['schema/054 adds student_master_id', 'runtime parent authentication joins student_profiles.student_master_id to students.id', 'readiness intentionally does not require a foreign key for student_master_id'], status: 'RELATIONSHIP_POLICY_UNRESOLVED' },
    { object: 'portal_users', evidence: ['present in parallel PostgreSQL baseline', 'src/proprietor-authentication-controller.js queries it', 'no matching numbered migration CREATE TABLE found'], status: 'RUNTIME_REQUIRED_TIDB_DDL_MISSING_FROM_HISTORICAL_SET' },
    { object: 'auth_sessions', evidence: ['schema/052 declares token_hash unique and session timestamps as VARCHAR', 'src/auth.js stores ISO strings, looks up by token_hash and expiry, updates last_used_at, sets revoked_at', 'adapter readiness checks all eight session columns'], status: 'COLUMN_CONTRACT_EVIDENCE_FOUND_TIDB_TIME_TYPE_UNVERIFIED' }
  ],
  authRbacFindings: [
    { workflow: 'password_login', tables: ['users', 'user_roles', 'roles', 'role_permissions', 'permissions'], requiredFields: ['users.username', 'users.email', 'users.password_hash', 'users.status', 'users.school_id', 'roles.role_key', 'roles.oversight_rank', 'permissions.permission_key'], sources: ['src/auth.js'] },
    { workflow: 'durable_sessions', tables: ['auth_sessions', 'users', 'user_roles', 'roles', 'role_permissions', 'permissions'], requiredFields: ['auth_sessions.id', 'user_id', 'school_id', 'token_hash', 'created_at', 'expires_at', 'revoked_at', 'last_used_at'], sources: ['src/auth.js', 'src/ai/tidb-database-adapter.js', 'schema/052_durable_auth_sessions.sql'] },
    { workflow: 'parent_phone_login_and_rate_limit', tables: ['parent_auth_rate_limits', 'users', 'schools', 'user_roles', 'roles', 'parent_student_links', 'student_profiles', 'students'], requiredFields: ['users.phone', 'parent_student_links.link_status', 'student_profiles.student_master_id', 'students.student_status', 'parent_auth_rate_limits.bucket_hash', 'window_started_at', 'request_count', 'updated_at'], sources: ['src/auth.js', 'schema/082_parent_sms_auth.sql'] },
    { workflow: 'parent_sms_challenges', tables: ['parent_auth_challenges'], requiredFields: ['code_digest', 'attempts', 'expires_at', 'consumed_at', 'invalidated_at'], sources: ['src/parent-sms-auth.js', 'schema/082_parent_sms_auth.sql'], securityNote: 'Source persists a code digest, not the plaintext challenge.' },
    { workflow: 'role_contract', roleKeys: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'TEACHER', 'PARENT'], status: 'RUNTIME_ROLE_KEYS_IDENTIFIED_ASSIGNMENT_SCHEMA_UNRESOLVED' }
  ],
  sourceInventory: 'docs/database-schema-inventory.md',
  migrationFileCount: migrationFiles.length,
  runtimeSourceFileCount: files.length,
  runtimeSqlEvidenceCount: runtimeOperations.length,
  historicalTableNameCount: historicalTableNames.size,
  parallelPostgresBaselineTableCount: postgresDefinitions.size,
  runtimeTiDBDefinitionTableCount: runtimeNativeDdl.size,
  tableCount: tables.length,
  historicalReconciliationCounts: {
    historicalNamesTotal: historicalTableNames.size,
    historicalNamesWithExtractedRuntimeSql: tables.filter((table) => historicalTableNames.has(table.name) && table.classification === 'RUNTIME_SQL_CONFIRMED').length,
    historicalNamesWithRuntimeFileLinksButNoExtractedSql: tables.filter((table) => historicalTableNames.has(table.name) && table.classification === 'RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED').length,
    historicalNamesWithoutExtractedRuntimeOperation: tables.filter((table) => historicalTableNames.has(table.name) && table.classification === 'HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT').length,
    nonHistoricalRuntimeOrPlatformNames: tables.filter((table) => !historicalTableNames.has(table.name) && (table.classification === 'RUNTIME_SQL_CONFIRMED' || table.classification === 'TIDB_NATIVE_PLATFORM_METADATA_DDL')).map((table) => table.name),
    allCountsAreStaticAndRequireReview: true
  },
  evidenceCounts: {
    runtimeSqlConfirmedTableCount: tables.filter((table) => table.classification === 'RUNTIME_SQL_CONFIRMED').length,
    runtimeWriteColumnPairs: tables.reduce((count, table) => count + table.runtimeWriteColumns.length, 0),
    historicalColumnCandidatePairs: tables.reduce((count, table) => count + table.historicalColumnCandidates.length, 0),
    parallelPostgresColumnDefinitionPairs: tables.reduce((count, table) => count + table.parallelPostgresDefinitionEvidence.reduce((sum, definition) => sum + definition.columns.length, 0), 0),
    historicalPrimaryKeyEvidenceItems: tables.reduce((count, table) => count + table.historicalPrimaryKeyEvidence.length, 0),
    historicalUniqueEvidenceItems: tables.reduce((count, table) => count + table.historicalUniqueEvidence.length, 0),
    historicalForeignKeyEvidenceItems: tables.reduce((count, table) => count + table.historicalForeignKeyEvidence.length, 0),
    historicalSecondaryIndexEvidenceItems: tables.reduce((count, table) => count + table.historicalIndexEvidence.length, 0),
    parallelPostgresPrimaryKeyDefinitions: tables.reduce((count, table) => count + table.parallelPostgresDefinitionEvidence.reduce((sum, definition) => sum + (definition.primaryKey.length ? 1 : 0), 0), 0),
    parallelPostgresForeignKeyDefinitions: tables.reduce((count, table) => count + table.parallelPostgresDefinitionEvidence.reduce((sum, definition) => sum + definition.foreignKeys.length, 0), 0),
    parallelPostgresUniqueDefinitions: tables.reduce((count, table) => count + table.parallelPostgresDefinitionEvidence.reduce((sum, definition) => sum + definition.unique.length, 0), 0),
    allCountsAreEvidenceOnly: true
  },
  tables,
  historicalViews: [...viewNames].map(([name, migrations]) => ({ name, migrations: [...new Set(migrations)], status: 'UNRESOLVED_NOT_CANONICAL' })),
  runtimeContractReconciliation,
  domainDocumentation: {
    directory: 'docs/tidb-domain-contracts',
    domainCount: runtimeContractReconciliation.domainCompletionMatrix.length,
    fullyResolvedDomains: runtimeContractReconciliation.domainCompletionMatrix.filter((domain) => domain.status === 'COMPLETE').map((domain) => domain.domain),
    partialDomains: runtimeContractReconciliation.domainCompletionMatrix.filter((domain) => domain.status === 'PARTIAL').map((domain) => domain.domain),
    unresolvedRequiredTableContracts: 71,
    unresolvedRequiredViewContracts: 5,
    documents: [...runtimeContractReconciliation.domainCompletionMatrix.map((domain) => domain.domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md'), 'completion-matrix.md']
  },
  unresolvedSummary: {
    runtimeSqlConfirmedTables: tables.filter((table) => table.classification === 'RUNTIME_SQL_CONFIRMED').length,
    runtimeReferencedButUnresolvedTables: tables.filter((table) => table.classification === 'RUNTIME_REFERENCE_WORKFLOW_UNRESOLVED').length,
    historicalPotentiallyObsoleteOrIndirectTables: tables.filter((table) => table.classification === 'HISTORICAL_POTENTIALLY_OBSOLETE_OR_INDIRECT').length,
    parallelPostgresBaselineOnlyTables: tables.filter((table) => table.classification === 'PARALLEL_POSTGRES_BASELINE_ONLY_NOT_TIDB_CONFIRMED').length,
    runtimeTablesWithoutAnySchemaDefinitionEvidence: tables.filter((table) => table.runtimeOperations.read + table.runtimeOperations.join + table.runtimeOperations.insert + table.runtimeOperations.update + table.runtimeOperations.delete > 0 && table.historicalColumnCandidates.length === 0 && !(postgresDefinitions.get(table.name)?.length) && !(runtimeNativeDdl.get(table.name)?.length)).length,
    runtimeWriteColumnPairsWithoutAnySchemaDefinitionEvidence: tables.reduce((count, table) => count + table.runtimeWriteColumnsWithoutSchemaEvidence.length, 0),
    allObjectsRemainUnresolvedForCanonicalDdl: true
  }
};

const report = [
  '# TiDB canonical schema plan — evidence and reconciliation', '',
  '> **Status: NOT CANONICAL.** This report is generated from source SQL strings and the merged migration inventory. Static extraction cannot prove dynamic queries, current column types, defaults, nullability, transaction behavior, or which historical definitions remain active. No DDL should be generated from this report.', '',
  '## Scope and identifiers', '',
  `- Repository revision reviewed: \`${manifest.repositoryHead}\` (working tree includes preserved uncommitted work).`,
  `- Historical SQL files: ${migrationFiles.length}; runtime source files scanned: ${files.length}.`,
  `- Target database: \`${manifest.targetDatabase}\`; single school: \`${manifest.singleSchoolId}\`. No school, user, student, or other operational rows are proposed.`,
  `- Historical table-name inventory: ${manifest.historicalTableNameCount}; separate PostgreSQL baseline table-name set: ${manifest.parallelPostgresBaselineTableCount}; native TiDB platform metadata DDL tables: ${manifest.runtimeTiDBDefinitionTableCount}; combined names: ${tables.length}; historically declared views: ${viewNames.size}.`,
  `- Runtime SQL references extracted: ${runtimeOperations.length} (static literal scan; dynamically assembled SQL can be missed).`, '',
  `- Evidence candidates (not canonical requirements): ${manifest.evidenceCounts.historicalColumnCandidatePairs} historical column/type pairs, ${manifest.evidenceCounts.parallelPostgresColumnDefinitionPairs} parallel PostgreSQL column-definition occurrences, ${manifest.evidenceCounts.runtimeWriteColumnPairs} runtime write-column pairs, ${manifest.evidenceCounts.historicalPrimaryKeyEvidenceItems} historical PK items, ${manifest.evidenceCounts.historicalUniqueEvidenceItems} historical unique items, ${manifest.evidenceCounts.historicalForeignKeyEvidenceItems} historical FK items, ${manifest.evidenceCounts.historicalSecondaryIndexEvidenceItems} historical secondary-index items. PostgreSQL constraint totals are separately recorded in the manifest; overlapping and superseded evidence is not deduplicated into a final schema.`, '',
  '## Classification', '',
  '| Classification | Count | Meaning |',
  '|---|---:|---|',
  `| Runtime SQL confirmed | ${manifest.unresolvedSummary.runtimeSqlConfirmedTables} | Static SQL literal references identify a query or write target. |`,
  `| Runtime reference, operation unresolved | ${manifest.unresolvedSummary.runtimeReferencedButUnresolvedTables} | Existing generated inventory links runtime files, but this scanner did not extract a SQL operation. |`,
  `| Historical, potentially obsolete or indirect | ${manifest.unresolvedSummary.historicalPotentiallyObsoleteOrIndirectTables} | Found in migration evidence without an extracted runtime reference; not discarded. |`, '',
  `| PostgreSQL baseline only | ${manifest.unresolvedSummary.parallelPostgresBaselineOnlyTables} | Present in separate PostgreSQL baseline evidence without extracted runtime SQL or historical inventory mapping; not TiDB-confirmed. |`, '',
  `- Runtime SQL tables with no historical or parallel PostgreSQL column evidence: ${manifest.unresolvedSummary.runtimeTablesWithoutAnySchemaDefinitionEvidence}.`,
  `- Runtime write-column pairs with no historical or parallel PostgreSQL column evidence: ${manifest.unresolvedSummary.runtimeWriteColumnPairsWithoutAnySchemaDefinitionEvidence}.`, '',
  '## Table-by-table evidence matrix', '',
  'The machine-readable manifest contains the full source-file list, operation counts, SQL statement locations, historical columns/types, key/index/FK evidence and migration provenance for each name. Historical type and constraint fields are candidates only; defaults and nullability are not promoted to canonical requirements.', '',
  '| Table | Classification | Runtime files | SQL operations (FROM/JOIN/I/U/D) | Historical creates / alters | Provenance |',
  '|---|---|---:|---:|---:|---|',
  ...tables.map((table) => `| \`${table.name}\` | ${table.classification} | ${table.sourceFiles.length} | ${table.runtimeOperations.read}/${table.runtimeOperations.join}/${table.runtimeOperations.insert}/${table.runtimeOperations.update}/${table.runtimeOperations.delete} | ${table.historicalCreateOccurrences}/${table.historicalAlterOccurrences} | ${table.historicalMigrations.join(', ') || 'none indexed'} |`), '',
  '## Authentication and RBAC contracts', '',
  '- Password login reads account identifiers, password hash, active status, school scope, role key/rank, and permissions through `users` → `user_roles` → `roles` → `role_permissions` → `permissions`.',
  '- Durable sessions store a SHA-256 token hash, expiry, revocation timestamp, and last-used timestamp. Login/logout/password-change paths create, restore, revoke, or touch sessions. Raw session tokens are not persisted.',
  '- Parent phone login uses transactional rate-limit rows with `SELECT ... FOR UPDATE`; it checks school and account state and joins parent links, profiles, and master students. Parent SMS challenge DDL stores a digest and attempt/expiry/consume/invalidation state.',
  '- Runtime role keys found: PROPRIETOR, SCHOOL_ADMIN, HEADTEACHER, ASSISTANT_HEADTEACHER, ACCOUNTANT_BURSAR, TEACHER, and PARENT. The complete permission-to-role assignment contract still requires reconciliation.',
  '- Critical unresolved mismatch: the original `user_roles` table has a composite key and no `id`, while current application writers insert `id`; migration 032 also inserts `id` without declaring it. The separate PostgreSQL baseline includes a nullable unique `id`, but that does not establish the current TiDB definition.',
  '',
  '## Confirmed schema evidence conflicts', '',
  '- `users`: the historical foundation lacks `full_name`, `phone`, and `role`; current writers insert all three, while migration 069 only adds `username` and `updated_at`. The PostgreSQL baseline has these fields, but TiDB compatibility and the deployed TiDB contract remain unverified.',
  '- `parent_student_links`: original DDL is extended by migration 054; runtime depends on `link_status`. Review the complete current FK and nullability contract.',
  '- `student_profiles.student_master_id` is used by parent authentication to reach `students.id`, but readiness explicitly does not require an FK. Decide and document the intended relationship before DDL.',
  '- `portal_users` is read by proprietor authentication and exists in PostgreSQL baseline evidence, but has no numbered migration definition.',
  '- Session timestamps are ISO strings at runtime and VARCHAR in migration 052, while the PostgreSQL baseline uses timezone-aware timestamps. TiDB temporal type and serialization behavior need an explicit compatibility decision.',
  '',
  '## Reconciliation and compatibility blockers', '',
  '- Multiple CREATE and ALTER statements are retained as migration provenance; this scanner does not apply them as a historical replay or infer their final effect.',
  '- Historical inventory merges superseded definitions. The PostgreSQL baseline is a separate dialect and is supporting evidence only; it cannot be translated to TiDB without type, index, generated-column, constraint, and transaction review.',
  '- `class_subjects` is referenced only by an optional legacy compatibility path and must not be treated as a required fresh-install table based on that path alone.',
  '- Runtime SQL extraction sees quoted literal statements only. Parameterized queries are represented, but composed SQL fragments, stored procedures, adapter callbacks, and dynamically generated identifiers need manual review.',
  '- This pass does not resolve identifier generation, uniqueness semantics across workflows, cascades, delete behavior, default semantics, or full read-column projection contracts.',
  '- `schema/082_parent_sms_auth.sql` uses inline column `REFERENCES` declarations. TiDB parses but ignores inline `REFERENCES`; constraints must be table-level. The expected same-type/size/precision/length/charset/collation match and parent-index requirements also need to be satisfied. Thus migration 082 does not establish those FKs in TiDB as written. See [TiDB foreign-key constraints](https://docs.pingcap.com/tidb/stable/foreign-key/).',
  '- `schema/083_result_blocking_tidb_scope.sql` adds a virtual generated `mock_examination_key` and indexes it in the unique scope key. TiDB documentation supports indexes on virtual or stored generated columns, but the exact migration was not integration-tested against the target TiDB version. See [generated columns](https://docs.pingcap.com/tidb/stable/generated-columns/).',
  '- TiDB supports MySQL data types except spatial; fractional seconds precision for TIME/DATETIME/TIMESTAMP is 0–6. Actual per-column type, decimal precision, charset/collation, and target-version behavior remain unresolved. See [TiDB data types](https://docs.pingcap.com/tidb/stable/data-type-overview/).',
  '- TiDB converts TIMESTAMP values between UTC and the current session time zone; DATETIME is not converted. Historical `auth_sessions` uses VARCHAR ISO timestamps, so a temporal-type change must preserve current application serialization and UTC semantics. See [TiDB date and time types](https://docs.pingcap.com/tidb/stable/data-type-date-and-time/) and [time-zone support](https://docs.pingcap.com/tidb/stable/configure-time-zone/).',
  '- Authentication/RBAC table names and operations are included in the matrix; exact schema completeness remains unresolved until login/session/role flows are manually reconciled against every query and migration definition.',
  '',
  '## Next review gate', '',
  'Resolve every manifest entry with current source-code evidence, reconcile all historical changes table-by-table, document unsupported or intentionally retired objects, then approve exact TiDB column and constraint contracts. Keep the fresh initializer plan unresolved until that review and isolated TiDB integration validation pass.', ''
].join('\n');

const formatEvidence = (value) => typeof value === 'string' ? value : JSON.stringify(value);
const safeCell = (value) => String(value ?? '').replaceAll('|', '/').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
const phase2bSections = [
  '## Phase 2B runtime contract reconciliation', '',
  '> **Status: incomplete.** Findings separate observed runtime behavior from a canonical TiDB schema. No executable DDL is approved.', '',
  `- Table dispositions: ${JSON.stringify(runtimeContractReconciliation.tableDispositionCounts)}.`,
  `- View dispositions: ${JSON.stringify(runtimeContractReconciliation.viewDispositionCounts)}.`,
  '- No object is marked obsolete solely because static SQL extraction found no literal query.',
  '- No ORM/query-builder dependency was found; mysql2 and pg are the declared database clients.', '',
  ...runtimeContractReconciliation.contracts.flatMap((contract) => [
    `### ${contract.object}`, '',
    `- Status: \`${contract.status}\`.`,
    ...Object.entries(contract).filter(([key]) => !['object', 'status'].includes(key)).map(([key, value]) => `- ${key}: ${formatEvidence(value)}`), ''
  ]),
  '### Dynamic and indirect database dependencies', '',
  ...Object.entries(runtimeContractReconciliation.dynamicDependencyReview).map(([key, value]) => `- ${key}: ${formatEvidence(value)}`), '',
  '### All 164 table-name dispositions', '',
  '| Table | Disposition | Evidence sample | Qualification / unresolved item |',
  '|---|---|---|---|',
  ...runtimeContractReconciliation.tableDispositions.map((item) => `| \`${item.name}\` | ${item.disposition} | ${safeCell((item.evidence ?? []).slice(0, 4).join(', '))}${(item.evidence?.length ?? 0) > 4 ? ` (+${item.evidence.length - 4} more in manifest)` : ''} | ${safeCell(item.qualification ?? (item.unresolved ?? []).join('; '))} |`), '',
  '### All eight view dispositions', '',
  '| View | Disposition | Migration evidence | Runtime finding |',
  '|---|---|---|---|',
  ...runtimeContractReconciliation.viewDispositions.map((item) => `| \`${item.name}\` | ${item.disposition} | ${safeCell(item.evidence.join(', '))} | ${safeCell(item.runtimeEvidence.join('; '))} |`), '',
  '### Historical view definitions and dependencies', '',
  'The machine manifest stores each historical SELECT definition verbatim, source migration, extracted FROM/JOIN dependencies, and whether the definition is in conflict with another migration. Static definition presence does not prove the view is suitable for a clean install.',
  '- vw_student_fee_balances aggregates active charges, discounts, and payments per account; historical alternatives use separate financial tables and differ in output shape.',
  '- vw_fee_overview groups balances by school, academic year, and term; historical aliases and columns differ.',
  '- vw_fee_arrears selects positive balances and inherits upstream balance-view drift.',
  '- vw_invoice_receipt_register joins payments, invoices, and receipts; migration 046 uses p.amount while migration 049 uses p.amount_paid. The current reconciler rejects the earlier expression.',
  '- vw_fee_collection_summary aggregates collections; historical sources and output columns differ.',
  '- vw_published_fee_structures projects published structures; historical source columns and aliases differ.',
  '- vw_class_database and vw_completed_class_database join enrollments with students and filter current/active or completed-status rows; neither has a confirmed current direct runtime consumer.', '',
  '### Target TiDB version assessment', '',
  '- The repository identifies TiDB but does not specify a server version. Readiness can query SELECT VERSION(), but no database connection was made for this task.',
  '- Adapter contract: mysql2 pool; DATABASE_URL mysql:// or mysql2://, or host/user/password/database/port components; database osaahdaylightschool; default port 3306; TLSv1.2 minimum with certificate verification and optional TIDB_CA_CERT; pool size 10; connection timeout 15 seconds.',
  '- Transactions use one checked-out connection with begin/commit/rollback. sql_mode, default charset/collation, and session time zone are not set by the adapter and must be specified by the deployment owner.',
  '- If the canonical design requires enforced foreign keys, use TiDB v8.5.0 or later for general availability. Earlier foreign-key support from v6.6.0 was experimental.',
  '- Generated indexed columns, JSON behavior, date/time session semantics, transactions, and referential actions still need verification against the actual target version.', '',
  '### Phase 2E domain contract investigation status', '',
  '| Domain | Status | Focus tables | Evidence modules | Open decisions |',
  '|---|---|---|---|---|',
  ...runtimeContractReconciliation.domainCompletionMatrix.map((domain) => '| ' + domain.domain + ' | ' + domain.status + ' | ' + domain.coreTables.join(', ') + ' | ' + domain.evidence.join(', ') + ' | ' + domain.blockers.join('; ') + ' |'), '',
  '- Domain notes are in docs/tidb-domain-contracts/; completion matrix is docs/tidb-domain-contracts/completion-matrix.md.',
  '- Fully resolved required table contracts: 0/71. Fully resolved required view contracts: 0/5. All nine domains remain partial.', '',
  '### TiDB compatibility gates', '',
  '- TiDB parses but ignores inline column `REFERENCES`; use table-level `FOREIGN KEY` constraints only after exact types, lengths, character sets, collations, supporting indexes, referential actions, and target version are reconciled. TiDB documents foreign keys from v6.6.0 and GA from v8.5.0. [Official FK documentation](https://docs.pingcap.com/tidb/stable/foreign-key/).',
  '- Migration 083 uses a virtual generated column and an index. TiDB documents indexing generated columns and supports IFNULL; the target version and exact migration still require integration validation. [Generated-column documentation](https://docs.pingcap.com/tidb/stable/generated-columns/), [IFNULL documentation](https://docs.pingcap.com/tidb/stable/control-flow-functions/).',
  '- The session representation decision retains `VARCHAR(32)` canonical UTC ISO strings; TiDB `TIMESTAMP` display depends on session time zone while `DATETIME` is not time-zone adjusted. [Date/time types](https://docs.pingcap.com/tidb/stable/data-type-date-and-time/), [time-zone support](https://docs.pingcap.com/tidb/stable/configure-time-zone/).', '',
  '### Remaining completion blockers', '',
  '- Resolve the `users` uniqueness/nullability/default contract and the stale admission writer comment against current behavior and existing data state.',
  '- Resolve `user_roles.id` versus the composite key without breaking the current writer and migration 032 contract.',
  '- Decide whether proprietor login remains a separate authentication path; if retained, supply a TiDB schema and provisioning contract for `portal_users`.',
  '- Reconcile the rich HR `staff_profiles` contract with the newer provisioning writer fields and identifier relationships.',
  '- Establish parent-link archival/guardian policy and intended TiDB-level relationship constraints.',
  '- Specify session cleanup/retention; the inspected code revokes and expires sessions but has no durable expired-row cleanup job.',
  '- Verify the target TiDB version and the complete FK/index/type/action matrix; no live target version was queried.',
  '- Investigate the 17 source-linked names without extracted SQL and review the 75 migration-only names before retiring any object.',
  '- Review the six fee reporting views against active supported workflows and disposition both historical class database views.',
  '- Test the generated-column migration and the canonical schema against an isolated TiDB instance in a later authorized phase.', ''
].join('\n');
const phase2bPath = resolve(root, 'docs/tidb-runtime-contract-reconciliation.md');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(reportPath, `${report}\n\n${phase2bSections}\n`);
await writeFile(phase2bPath, `# TiDB runtime contract reconciliation — Phase 2B\n\n${phase2bSections}\n`);
process.stdout.write(JSON.stringify({ ok: true, manifestPath: relative(root, manifestPath), reportPath: relative(root, reportPath), phase2bPath: relative(root, phase2bPath), ...manifest.unresolvedSummary, tableDispositionCounts: runtimeContractReconciliation.tableDispositionCounts, viewDispositionCounts: runtimeContractReconciliation.viewDispositionCounts, tableCount: tables.length, viewCount: viewNames.size, runtimeSqlEvidenceCount: runtimeOperations.length }) + '\n');
