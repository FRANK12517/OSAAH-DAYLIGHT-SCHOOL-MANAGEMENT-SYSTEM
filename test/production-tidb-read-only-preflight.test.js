import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRODUCTION_DATABASE, REQUIRED_RELATIONSHIPS, REQUIRED_SCHEMA, runProductionTiDBPreflight } from '../scripts/production-tidb-read-only-preflight.mjs';

const connectionString = 'mysql://readonly:never-print-this@tidb.example.test:4000/osaahdaylightschool';

function databaseFixture({ omitColumn = null, accessDenied = false, missingRelationship = null, duplicateIds = [] } = {}) {
  const columns = Object.entries(REQUIRED_SCHEMA).flatMap(([tableName, names]) => names.filter((columnName) => `${tableName}.${columnName}` !== omitColumn).map((columnName) => ({ tableName, columnName, dataType: ['permanent_student_id', 'student_id'].includes(columnName) ? 'varchar' : 'varchar', characterMaximumLength: 100 })));
  const tables = Object.keys(REQUIRED_SCHEMA).map((tableName) => ({ tableName }));
  const relationships = REQUIRED_RELATIONSHIPS.filter((item) => item.join('.') !== missingRelationship).map(([tableName, columnName, referencedTable, referencedColumn]) => ({ tableName, columnName, referencedTable, referencedColumn }));
  const indexes = [
    { tableName: 'students', indexName: 'uq_students_school_permanent_id', columnName: 'school_id', nonUnique: 0, position: 1 },
    { tableName: 'students', indexName: 'uq_students_school_permanent_id', columnName: 'permanent_student_id', nonUnique: 0, position: 2 },
    { tableName: 'students', indexName: 'uq_students_permanent_student_id_global', columnName: 'permanent_student_id', nonUnique: 0, position: 1 },
    { tableName: 'student_id_reservations', indexName: 'uq_student_id_reservation_permanent', columnName: 'permanent_student_id', nonUnique: 0, position: 1 },
    ...['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current'].map((columnName, position) => ({ tableName: 'student_enrollments', indexName: 'uq_student_enrollment_context', columnName, nonUnique: 0, position: position + 1 }))
  ];
  const statements = [];
  const adapter = {
    async query(sql, params = []) {
      statements.push(sql);
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Only read-only queries are permitted in this fixture.');
      if (accessDenied) throw Object.assign(new Error('redacted'), { code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, sqlState: '28000' });
      if (sql.includes('SELECT DATABASE()')) return [{ databaseName: PRODUCTION_DATABASE, serverVersion: '8.5.3-TiDB-v8.5.3' }];
      if (sql.includes('information_schema.TABLES')) return tables;
      if (sql.includes('information_schema.COLUMNS')) return columns;
      if (sql.includes('information_schema.STATISTICS')) return indexes;
      if (sql.includes('GROUP BY permanent_student_id HAVING COUNT(*)>1')) return duplicateIds;
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return relationships;
      throw new Error('Unexpected query.');
    },
    async close() {}
  };
  return { adapter, statements };
}

function dependencies(fixture, changes = {}) {
  return {
    environment: { DATABASE_URL: connectionString },
    adapterFactory: ({ environment }) => {
      assert.equal(environment.OSAAH_DATABASE_ADAPTER, 'tidb');
      assert.equal(environment.TIDB_SSL_REJECT_UNAUTHORIZED, 'true');
      return fixture.adapter;
    },
    dnsLookup: async (host) => { assert.equal(host, 'tidb.example.test'); return [{ address: '192.0.2.10', family: 4 }]; },
    checkTcp: async (host, port) => { assert.equal(host, 'tidb.example.test'); assert.equal(port, 4000); return true; },
    write: () => {},
    ...changes
  };
}

