import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInMemoryMigrationAdapter, createMigrationRunner, discoverMigrations } from '../src/platform/migration-runner.js';
import { verifyResultSlipSchema } from '../src/platform/result-slip-migration-preflight.js';
import {
  assertFinalProductionDatabase,
  FINAL_RESULT_SLIP_CONFIRMATION,
  inspect049Postconditions,
  isViewCompatible,
  parseReconciliation049,
  validateFinalReleaseInputs,
  verify054Postconditions
} from '../src/platform/final-result-slip-reconciliation.js';

const migration049 = await readFile(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url), 'utf8');
const migration054 = await readFile(new URL('../schema/054_durable_score_entry_academic_contract.sql', import.meta.url), 'utf8');
const releaseSha = 'a'.repeat(40);

test('final workflow inputs require exact confirmation, immutable SHA, and database secret presence', () => {
  assert.throws(() => validateFinalReleaseInputs({ confirmation: 'yes', releaseSha, databaseUrl: 'mysql://secret' }), { code: 'CONFIRMATION_MISMATCH' });
  assert.throws(() => validateFinalReleaseInputs({ confirmation: FINAL_RESULT_SLIP_CONFIRMATION, releaseSha: 'main', databaseUrl: 'mysql://secret' }), { code: 'RELEASE_SHA_INVALID' });
  assert.throws(() => validateFinalReleaseInputs({ confirmation: FINAL_RESULT_SLIP_CONFIRMATION, releaseSha, databaseUrl: '' }), { code: 'DATABASE_URL_MISSING' });
  for (const invalid of ['a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), 'refs/tags/v1']) assert.throws(() => validateFinalReleaseInputs({ confirmation: FINAL_RESULT_SLIP_CONFIRMATION, releaseSha: invalid, databaseUrl: 'opaque' }), { code: 'RELEASE_SHA_INVALID' });
  assert.doesNotThrow(() => validateFinalReleaseInputs({ confirmation: FINAL_RESULT_SLIP_CONFIRMATION, releaseSha, databaseUrl: 'opaque' }));
  assert.throws(() => assertFinalProductionDatabase('wrong'), { code: 'DATABASE_TARGET_MISMATCH' });
  assert.doesNotThrow(() => assertFinalProductionDatabase('osaahdaylightschool'));
});

test('049 contract includes production date and amount_paid definitions and all six reporting views', () => {
  const contract = parseReconciliation049(migration049);
  assert.equal(contract.tables.size, 17);
  assert.ok(contract.indexes.length >= 40);
  assert.deepEqual(contract.views.map((view) => view.name), [
    'vw_student_fee_balances', 'vw_fee_overview', 'vw_fee_arrears',
    'vw_published_fee_structures', 'vw_invoice_receipt_register', 'vw_fee_collection_summary'
  ]);
  assert.ok(contract.indexes.some((index) => index.table === 'student_attendance' && index.columns.includes('date')));
  assert.ok(contract.indexes.every((index) => index.table !== 'student_attendance' || !index.columns.includes('attendance_date')));
  assert.match(contract.views.find((view) => view.name === 'vw_invoice_receipt_register').definition, /p\.amount_paid\s+AS\s+amount_paid/i);
  assert.doesNotMatch(contract.views.find((view) => view.name === 'vw_invoice_receipt_register').definition, /p\.amount\b/i);
  const paymentColumns = contract.tables.get('student_fee_payments').columns;
  assert.ok(paymentColumns.includes('amount'));
  assert.ok(!paymentColumns.includes('KEY'));
  assert.ok(!contract.tables.get('fee_obligations').columns.includes('KEY'));
  assert.ok(!contract.tables.get('fee_collection_records').columns.includes('KEY'));
  assert.ok(!contract.tables.get('fee_collection_corrections').columns.includes('KEY'));
  assert.ok(!contract.tables.get('fee_types').columns.includes('UNIQUE'));
  assert.ok(contract.indexes.some((index) => index.table === 'fee_obligations' && index.unique && index.columns.join(',') === 'school_id,idempotency_key'));
  assert.ok(contract.indexes.some((index) => index.table === 'fee_types' && index.unique && index.columns.join(',') === 'school_id,code'));
});

test('049 parser keeps KEY, UNIQUE KEY, and FOREIGN KEY declarations out of column contracts', () => {
  const contract = parseReconciliation049(`CREATE TABLE IF NOT EXISTS parser_contract (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL,
    student_id VARCHAR(64) NOT NULL,
    UNIQUE KEY uq_parser_school_student (school_id, student_id),
    KEY idx_parser_student (student_id),
    CONSTRAINT fk_parser_school FOREIGN KEY (school_id) REFERENCES schools(id)
  );`);
  assert.deepEqual(contract.tables.get('parser_contract').columns, ['id','school_id','student_id']);
  assert.ok(contract.indexes.some((index) => index.table === 'parser_contract' && index.unique && index.columns.join(',') === 'school_id,student_id'));
  assert.ok(contract.indexes.some((index) => index.table === 'parser_contract' && !index.unique && index.columns.join(',') === 'student_id'));
  assert.deepEqual(contract.foreignKeys, [{ table:'parser_contract', name:'fk_parser_school', column:'school_id', referencedTable:'schools', referencedColumn:'id' }]);
});

test('049 postcondition inventory checks actual index columns/order/uniqueness and reports missing views', async () => {
  const contract = parseReconciliation049(migration049);
  const tableColumns = new Map([...contract.tables].map(([name, value]) => [name, new Set(value.columns)]));
  for (const [table, fields] of contract.columns) for (const field of fields.keys()) tableColumns.get(table)?.add(field);
  tableColumns.get('student_fee_payments').delete('amount');
  tableColumns.get('student_fee_payments').add('amount_paid');
  for (const optionalLegacyField of ['provider_reference','created_at','reversed_by','reversed_at','reversal_reason']) tableColumns.get('student_fee_payments').delete(optionalLegacyField);
  const indexes = new Map();
  for (const item of contract.indexes) {
    const key = `${item.table}:${item.unique}:${item.columns.join(',')}`;
    if (!indexes.has(item.table)) indexes.set(item.table, []);
    if (!indexes.get(item.table).some((entry) => `${item.table}:${entry.unique}:${entry.columns.join(',')}` === key)) indexes.get(item.table).push({ name: item.name, unique: item.unique, columns: item.columns });
  }
  const views = new Map(contract.views.map((view) => [view.name, { definition: view.definition, columns: {
    vw_student_fee_balances: ['account_id','school_id','student_id','permanent_student_id','academic_year_id','term_id','class_id','total_charged','total_discount','total_paid','balance'],
    vw_fee_overview: ['school_id','academic_year_id','term_id','student_accounts','expected_fees','discounts','collected','outstanding'],
    vw_fee_arrears: ['account_id','school_id','student_id','permanent_student_id','academic_year_id','term_id','class_id','total_charged','total_discount','total_paid','balance'],
    vw_published_fee_structures: ['id','school_id','academic_year_id','term_id','class_id','fee_type','amount','status'],
    vw_invoice_receipt_register: ['school_id','permanent_student_id','academic_year_id','term_id','class_id','invoice_number','payment_reference','receipt_number','amount_paid','payment_method','payment_date','previous_balance','new_balance','issued_at','payment_status','receipt_status'],
    vw_fee_collection_summary: ['school_id','collection_type','academic_year_id','term_id','collection_period','collection_date','transaction_count','amount_received_minor']
  }[view.name] }]));
  const database = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.TABLES')) return tableColumns.has(params[0]) ? [{ tableName: params[0], tableType: 'BASE TABLE' }] : [];
      if (sql.includes('information_schema.VIEWS')) { const row = views.get(params[0]); return row ? [{ viewName: params[0], viewDefinition: row.definition }] : []; }
      if (sql.includes('information_schema.COLUMNS')) {
        const table = params[0];
        const view = views.get(table);
        if (view) return view.columns.map((columnName) => ({ columnName }));
        return [...(tableColumns.get(table) ?? [])].map((columnName) => ({ columnName }));
      }
      if (sql.includes('information_schema.STATISTICS')) return (indexes.get(params[0]) ?? []).flatMap((index) => index.columns.map((columnName, i) => ({ indexName: index.name || `ix_${params[0]}_${i}`, nonUnique: index.unique ? 0 : 1, sequence: i + 1, columnName })));
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const missingViews = ['vw_invoice_receipt_register', 'vw_fee_collection_summary'];
  for (const view of missingViews) views.delete(view);
  const partial = await inspect049Postconditions(database, migration049);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missingViews, missingViews);
  for (const name of missingViews) {
    const expected = contract.views.find((view) => view.name === name);
    views.set(name, { definition: expected.definition, columns: views.get(name)?.columns ?? {
      vw_invoice_receipt_register: ['school_id','permanent_student_id','academic_year_id','term_id','class_id','invoice_number','payment_reference','receipt_number','amount_paid','payment_method','payment_date','previous_balance','new_balance','issued_at','payment_status','receipt_status'],
      vw_fee_collection_summary: ['school_id','collection_type','academic_year_id','term_id','collection_period','collection_date','transaction_count','amount_received_minor']
    }[name] });
  }
  const legacyCompatible = await inspect049Postconditions(database, migration049);
  assert.equal(legacyCompatible.complete, true);
  assert.equal(legacyCompatible.missingColumns.some((column) => column === 'student_fee_payments.amount'), false);
  assert.equal(legacyCompatible.missingColumns.some((column) => column === 'student_fee_payments.amount_paid'), false);
  assert.equal(legacyCompatible.missingColumns.some((column) => /provider_reference|created_at|reversed_by|reversed_at|reversal_reason/.test(column)), false);
  const freshPaymentContract = await inspect049Postconditions(database, migration049, { createdTables: ['student_fee_payments'] });
  assert.ok(freshPaymentContract.missingColumns.includes('student_fee_payments.amount'));
  views.set('vw_invoice_receipt_register', { definition: 'SELECT p.amount AS amount_paid FROM student_fee_payments p', columns: ['school_id','permanent_student_id','academic_year_id','term_id','class_id','invoice_number','payment_reference','receipt_number','amount_paid','payment_method','payment_date','previous_balance','new_balance','issued_at','payment_status','receipt_status'] });
  const incompatible = await inspect049Postconditions(database, migration049);
  assert.ok(incompatible.incompatibleViews.includes('vw_invoice_receipt_register'));
});

test('049 foreign keys compare table/column targets and preserve compatible metadata', async () => {
  const sql = `CREATE TABLE IF NOT EXISTS scoped_rows (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL,
    FOREIGN KEY (school_id) REFERENCES schools(id)
  );`;
  let fk = { columnName:'school_id', referencedTable:'schools', referencedColumn:'id' };
  const adapter = { async query(statement, params = []) {
    if (statement.includes('information_schema.TABLES')) return [{ tableName:params[0], tableType:'BASE TABLE' }];
    if (statement.includes('information_schema.COLUMNS')) return ['id','school_id'].map((columnName) => ({ columnName }));
    if (statement.includes('information_schema.STATISTICS')) return [{ indexName:'PRIMARY', nonUnique:0, sequence:1, columnName:'id' }];
    if (statement.includes('information_schema.KEY_COLUMN_USAGE')) return fk ? [fk] : [];
    throw new Error(`Unexpected query: ${statement}`);
  } };
  assert.equal((await inspect049Postconditions(adapter, sql)).complete, true);
  fk = { columnName:'school_id', referencedTable:'schools', referencedColumn:'school_id' };
  const incompatible = await inspect049Postconditions(adapter, sql);
  assert.equal(incompatible.complete, false);
  assert.deepEqual(incompatible.missingForeignKeys, [{ table:'scoped_rows', name:null, column:'school_id', referencedTable:'schools', referencedColumn:'id' }]);
});

test('compatible arrears projection is preserved by its semantic definition and columns', () => {
  assert.equal(isViewCompatible('vw_fee_arrears', { definition: 'SELECT account_id,school_id,student_id,permanent_student_id,academic_year_id,term_id,class_id,total_charged,total_discount,total_paid,balance FROM vw_student_fee_balances WHERE balance > 0', columns: ['account_id','school_id','student_id','permanent_student_id','academic_year_id','term_id','class_id','total_charged','total_discount','total_paid','balance'] }), true);
  assert.equal(isViewCompatible('vw_invoice_receipt_register', { definition: 'SELECT p.amount AS amount_paid FROM student_fee_payments p', columns: ['school_id','permanent_student_id','academic_year_id','term_id','class_id','invoice_number','payment_reference','receipt_number','amount_paid','payment_method','payment_date','previous_balance','new_balance','issued_at','payment_status','receipt_status'] }), false);
});

test('corrected 054 keeps canonical identity and legacy subject mapping out of a duplicate table contract', () => {
  assert.match(migration054, /students\.permanent_student_id/);
  assert.match(migration054, /idx_student_profiles_student_id_school ON student_profiles\(school_id, student_id\)/);
  assert.match(migration054, /idx_student_enrollments_durable_scope ON student_enrollments\(school_id, academic_year_id, class_id, is_current, enrollment_status\)/);
  assert.doesNotMatch(migration054, /student_profiles ADD COLUMN IF NOT EXISTS permanent_student_id/i);
  assert.doesNotMatch(migration054, /(?:CREATE TABLE|CREATE (?:UNIQUE )?INDEX)[^;]*subject_class_assignments/i);
  assert.match(migration054, /class_subjects/);
});

test('054 validator accepts canonical IDs, legacy class_subjects, scoped indexes, and required FKs', async () => {
  const contracts = {
    students: { columns: ['id','permanent_student_id','current_class_id'], indexes: [{ name: 'uq_student_pid', unique: true, columns: ['permanent_student_id'] }] },
    student_profiles: { columns: ['school_id','student_master_id','student_id','enrollment_status','updated_at'], indexes: [
      { name: 'profile_master_scope', unique: false, columns: ['school_id','student_master_id'] },
      { name: 'profile_student_scope', unique: false, columns: ['school_id','student_id'] }
    ] },
    parent_student_links: { columns: ['permanent_student_id','relationship_type','link_status','updated_at'], indexes: [] },
    student_enrollments: { columns: ['school_id','academic_year_id','class_id','is_current','enrollment_status'], indexes: [
      { name: 'enrollment_scope', unique: false, columns: ['school_id','academic_year_id','class_id','is_current','enrollment_status'] }
    ] },
    class_subjects: { columns: ['class_id','subject_id'], indexes: [] }
  };
  const fkRows = [
    ['student_profiles','student_master_id','students','id'], ['student_profiles','school_id','schools','id'],
    ['student_enrollments','student_id','students','id'], ['student_enrollments','class_id','classes','id'],
    ['student_enrollments','academic_year_id','academic_years','id']
  ].map(([tableName,columnName,referencedTable,referencedColumn]) => ({ tableName,columnName,referencedTable,referencedColumn }));
  const adapter = { async query(sql, params = []) {
    if (sql.includes('information_schema.TABLES')) return [{ tableName: params[0], tableType: 'BASE TABLE' }];
    if (sql.includes('information_schema.COLUMNS')) return (contracts[params[0]]?.columns ?? []).map((columnName) => ({ columnName }));
    if (sql.includes('information_schema.STATISTICS')) return (contracts[params[0]]?.indexes ?? []).flatMap((index) => index.columns.map((columnName, i) => ({ indexName:index.name, nonUnique:index.unique ? 0 : 1, sequence:i+1, columnName })));
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return fkRows;
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const result = await verify054Postconditions(adapter);
  assert.equal(result.permanentStudentIdSource, 'students.permanent_student_id');
  assert.equal(result.enrollmentMapping, 'class_subjects-compatible');
  assert.equal(result.profileDuplicateIdentityAbsent, true);
});

test('final workflow is manual, main-only, protected, exact-SHA, and applies only the four approved migrations', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../.github/workflows/apply-final-result-slip-reconciliation.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/apply-final-result-slip-reconciliation.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /\[0-9a-f\]\{40\}/);
  assert.match(workflow, /APPLY_FINAL_RESULT_SLIP_RECONCILIATION_049_054_055_056/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.release_sha \}\}/);
  assert.match(script, /versions:\s*\[\.\.\.FINAL_RESULT_SLIP_VERSIONS\]/);
  const contract = await readFile(new URL('../src/platform/final-result-slip-reconciliation.js', import.meta.url), 'utf8');
  assert.match(contract, /FINAL_RESULT_SLIP_VERSIONS = Object\.freeze\(\[49, 54, 55, 56\]\)/);
  assert.doesNotMatch(workflow, /vercel|deploy/i);
});

