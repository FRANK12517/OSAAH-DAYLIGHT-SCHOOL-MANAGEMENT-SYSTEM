import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalTiDBSchemaChecksum, initializeTiDBFreshDatabase, verifyTiDBFreshSchema } from '../src/platform/tidb-fresh-initializer.js';

const rawPlan = {
  kind: 'canonical-fresh-install', dialect: 'tidb', version: 1, views: [],
  statements: ['CREATE TABLE schools (id VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'],
  tables: [{
    name: 'schools', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin',
    columns: [{ name: 'id', type: 'varchar(64)', nullable: false, default: null }],
    primaryKey: ['id'], indexes: [], uniqueConstraints: [], foreignKeys: []
  }]
};
const plan = { ...rawPlan, checksum: canonicalTiDBSchemaChecksum(rawPlan) };

function fakeAdapter({
  database = 'osaahdaylightschool', version = '5.7.25-TiDB-v8.5.0', objects = [],
  engine = 'InnoDB', tableCollation = 'utf8mb4_bin',
  columnRows = [{ columnName: 'id', columnType: 'varchar(64)', isNullable: 'NO', columnDefault: null }],
  indexRows = [{ indexName: 'PRIMARY', nonUnique: 0, sequence: 1, columnName: 'id' }], foreignRows = []
} = {}) {
  let ledger = null, locked = false;
  const calls = [];
  return {
    dialect: 'tidb', calls,
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT DATABASE()')) return [{ database_name: database, server_version: version }];
      if (sql.includes('information_schema.TABLES')) return objects.map((name) => ({ name, type: 'BASE TABLE', engine, tableCollation }));
      if (sql.includes('FROM osaah_fresh_installations')) return ledger ? [ledger] : [];
      if (sql.includes('FROM information_schema.COLUMNS')) return columnRows;
      if (sql.includes('FROM information_schema.STATISTICS')) return indexRows;
      if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) return foreignRows;
      throw new Error('Unexpected fake query.');
    },
    async execute(sql, params = []) {
      calls.push(sql);
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS osaah_fresh_installations') && !objects.includes('osaah_fresh_installations')) objects.push('osaah_fresh_installations');
      if (sql.startsWith('INSERT INTO osaah_fresh_installations')) ledger = { canonicalDatabase: params[0], schemaVersion: params[1], schemaChecksum: params[2] };
      if (sql.startsWith('CREATE TABLE schools')) objects.push('schools');
      return { affectedRows: 1 };
    },
    async ensureMetadata({ create = true } = {}) { calls.push(`ensureMetadata:${create}`); },
    async acquireLock() { calls.push('acquireLock'); if (locked) return false; locked = true; return true; },
    async releaseLock() { locked = false; },
    async listApplied() { return []; },
    async listBaselines() { return []; }
  };
}

test('fresh schema postcondition verifier checks canonical TiDB identity and declared metadata', async () => {
  const db = fakeAdapter({ objects: ['schools'] });
  assert.deepEqual(await verifyTiDBFreshSchema(db, plan), {
    valid: true, database: 'osaahdaylightschool', schemaVersion: 1, expectedTableCount: 1, expectedViewCount: 0, issues: []
  });
});

test('fresh schema verifier detects default, extra-column, extra-index, engine, and collation drift', async () => {
  const db = fakeAdapter({
    objects: ['schools'], engine: 'MyISAM', tableCollation: 'latin1_swedish_ci',
    columnRows: [
      { columnName: 'id', columnType: 'varchar(64)', isNullable: 'NO', columnDefault: 'unexpected' },
      { columnName: 'unexpected', columnType: 'varchar(8)', isNullable: 'YES', columnDefault: null }
    ],
    indexRows: [
      { indexName: 'PRIMARY', nonUnique: 0, sequence: 1, columnName: 'id' },
      { indexName: 'idx_unexpected', nonUnique: 1, sequence: 1, columnName: 'id' }
    ]
  });
  const result = await verifyTiDBFreshSchema(db, plan);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('COLUMN_DEFAULT_MISMATCH:schools.id'));
  assert.ok(result.issues.includes('COLUMN_UNEXPECTED:schools.unexpected'));
  assert.ok(result.issues.includes('INDEX_UNEXPECTED:schools.idx_unexpected'));
  assert.ok(result.issues.includes('TABLE_ENGINE_MISMATCH:schools'));
  assert.ok(result.issues.includes('TABLE_COLLATION_MISMATCH:schools'));
  assert.ok(result.issues.includes('TABLE_CHARSET_MISMATCH:schools'));
});