test('read-only TiDB preflight verifies target, connectivity, registration schema, ID uniqueness, and class relationships', async () => {
  const fixture = databaseFixture();
  const result = await runProductionTiDBPreflight(dependencies(fixture));
  assert.equal(result.ok, true);
  assert.deepEqual(result.connectivity, { dnsResolved: true, tcpConnected: true, authenticated: true, databaseMatches: true, tidbIdentified: true });
  assert.equal(result.schema.ready, true);
  assert.equal(result.schema.observedRelationships.length, REQUIRED_RELATIONSHIPS.length);
  assert.equal(result.schema.requiredIndexes.enrollmentContextUniqueIndex, true);
  assert.equal(result.schema.requiredIndexes.globalPermanentIdUniqueIndex, true);
  assert.equal(result.schema.duplicatePermanentIdCount, 0);
  assert.equal(result.writesPerformed, false);
  assert.ok(fixture.statements.every((sql) => /^\s*SELECT\b/i.test(sql)));
  const duplicateQuery = fixture.statements.find((sql) => sql.includes('GROUP BY permanent_student_id HAVING COUNT(*)>1'));
  assert.match(duplicateQuery, /WHERE permanent_student_id IS NOT NULL/);
  assert.doesNotMatch(duplicateQuery, /permanent_student_id<>''/);
});

test('preflight reports DNS and network stages without attempting database authentication', async () => {
  const fixture = databaseFixture();
  const dns = await runProductionTiDBPreflight(dependencies(fixture, { dnsLookup: async () => { throw Object.assign(new Error('private host detail'), { code: 'ENOTFOUND' }); } }));
  assert.equal(dns.error.code, 'DNS_LOOKUP_FAILED');
  assert.equal(fixture.statements.length, 0);
  const tcp = await runProductionTiDBPreflight(dependencies(fixture, { checkTcp: async () => { throw Object.assign(new Error('private endpoint detail'), { code: 'ETIMEDOUT' }); } }));
  assert.equal(tcp.error.code, 'TCP_CONNECTION_FAILED');
  assert.equal(fixture.statements.length, 0);
});

test('preflight maps TiDB 1045 to a safe authentication diagnostic without printing credentials', async () => {
  const fixture = databaseFixture({ accessDenied: true });
  const output = [];
  const result = await runProductionTiDBPreflight(dependencies(fixture, { write: (value) => output.push(JSON.stringify(value)) }));
  assert.equal(result.error.code, 'DATABASE_AUTHENTICATION_FAILED');
  assert.equal(result.error.errno, 1045);
  assert.equal(result.error.sqlState, '28000');
  assert.doesNotMatch(output.join('\n'), /never-print-this|tidb\.example\.test|mysql:\/\//);
});

test('preflight fails clearly for a missing schema column and refuses a wrong database name', async () => {
  const fixture = databaseFixture({ omitColumn: 'students.permanent_student_id' });
  const result = await runProductionTiDBPreflight(dependencies(fixture));
  assert.equal(result.ok, false);
  assert.equal(result.schema.ready, false);
  assert.deepEqual(result.schema.missingColumns, ['students.permanent_student_id']);
  assert.deepEqual(result.schema.invalidIdentityColumns, ['students.permanent_student_id']);
  let dnsCalled = false;
  const wrongDatabase = await runProductionTiDBPreflight(dependencies(fixture, {
    environment: { DATABASE_URL: 'mysql://readonly:secret@tidb.example.test/otherdb' },
    dnsLookup: async () => { dnsCalled = true; return []; }
  }));
  assert.equal(wrongDatabase.error.code, 'DATABASE_NAME_MISMATCH');
  assert.equal(dnsCalled, false);
});

test('preflight identifies missing referential constraints', async () => {
  const fixture = databaseFixture({ missingRelationship: 'student_enrollments.student_id.students.id' });
  const result = await runProductionTiDBPreflight(dependencies(fixture));
  assert.equal(result.ok, false);
  assert.deepEqual(result.schema.missingRelationships, ['student_enrollments.student_id->students.id']);
});

test('preflight blocks global permanent ID uniqueness when existing student duplicates exist', async () => {
  const fixture = databaseFixture({ duplicateIds: [{ permanentStudentId: 'redacted-id', duplicateCount: 2 }] });
  const result = await runProductionTiDBPreflight(dependencies(fixture));
  assert.equal(result.ok, false);
  assert.equal(result.schema.ready, false);
  assert.equal(result.schema.duplicatePermanentIdCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /redacted-id/);
});

test('Production preflight workflow uses protected main environment and never emits the connection string', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-tidb-read-only-preflight.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/production-tidb-read-only-preflight.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /OSAAH_DATABASE_ADAPTER: tidb/);
  assert.doesNotMatch(workflow, /echo .*DATABASE_URL|printenv|set -x/);
  assert.match(script, /writesPerformed: false/);
  assert.doesNotMatch(script, /console\.log\(.*(url|password|host)/i);
});
