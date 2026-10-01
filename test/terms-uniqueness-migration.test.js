import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInMemoryMigrationAdapter } from '../src/platform/migration-runner.js';
import { detectAcademicYearNameUniqueIndexes } from '../src/production-three-term-config.js';
import { inspectTermsUniquenessPreflight, runTermsUniquenessMigration, TERMS_UNIQUE_MIGRATION } from '../src/production-terms-uniqueness-migration.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const migrationSql = await readFile(new URL('../schema/060_terms_academic_year_name_unique.sql', import.meta.url), 'utf8');
const originalFirstTerm = {
  id: 'term_2026_01', schoolId: 'sch_default_01', academicYearId: 'ay_2026_01',
  name: 'First Term', termNumber: 1, startsOn: '2026-09-01', endsOn: '2026-12-18',
  isCurrent: 1, createdAt: '2026-08-01 00:00:00'
};

const sqliteMigrationCheck = String.raw`
import json, sqlite3, sys
payload=json.load(sys.stdin)
connection=sqlite3.connect(':memory:')
connection.execute('''CREATE TABLE terms (
  id VARCHAR(191) PRIMARY KEY, school_id VARCHAR(191) NOT NULL,
  academic_year_id VARCHAR(191) NOT NULL, name VARCHAR(255) NOT NULL,
  term_number INTEGER NOT NULL, starts_on VARCHAR(50) NOT NULL,
  ends_on VARCHAR(50) NOT NULL, is_current INTEGER NOT NULL,
  created_at VARCHAR(50) NOT NULL
)''')
first=('term_2026_01','sch_default_01','ay_2026_01','First Term',1,'2026-09-01','2026-12-18',1,'2026-08-01 00:00:00')
connection.execute('INSERT INTO terms VALUES (?,?,?,?,?,?,?,?,?)', first)
before=connection.execute('SELECT * FROM terms ORDER BY id').fetchall()
connection.executescript(payload['sql'])
after_migration=connection.execute('SELECT * FROM terms ORDER BY id').fetchall()
indexes=[]
for item in connection.execute("PRAGMA index_list('terms')").fetchall():
  index_name=item[1]
  unique=int(item[2])
  columns=connection.execute("PRAGMA index_info('"+index_name.replace("'","''")+"')").fetchall()
  if index_name == 'uq_terms_academic_year_name':
    indexes.append({'TABLE_SCHEMA':'osaahdaylightschool','TABLE_NAME':'terms','INDEX_NAME':index_name,'NON_UNIQUE':1-unique,'SEQ_IN_INDEX':column[0]+1,'COLUMN_NAME':column[2],'SUB_PART':None} for column in columns)
normalized_indexes=[]
for rows in indexes:
  normalized_indexes.extend(list(rows))
duplicate_rejected=False
try:
  connection.execute('INSERT INTO terms VALUES (?,?,?,?,?,?,?,?,?)', ('term_dup','sch_default_01','ay_2026_01','First Term',2,'2027-01-01','2027-01-02',0,'2026-08-01 00:00:00'))
except sqlite3.IntegrityError:
  duplicate_rejected=True
connection.execute('INSERT INTO terms VALUES (?,?,?,?,?,?,?,?,?)', ('term_other_year','sch_default_01','ay_2027_01','First Term',1,'2027-09-01','2027-12-18',1,'2027-08-01 00:00:00'))
print(json.dumps({
  'before':before,
  'afterMigration':after_migration,
  'duplicateRejected':duplicate_rejected,
  'differentYearAllowed':connection.execute("SELECT COUNT(*) FROM terms WHERE academic_year_id='ay_2027_01' AND name='First Term'").fetchone()[0] == 1,
  'indexes':normalized_indexes,
  'termsAfterMigration':len(after_migration)
}))
`;

