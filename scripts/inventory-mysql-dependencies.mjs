import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(root, 'docs/mysql-dependency-inventory.json');
const sourceRoots = ['src', 'scripts'];
const checks = [
  ['mysql2 import/pool', /mysql2(?:\/promise)?|createPool\s*\(|createConnection\s*\(/gi],
  ['DATABASE() / information_schema metadata', /DATABASE\s*\(\)|TABLE_SCHEMA\s*=\s*DATABASE\s*\(\)|information_schema\./gi],
  ['MySQL upsert/ignore', /ON\s+DUPLICATE\s+KEY|INSERT\s+IGNORE/gi],
  ['GROUP_CONCAT', /GROUP_CONCAT\s*\(/gi],
  ['backtick identifier', /`[A-Za-z_][A-Za-z0-9_]*`/g],
  ['boolean integer coercion', /(?:\b(?:is_current|is_active|is_test_record|active|enabled)\s*=\s*[01]\b|COALESCE\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\.)?(?:is_current|is_active|is_test_record|active|enabled)\s*,\s*[01]\s*\))/gi],
  ['MySQL insert/result metadata', /LAST_INSERT_ID\s*\(|\.insertId\b|\.changedRows\b|\.affectedRows\b/gi],
  ['MySQL transaction API', /beginTransaction\s*\(|\.commit\s*\(|\.rollback\s*\(/gi]
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:js|mjs|cjs|sql)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function statusFor(path, category) {
  if (path === 'src/ai/tidb-database-adapter.js') return { executionPath: 'imported only by standalone legacy migration/maintenance commands; application selector never loads it', classification: 'TiDB/MySQL migration-only compatibility path intentionally retained', requiredPostgresChange: 'Keep this adapter isolated from application startup and OSAAH_POSTGRES_URL.', tests: 'test/tidb-database-adapter.test.js and runtime selector rejection tests.', blocker: false, replacementRequiredForPostgresOperation: false };
  if (path === 'src/ai/postgres-database-adapter.js') return { executionPath: 'application database adapter selected by OSAAH_POSTGRES_URL', classification: 'PostgreSQL runtime path; pool behavior tested with a mock pg pool and PGlite facade, real pg wire protocol unverified', requiredPostgresChange: 'Run against disposable real PostgreSQL before cutover; do not infer wire-protocol compatibility from PGlite.', tests: 'test/postgres-database-adapter.test.js and test/postgres-pglite-application.test.js.', blocker: false, replacementRequiredForPostgresOperation: false };
  if (path === 'src/ai/durable-stores.js' || path === 'src/platform/repositories.js' || category === 'MySQL insert/result metadata') return { executionPath: 'application adapter compatibility contract; callers receive pg rowCount plus legacy affectedRows metadata', classification: 'PostgreSQL-compatible adapter bridge; consumer coverage is selected, not exhaustive', requiredPostgresChange: 'Retain the compatibility shape while callers are migrated; validate each durable workflow on PostgreSQL.', tests: 'Adapter and selected application tests; no real pg connection yet.', blocker: false, replacementRequiredForPostgresOperation: false };
  if (path === 'src/durable-academic.js' && category === 'DATABASE() / information_schema metadata') return { executionPath: 'application runtime schema-presence check scoped to public PostgreSQL catalog', classification: 'PostgreSQL-compatible runtime metadata query', requiredPostgresChange: 'No MySQL conversion required; verify through PostgreSQL application coverage.', tests: 'test/postgres-pglite-application.test.js exercises durable academic score writes, not every schema fallback.', blocker: false, replacementRequiredForPostgresOperation: false };
  if (path.startsWith('scripts/') && (path.includes('supabase-migrate') || path.includes('validate-supabase-migration'))) return { executionPath: 'local-only PostgreSQL migration/validation command', classification: 'PostgreSQL-native operational tooling', requiredPostgresChange: 'No MySQL conversion required; real server status/apply remains unverified.', tests: 'test/supabase-migrate-cli.test.js.', blocker: false, replacementRequiredForPostgresOperation: false };
  if (path.startsWith('scripts/') || path.startsWith('src/platform/') || path.startsWith('src/production-terms-') || path === 'src/production-three-term-config.js') return { executionPath: 'manually invoked migration, reconciliation, inventory, backup, or credential-maintenance command; current callers use TiDB/MySQL adapters or historical schema SQL', classification: 'Legacy TiDB/MySQL maintenance path; not server startup or request runtime', requiredPostgresChange: 'Do not run against PostgreSQL. A PostgreSQL-native replacement is required if this same operational task is needed after cutover. The one-time credential reset is also TiDB-specific.', tests: 'Legacy command tests only; no PostgreSQL compatibility claim.', blocker: false, replacementRequiredForPostgresOperation: true };
  if (path.startsWith('src/')) return { executionPath: 'application module; inspect server route/startup call chain', classification: 'unconverted runtime dependency', requiredPostgresChange: `Convert this ${category} usage to PostgreSQL semantics and test the affected workflow against PostgreSQL.`, tests: 'Add focused repository/route integration coverage against PGlite or disposable PostgreSQL.', blocker: true, replacementRequiredForPostgresOperation: true };
  return { executionPath: 'unclassified', classification: 'unresolved compatibility dependency', requiredPostgresChange: 'Inspect the caller and determine the required database engine before porting or retaining.', tests: 'No PostgreSQL coverage established.', blocker: true, replacementRequiredForPostgresOperation: true };
}

const inventory = [];
for (const base of sourceRoots) {
  for (const path of await files(resolve(root, base))) {
    const rel = relative(root, path).replaceAll('\\', '/');
    if (rel === 'scripts/inventory-mysql-dependencies.mjs') continue;
    const content = await readFile(path, 'utf8');
    for (const [category, expression] of checks) {
      expression.lastIndex = 0;
      const occurrences = [...content.matchAll(expression)];
      if (!occurrences.length) continue;
      const lines = content.split(/\r?\n/);
      const lineSet = new Set();
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (expression.test(lines[lineIndex])) lineSet.add(lineIndex + 1);
        expression.lastIndex = 0;
      }
      inventory.push({ file: rel, category, count: occurrences.length, sampleLines: [...lineSet].slice(0, 25), ...statusFor(rel, category) });
    }
  }
}

inventory.sort((a, b) => a.file.localeCompare(b.file) || a.category.localeCompare(b.category));
const document = {
  generatedAt: new Date().toISOString(),
  scope: sourceRoots,
  note: 'Static lexical inventory only. It scans src/ and scripts/, excludes historical schema/ migration SQL and tests, and classifies matches using source path/caller conventions. Manual caller review is required; it cannot discover dynamic SQL or prove complete PostgreSQL compatibility. Runtime groups classified PostgreSQL-compatible have selected PGlite/mock coverage only; no real pg wire-protocol verification has run.',
  totals: {
    filesWithOccurrences: new Set(inventory.map((item) => item.file)).size,
    dependencyGroups: inventory.length,
    directRuntimeMySqlBlockerGroups: inventory.filter((item) => item.blocker).length,
    legacyTiDBMaintenanceGroups: inventory.filter((item) => item.replacementRequiredForPostgresOperation && !item.blocker).length,
    postgresRuntimeGroupsWithSelectedCoverage: inventory.filter((item) => item.classification.startsWith('PostgreSQL-compatible') || item.classification.startsWith('PostgreSQL runtime')).length,
    unverifiedRealPostgresGroups: inventory.filter((item) => item.classification.includes('unverified') || item.classification.includes('not exhaustive')).length,
    occurrenceCount: inventory.reduce((sum, item) => sum + item.count, 0)
  },
  dependencies: inventory
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
process.stdout.write(`MySQL dependency inventory written: ${document.totals.filesWithOccurrences} files, ${document.totals.dependencyGroups} groups, ${document.totals.directRuntimeMySqlBlockerGroups} direct runtime MySQL blocker groups, ${document.totals.legacyTiDBMaintenanceGroups} legacy maintenance groups, ${document.totals.occurrenceCount} lexical occurrences.\n`);