test('fresh schema verifier checks foreign-key columns and referential actions', async () => {
  const raw = {
    ...rawPlan,
    tables: [{
      ...rawPlan.tables[0],
      foreignKeys: [{ name: 'fk_schools_parent', columns: ['id'], referencedTable: 'schools', referencedColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT' }]
    }]
  };
  const fkPlan = { ...raw, checksum: canonicalTiDBSchemaChecksum(raw) };
  const db = fakeAdapter({ objects: ['schools'], foreignRows: [{
    constraintName: 'fk_schools_parent', columnName: 'id', referencedTable: 'schools', referencedColumn: 'id', sequence: 1, deleteRule: 'RESTRICT', updateRule: 'RESTRICT'
  }] });
  const result = await verifyTiDBFreshSchema(db, fkPlan);
  assert.ok(result.issues.includes('FOREIGN_KEY_MISSING_OR_MISMATCH:schools.fk_schools_parent'));
  assert.ok(result.issues.includes('FOREIGN_KEY_UNEXPECTED:schools.fk_schools_parent'));
});

test('fresh initializer refuses any nonempty application database before schema DDL', async () => {
  const db = fakeAdapter({ objects: ['users'] });
  await assert.rejects(() => initializeTiDBFreshDatabase({ adapter: db, plan }), (error) => error.code === 'FRESH_DATABASE_NOT_EMPTY');
  assert.equal(db.calls.some((sql) => sql.startsWith('CREATE TABLE schools')), false);
  assert.equal(db.calls.some((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')), false);
  assert.equal(db.calls.some((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS osaah_fresh_installations')), false);
  assert.equal(db.calls.some((sql) => sql.startsWith('ensureMetadata:')), false);
});

test('fresh initializer treats a schema with no completion record as interrupted and never replays DDL', async () => {
  const db = fakeAdapter({ objects: ['users', 'osaah_fresh_installations'] });
  await assert.rejects(() => initializeTiDBFreshDatabase({ adapter: db, plan }), (error) => error.code === 'FRESH_SCHEMA_RECOVERY_REQUIRED');
  assert.equal(db.calls.includes('ensureMetadata:false'), true);
  assert.equal(db.calls.some((sql) => sql.startsWith('CREATE TABLE schools')), false);
});

test('fresh initializer refuses the wrong database identity before metadata or schema changes', async () => {
  const db = fakeAdapter({ database: 'osaah_daylight_db' });
  await assert.rejects(() => initializeTiDBFreshDatabase({ adapter: db, plan }), (error) => error.code === 'DATABASE_NAME_MISMATCH');
  assert.equal(db.calls.length, 1);
});

test('fresh initializer records only after verification and repeated runs verify instead of replaying DDL', async () => {
  const db = fakeAdapter();
  const first = await initializeTiDBFreshDatabase({ adapter: db, plan, now: new Date('2026-10-31T12:00:00.000Z') });
  const ddlCount = db.calls.filter((sql) => sql.startsWith('CREATE TABLE schools')).length;
  const second = await initializeTiDBFreshDatabase({ adapter: db, plan });
  assert.equal(first.status, 'INITIALIZED');
  assert.equal(second.status, 'ALREADY_INITIALIZED');
  assert.equal(db.calls.filter((sql) => sql.startsWith('CREATE TABLE schools')).length, ddlCount);
});

test('fresh initializer rejects schema plans without explicit canonical provenance and full metadata contracts', async () => {
  await assert.rejects(() => verifyTiDBFreshSchema(fakeAdapter(), { ...plan, kind: 'historical-migration' }), (error) => error.code === 'FRESH_SCHEMA_PLAN_INVALID');
  const incomplete = { ...rawPlan, tables: [{ ...rawPlan.tables[0], columns: [{ name: 'id', type: 'varchar(64)', nullable: false }] }] };
  incomplete.checksum = canonicalTiDBSchemaChecksum(incomplete);
  await assert.rejects(() => verifyTiDBFreshSchema(fakeAdapter(), incomplete), (error) => error.code === 'FRESH_SCHEMA_PLAN_INVALID');
});