function sqliteResult(sql) {
  const result = spawnSync('python3', ['-c', sqliteMigrationCheck], {
    input: JSON.stringify({ sql }), encoding: 'utf8'
  });
  assert.equal(result.status, 0, `python sqlite test failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

const productionColumns = [
  ['id', 'varchar', 'varchar(191)', 191],
  ['school_id', 'varchar', 'varchar(191)', 191],
  ['academic_year_id', 'varchar', 'varchar(191)', 191],
  ['name', 'varchar', 'varchar(255)', 255],
  ['term_number', 'int', 'int', null],
  ['starts_on', 'varchar', 'varchar(50)', 50],
  ['ends_on', 'varchar', 'varchar(50)', 50],
  ['is_current', 'tinyint', 'tinyint', null],
  ['created_at', 'varchar', 'varchar(50)', 50]
].map(([columnName, dataType, columnType, length], index) => ({
  columnName, dataType, columnType, isNullable: 'NO', columnDefault: null,
  characterMaximumLength: length, characterSetName: length ? 'utf8mb4' : null,
  collationName: length ? 'utf8mb4_0900_ai_ci' : null, ordinalPosition: index + 1
}));

function indexRows() {
  return [
    { tableSchema: 'osaahdaylightschool', tableName: 'terms', indexName: 'uq_terms_academic_year_name', nonUnique: 0, seqInIndex: 1, columnName: 'academic_year_id', subPart: null },
    { tableSchema: 'osaahdaylightschool', tableName: 'terms', indexName: 'uq_terms_academic_year_name', nonUnique: 0, seqInIndex: 2, columnName: 'name', subPart: null }
  ];
}

function mockProductionAdapter({ terms = [originalFirstTerm], duplicateRows = [], withUniqueIndex = false } = {}) {
  const state = {
    terms: structuredClone(terms),
    duplicateRows: structuredClone(duplicateRows),
    indexes: withUniqueIndex ? indexRows() : [],
    writes: 0
  };
  const storage = {
    applied: [],
    baselines: [{ reconciliationMigration: '059_backward_compatible_enrollment_contract.sql' }],
    statements: [],
    locked: false
  };
  const base = createInMemoryMigrationAdapter(storage);
  const adapter = {
    ...base,
    storage,
    async query(sql) {
      if (sql.includes('SELECT DATABASE()')) return [{ databaseName: 'osaahdaylightschool' }];
      if (sql.includes('information_schema.TABLES')) return [{ tableName: 'terms' }];
      if (sql.includes('information_schema.COLUMNS')) return structuredClone(productionColumns);
      if (sql.includes('information_schema.STATISTICS')) return structuredClone(state.indexes);
      if (sql.includes('JOIN (')) return structuredClone(state.duplicateRows);
      if (sql.includes('SELECT id, school_id AS schoolId')) return structuredClone(state.terms);
      if (sql.includes('FROM schema_migrations')) return structuredClone(storage.applied.filter((row) => Number(row.version) === TERMS_UNIQUE_MIGRATION.version).map((row) => ({ ...row, appliedAt: row.appliedAt })));
      throw new Error(`Unhandled query: ${sql}`);
    },
    async executeMigrationSql(sql) {
      assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_terms_academic_year_name/i);
      assert.match(sql, /ON terms\s*\(\s*academic_year_id\s*,\s*name\s*\)/i);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE)\b/i);
      storage.statements.push(sql);
      state.indexes = indexRows();
      return { affectedRows: 0 };
    },
    async transaction(work) {
      const transaction = {
        query: adapter.query,
        executeMigrationSql: adapter.executeMigrationSql,
        recordApplied: base.recordApplied.bind(base)
      };
      return work(transaction);
    },
    state
  };
  return adapter;
}

test('migration 060 is one additive unique index on the approved ordered columns and never edits migration 059', async () => {
  assert.equal(TERMS_UNIQUE_MIGRATION.version, 60);
  assert.equal(TERMS_UNIQUE_MIGRATION.name, '060_terms_academic_year_name_unique.sql');
  assert.match(migrationSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_terms_academic_year_name\s+ON terms\s*\(\s*academic_year_id\s*,\s*name\s*\)/i);
  assert.doesNotMatch(migrationSql, /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE|ALTER)\b/i);
  assert.equal(migrationSql.split(';').filter((statement) => statement.trim()).length, 1);
  const migration059 = await readFile(new URL('../schema/059_backward_compatible_enrollment_contract.sql', import.meta.url));
  assert.equal(createHash('sha256').update(migration059).digest('hex'), '15f26ecbd421869172219303069f4591b04dceaff405e1aba6a7b3cf99e06e48');
});

test('TiDB-compatible unique DDL rejects same-year duplicates, allows the same name in another year, and preserves existing rows', () => {
  const result = sqliteResult(migrationSql);
  assert.deepEqual(result.before, result.afterMigration);
  assert.equal(result.termsAfterMigration, 1);
  assert.equal(result.duplicateRejected, true);
  assert.equal(result.differentYearAllowed, true);
  assert.deepEqual(result.afterMigration[0], [
    originalFirstTerm.id, originalFirstTerm.schoolId, originalFirstTerm.academicYearId,
    originalFirstTerm.name, originalFirstTerm.termNumber, originalFirstTerm.startsOn,
    originalFirstTerm.endsOn, originalFirstTerm.isCurrent, originalFirstTerm.createdAt
  ]);
  assert.equal(detectAcademicYearNameUniqueIndexes(result.indexes).length, 1);
  assert.deepEqual(result.indexes.map(({ SEQ_IN_INDEX, COLUMN_NAME }) => [SEQ_IN_INDEX, COLUMN_NAME]), [[1, 'academic_year_id'], [2, 'name']]);
});

test('read-only production preflight reports normalized aliases without rewriting rows', async () => {
  const adapter = mockProductionAdapter({ terms: [originalFirstTerm, { ...originalFirstTerm, id: 'term_legacy_1', name: '1st Term' }] });
  const result = await inspectTermsUniquenessPreflight(adapter);
  assert.equal(result.safeToApplyMigration, true);
  assert.equal(result.databaseDuplicateRowCount, 0);
  assert.equal(result.productionWrites, 'NONE');
  assert.equal(result.canonicalTermNameConflicts.length, 1);
  assert.deepEqual(result.canonicalTermNameConflicts[0].rows.map((row) => row.name).sort(), ['1st Term', 'First Term']);
  assert.equal(adapter.state.writes, 0);
});

test('production preflight awaits each read before issuing the next query', async () => {
  const adapter = mockProductionAdapter();
  const query = adapter.query.bind(adapter);
  let activeQueries = 0;
  let maximumConcurrentQueries = 0;
  const issuedQueries = [];
  adapter.query = async (sql) => {
    activeQueries += 1;
    maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
    issuedQueries.push(sql);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return await query(sql);
    } finally {
      activeQueries -= 1;
    }
  };

  const result = await inspectTermsUniquenessPreflight(adapter);

  assert.equal(result.ok, true);
  assert.equal(issuedQueries.length, 6);
  assert.equal(maximumConcurrentQueries, 1);
  assert.ok(issuedQueries.every((sql) => /^\s*SELECT\b/i.test(sql)));
});

test('preflight fails closed and reports same-year name conflicts using database equality', async () => {
  const duplicateRows = [
    { id: 'term_a', academicYearId: 'ay_2026_01', name: 'First Term', duplicateCount: 2 },
    { id: 'term_b', academicYearId: 'ay_2026_01', name: 'First Term', duplicateCount: 2 }
  ];
  const adapter = mockProductionAdapter({ terms: [originalFirstTerm, { ...originalFirstTerm, id: 'term_dup' }], duplicateRows });
  const result = await inspectTermsUniquenessPreflight(adapter);
  assert.equal(result.safeToApplyMigration, false);
  assert.equal(result.databaseDuplicateRowCount, 2);
  assert.equal(result.exactDuplicateGroups.length, 1);
  assert.deepEqual(result.databaseDuplicateRows.map((row) => row.id), ['term_a', 'term_b']);
  await assert.rejects(() => runTermsUniquenessMigration({ adapter, mode: 'apply' }), (error) => error.code === 'MIGRATION_060_DUPLICATE_TERMS' && error.details.preflight.databaseDuplicateRowCount === 2);
  assert.equal(adapter.storage.statements.length, 0);
  assert.equal(adapter.state.writes, 0);
});

test('read-only preflight requires non-null full-length character columns and reports their production metadata', async () => {
  const adapter = mockProductionAdapter();
  const result = await inspectTermsUniquenessPreflight(adapter);
  assert.equal(result.uniqueColumnContract.ok, true);
  assert.deepEqual(result.uniqueColumnContract.columns.map((column) => [column.name, column.type, column.nullable, column.characterMaximumLength, column.collation]), [
    ['academic_year_id', 'varchar(191)', 'NO', 191, 'utf8mb4_0900_ai_ci'],
    ['name', 'varchar(255)', 'NO', 255, 'utf8mb4_0900_ai_ci']
  ]);
  const nullableAdapter = mockProductionAdapter();
  nullableAdapter.query = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return productionColumns.map((row) => row.columnName === 'name' ? { ...row, isNullable: 'YES' } : row);
    return adapter.query(sql);
  };
  const nullable = await inspectTermsUniquenessPreflight(nullableAdapter);
  assert.equal(nullable.uniqueColumnContract.ok, false);
  assert.equal(nullable.safeToApplyMigration, false);
});

test('migration dry-run is read-only and applies only version 060', async () => {
  const adapter = mockProductionAdapter();
  const dryRun = await runTermsUniquenessMigration({ adapter, mode: 'dry-run' });
  assert.equal(dryRun.ok, true);
  assert.deepEqual(dryRun.pending.map((item) => item.version), [60]);
  assert.equal(dryRun.productionWrites, 'NONE');
  assert.equal(adapter.storage.statements.length, 0);
  assert.deepEqual(adapter.storage.applied, []);
  const applied = await runTermsUniquenessMigration({ adapter, mode: 'apply' });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.applied.map((item) => item.version), [60]);
  assert.equal(adapter.storage.statements.length, 1);
  assert.equal(adapter.storage.applied.length, 1);
  assert.equal(adapter.storage.applied[0].name, TERMS_UNIQUE_MIGRATION.name);
  assert.equal(applied.afterLedger.checksum, applied.migration.checksum);
  assert.equal(applied.termDataUnchanged, true);
  assert.equal(applied.before.termDataSnapshot.sha256, applied.after.termDataSnapshot.sha256);
  assert.equal(detectAcademicYearNameUniqueIndexes(applied.after.indexes).length, 1);
});
