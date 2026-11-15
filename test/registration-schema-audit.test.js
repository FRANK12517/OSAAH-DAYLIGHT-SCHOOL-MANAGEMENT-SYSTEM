import assert from 'node:assert/strict';
import test from 'node:test';
import { REGISTRATION_SCHEMA_INDEXES, REGISTRATION_SCHEMA_REQUIREMENTS, runRegistrationSchemaAudit } from '../scripts/registration-schema-audit.mjs';

const versions = [18, 23, 27, 38, 54, 78, 84, 85, 86].map((version) => ({ version, name: `${String(version).padStart(3, '0')}_migration.sql`, checksum: String(version).padStart(64, '0') }));

function adapterFixture({ missingColumn = null, migrationRows = null, badTransferType = false } = {}) {
  const calls = [];
  const adapter = {
    dialect: 'tidb',
    async verifyReadiness() { return { ready: true, engine: 'TiDB', database: 'osaahdaylightschool' }; },
    async query(sql, params = []) {
      assert.match(sql, /^\s*SELECT\b/i, 'audit must issue SELECT-only queries');
      calls.push(sql);
      if (sql.includes('information_schema.TABLES')) return params[0].map((tableName) => ({ tableName }));
      if (sql.includes('information_schema.COLUMNS')) return Object.entries(REGISTRATION_SCHEMA_REQUIREMENTS).flatMap(([tableName, names]) => names.filter((columnName) => `${tableName}.${columnName}` !== missingColumn).map((columnName) => ({ tableName, columnName, columnType: tableName === 'student_profiles' && columnName === 'previous_school' ? (badTransferType ? 'text' : 'varchar(120)') : tableName === 'student_profiles' && columnName === 'previous_class' ? 'varchar(20)' : 'varchar(255)', isNullable: tableName === 'student_profiles' && ['previous_school', 'previous_class'].includes(columnName) ? 'YES' : 'NO' })));
      if (sql.includes('information_schema.STATISTICS')) return REGISTRATION_SCHEMA_INDEXES.flatMap((index, indexNo) => index.columns.map((columnName, offset) => ({ tableName: index.table, indexName: `fixture_${indexNo}`, nonUnique: Number(!index.unique), columnName, sequence: offset + 1 })));
      if (sql.includes('FROM schema_migrations')) return migrationRows ?? [];
      throw new Error('unexpected audit query');
    }
  };
  return { adapter, calls };
}

test('registration schema audit is read-only and validates live schema against migration checksums', async () => {
  const { adapter, calls } = adapterFixture({ migrationRows: versions.filter(({ version }) => [84, 85, 86].includes(version)).map((migration) => ({ ...migration, appliedAt: 'metadata-only' })) });
  const report = await runRegistrationSchemaAudit({ adapter, discover: async () => versions });
  assert.equal(report.result, 'PASS');
  assert.equal(report.connection.mode, 'READ_ONLY');
  assert.equal(report.columns.find(({ column }) => column === 'previous_school').actualType, 'varchar(120)');
  assert.ok(report.migrations.find(({ version }) => version === 86).checksumMatches);
  assert.ok(calls.every((sql) => /^\s*SELECT\b/i.test(sql)));
});

test('registration schema audit fails on a missing registration column or mismatched transfer type', async () => {
  const missing = adapterFixture({ missingColumn: 'student_id_reservations.sequence_number' });
  const report = await runRegistrationSchemaAudit({ adapter: missing.adapter, discover: async () => versions });
  assert.equal(report.result, 'FAIL');
  assert.ok(report.errors.includes('MISSING_COLUMN:student_id_reservations.sequence_number'));
  const wrongType = adapterFixture({ badTransferType: true });
  const typeReport = await runRegistrationSchemaAudit({ adapter: wrongType.adapter, discover: async () => versions });
  assert.ok(typeReport.errors.includes('COLUMN_DEFINITION_MISMATCH:student_profiles.previous_school'));
});

test('registration schema audit requires migration ledger and canonical TiDB identity', async () => {
  const wrongIdentity = adapterFixture();
  wrongIdentity.adapter.verifyReadiness = async () => ({ ready: true, engine: 'TiDB', database: 'other_db' });
  await assert.rejects(() => runRegistrationSchemaAudit({ adapter: wrongIdentity.adapter }), { code: 'DATABASE_IDENTITY_MISMATCH' });
  const noLedger = adapterFixture();
  noLedger.adapter.query = async (sql, params = []) => {
    assert.match(sql, /^\s*SELECT\b/i);
    if (sql.includes('information_schema.TABLES')) return params[0].filter((name) => name !== 'schema_migrations').map((tableName) => ({ tableName }));
    if (sql.includes('information_schema.COLUMNS')) return [];
    if (sql.includes('information_schema.STATISTICS')) return [];
    throw new Error('ledger should not be queried without table');
  };
  await assert.rejects(() => runRegistrationSchemaAudit({ adapter: noLedger.adapter }), { code: 'MIGRATION_LEDGER_MISSING' });
});