test('bounded runner verifies each stage before recording it and releases its lock on a stopped stage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'osaah-final-reconciliation-'));
  try {
    const files = [49,50,51,52,53,54,55,56].map((version) => {
      const names = { 49: 'production_schema_reconciliation', 50: 'budget_management', 51: 'income_expense_management', 52: 'durable_auth_sessions', 53: 'forward_production_reconciliation', 54: 'durable_score_entry_academic_contract', 55: 'canonical_academic_scores', 56: 'canonical_ges_assessments' };
      return [`${String(version).padStart(3, '0')}_${names[version]}.sql`, `SELECT ${version};`];
    });
    for (const [name, sql] of files) await writeFile(join(directory, name), sql);
    const migrations = await discoverMigrations(directory);
    const storage = {
      baselines: [{ id: 'base', canonicalDatabase: 'osaahdaylightschool', reconciliationMigration: '049_production_schema_reconciliation.sql' }],
      applied: migrations.filter((migration) => [50,51,52,53].includes(migration.version)).map(({ version,name,checksum }) => ({ version,name,checksum,appliedAt: '2026-09-27T00:00:00Z' }))
    };
    const adapter = createInMemoryMigrationAdapter(storage);
    const runner = createMigrationRunner({ adapter, directory, baselineRequired: true });
    const order = [];
    await runner.applyVersions({ versions: [49,54,55,56], requiredAppliedVersions: [50,51,52,53], applyMigration: async ({ migration }) => order.push(`apply:${migration.version}`), verifyMigration: async ({ migration }) => { order.push(`verify:${migration.version}`); assert.equal(storage.applied.some((row) => row.version === migration.version), false); } });
    assert.deepEqual(order, ['apply:49','verify:49','apply:54','verify:54','apply:55','verify:55','apply:56','verify:56']);
    assert.deepEqual(storage.applied.map((row) => row.version).sort((a,b) => a-b), [49,50,51,52,53,54,55,56]);

    const failureStorage = { baselines: storage.baselines, applied: storage.applied.filter((row) => [50,51,52,53].includes(row.version)) };
    const failureAdapter = createInMemoryMigrationAdapter(failureStorage);
    const failureRunner = createMigrationRunner({ adapter: failureAdapter, directory, baselineRequired: true });
    const failedOrder = [];
    await assert.rejects(failureRunner.applyVersions({ versions: [49,54,55,56], requiredAppliedVersions: [50,51,52,53], applyMigration: async ({ migration }) => failedOrder.push(`apply:${migration.version}`), verifyMigration: async ({ migration }) => { failedOrder.push(`verify:${migration.version}`); if (migration.version === 49) throw Object.assign(new Error('bad 049 postcondition'), { code: 'MIGRATION_049_POSTCONDITION_FAILED' }); } }), { code: 'MIGRATION_049_POSTCONDITION_FAILED' });
    assert.deepEqual(failedOrder, ['apply:49','verify:49']);
    assert.equal(failureStorage.applied.some((row) => row.version === 49), false);
    assert.equal(failureStorage.locked, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('canonical Result Slip schema validator requires only the two contracted durable tables and FKs', async () => {
  const definitions = {
    canonical_academic_scores: { columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','subject_id','class_score','exam_score','total_score','created_at','updated_at'], unique: ['school_id','student_id','class_id','academic_year_id','term_id','subject_id'], fks: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id'],['subject_id','subjects','id']] },
    canonical_ges_assessments: { columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','conduct','attitude','interest','class_teacher_remarks','headteacher_remarks','created_at','updated_at'], unique: ['school_id','student_id','class_id','academic_year_id','term_id'], fks: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id']] }
  };
  const database = { async query(sql, params = []) {
    if (sql.includes('information_schema.TABLES')) return Object.keys(definitions).map((tableName) => ({ tableName, tableType: 'BASE TABLE' }));
    const table = params[0], contract = definitions[table];
    if (sql.includes('information_schema.COLUMNS')) return contract.columns.map((columnName) => ({ columnName }));
    if (sql.includes('information_schema.STATISTICS')) return contract.unique.map((columnName, index) => ({ indexName: 'scope', nonUnique: 0, columnName, sequence: index + 1 }));
    if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return contract.fks.map(([columnName,referencedTable,referencedColumn]) => ({ columnName,referencedTable,referencedColumn }));
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const verified = await verifyResultSlipSchema(database);
  assert.deepEqual(verified.verifiedTables, ['canonical_academic_scores','canonical_ges_assessments']);
  assert.equal(verified.studentIdentity, 'students.id');
});
