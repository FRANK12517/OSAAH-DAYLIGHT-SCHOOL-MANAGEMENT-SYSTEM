import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { bindPostgresParameters, createDatabaseAdapter } from '../src/ai/postgres-database-adapter.js';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';
import { createDurableFeeReader } from '../src/durable-fee-reader.js';
import { createDurableResultBlockingService } from '../src/durable-result-blocking.js';
import { createDatabaseRepository } from '../src/platform/repositories.js';
import { createAcademicCalendarService } from '../src/academic-calendar.js';
import { createDurableAcademicService } from '../src/durable-academic.js';

const migrationPath = new URL('../supabase/migrations/202610150001_osaah_daylight_schema.sql', import.meta.url);
const setupPath = new URL('../supabase/osaah_supabase_setup.sql', import.meta.url);

function pglitePool(database) {
  const execute = async (sql, params = []) => {
    if (params.length) return database.query(sql, params);
    const results = await database.exec(sql);
    return results.at(-1) ?? { rows: [], rowCount: 0, command: 'EMPTY' };
  };
  return {
    query: execute,
    async connect() { return { query: execute, release() {} }; },
    async end() { await database.close(); }
  };
}

test('Supabase SQL Editor setup validates roles, refuses collisions and grants backend-only access', async () => {
  const database = new PGlite();
  try {
    const setupSql = await readFile(setupPath, 'utf8');
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await database.exec(setupSql);
    const counts = await database.query(`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
      (SELECT count(*)::int FROM information_schema.views WHERE table_schema='public') AS views,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_tables,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i') AS indexes,
      (SELECT count(*)::int FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace WHERE n.nspname='public' AND con.contype='f') AS foreign_keys,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') AS policies`);
    assert.deepEqual(counts.rows[0], { tables: 159, views: 6, rls_tables: 159, indexes: 294, foreign_keys: 448, policies: 1 });
    const grants = await database.query(`SELECT
      has_table_privilege('anon','public.students','SELECT') AS anon_students,
      has_table_privilege('authenticated','public.parent_student_links','SELECT') AS auth_parent_links,
      has_table_privilege('anon','public.schools','SELECT') AS anon_school,
      has_schema_privilege('service_role','public','USAGE') AS service_schema,
      has_table_privilege('service_role','public.students','SELECT') AS service_students`);
    assert.deepEqual(grants.rows[0], { anon_students: false, auth_parent_links: false, anon_school: true, service_schema: true, service_students: true });
    await assert.rejects(() => database.exec(setupSql), /already exists/);
  } finally { await database.close(); }
});

test('PostgreSQL adapter runs the baseline and preserves admission plus parent Fee Hub behavior in PGlite', async () => {
  const database = new PGlite();
  try {
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    const adapter = createDatabaseAdapter({
      environment: { OSAAH_POSTGRES_URL: 'postgresql://pglite:local@localhost:5432/osaah' },
      poolFactory: () => pglitePool(database),
      retryDelay: async () => {}
    });
    await adapter.executeMigrationSql(await readFile(migrationPath, 'utf8'), { migrationName: 'initial-baseline' });

    for (const [sql, params] of [
      ['INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['year-2026', 'sch_default_01', '2026/2027', '2026-09-01', '2027-07-31']],
      ['INSERT INTO terms(id,academic_year_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['term-1', 'year-2026', '1st Term', '2026-09-01', '2026-12-20']],
      ['INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['class-1', 'sch_default_01', 'Primary 1', 'Primary']],
      ['INSERT INTO roles(id,school_id,role_key,role_name) VALUES (?,?,?,?)', ['role-parent', 'sch_default_01', 'PARENT', 'Parent']],
      ['INSERT INTO users(id,school_id,username,full_name,role,status) VALUES (?,?,?,?,?,?)', ['reviewer-1', 'sch_default_01', 'reviewer', 'Reviewer', 'PROPRIETOR', 'ACTIVE']],
      ['INSERT INTO admission_applications(id,school_id,application_number,stage,applicant_data) VALUES (?,?,?,?,?)', ['application-1', 'sch_default_01', 'APP-001', 'ACCEPTED', JSON.stringify({ studentFirstName: 'Ama', studentSurname: 'Mensah', gender: 'Female', dateOfBirth: '2018-01-02', classAssigned: 'class-1', academicYearId: 'year-2026', termId: 'term-1', parentGuardianName: 'Parent Ama', primaryGuardianPrimaryPhone: '0240000000', primaryGuardianEmail: 'parent@example.test' })]]
    ]) await adapter.execute(sql, params);

    let id = 0;
    const enrollment = createAdmissionEnrollmentService({ database: adapter, clock: () => '2026-09-13T00:00:00.000Z', idFactory: () => `generated-${++id}` });
    const enrolled = await enrollment.enroll({ applicationId: 'application-1', actorId: 'reviewer-1' });
    assert.equal(enrolled.created, true);
    assert.equal(enrolled.student.permanentStudentId, 'OSAAH/2026/001');
    const repeatedEnrollment = await enrollment.enroll({ applicationId: 'application-1', actorId: 'reviewer-1' });
    assert.equal(repeatedEnrollment.created, false);
    assert.equal((await adapter.query('SELECT is_test_record AS "isTestRecord" FROM students WHERE id=?', [enrolled.student.id]))[0].isTestRecord, false);
    const repository = createDatabaseRepository({ adapter, table: 'student_profiles', serialize: (value) => ({ id: value.id, school_id: value.schoolId }) });
    const profile = (await adapter.query('SELECT id,school_id AS "schoolId" FROM student_profiles WHERE id=?', [enrolled.profileId]))[0];
    assert.ok(await repository.replace(profile.id, profile.schoolId, profile), 'PostgreSQL rowCount must report a successful repository update');
    assert.equal(await repository.remove('missing-profile', profile.schoolId), false, 'a zero-row PostgreSQL delete remains a miss');
    assert.equal((await adapter.query('SELECT COUNT(*)::int AS count FROM parent_student_links WHERE parent_user_id=? AND student_id=? AND link_status=?', [enrolled.parentUserId, enrolled.profileId, 'ACTIVE']))[0].count, 1);
    assert.equal((await adapter.query('SELECT new_value FROM audit_logs WHERE entity_id=?', [enrolled.student.id]))[0].new_value.applicationId, 'application-1');
    const calendar = createAcademicCalendarService({ database: adapter, schoolId: 'sch_default_01', now: () => '2026-09-13T00:00:00.000Z' });
    const calendarActor = { id: 'reviewer-1', roleKey: 'PROPRIETOR', schoolId: 'sch_default_01' };
    const event = await calendar.create({ title: 'Reopening', academicYear: '2026/2027', term: '1st Term', category: 'Reopening', startDate: '2026-09-14', endDate: '2026-09-14', allDay: true }, calendarActor);
    assert.equal((await adapter.query('SELECT all_day FROM academic_calendar_events WHERE id=?', [event.id]))[0].all_day, true);
    await calendar.update(event.id, { ...event, allDay: false }, calendarActor);
    assert.equal((await adapter.query('SELECT all_day FROM academic_calendar_events WHERE id=?', [event.id]))[0].all_day, false);

    await adapter.execute('INSERT INTO subjects(id,school_id,code,name,subject_type,is_scoring,is_active,assessment_components_json) VALUES (?,?,?,?,?,?,?,?)', ['subject-math', 'sch_default_01', 'MATH', 'Mathematics', 'CORE', true, true, JSON.stringify([])]);
    await adapter.execute('INSERT INTO subject_class_assignments(id,school_id,subject_id,class_id,academic_year_id,active) VALUES (?,?,?,?,?,?)', ['assignment-math', 'sch_default_01', 'subject-math', 'class-1', 'year-2026', true]);
    let scoreId = 0;
    const academics = createDurableAcademicService({ database: adapter, schoolId: 'sch_default_01', idFactory: () => `score-${++scoreId}`, clock: () => '2026-09-13T00:00:00.000Z' });
    const marksActor = { ...calendarActor, permissions: new Set(['marks.write', 'subjects.read', 'academics.read']) };
    const scoreInput = { studentId: enrolled.student.id, classId: 'class-1', subjectId: 'subject-math', academicYear: '2026/2027', term: '1st Term', caScore: 40, examScore: 45 };
    const firstScore = await academics.saveScore(scoreInput, marksActor);
    assert.equal(firstScore.id, 'score-1');
    assert.equal(firstScore.totalScore, 85);
    const updatedScore = await academics.saveScore({ ...scoreInput, caScore: 42, examScore: 45 }, marksActor);
    assert.equal(updatedScore.id, firstScore.id);
    assert.equal((await adapter.query('SELECT ca_score,total_score FROM academic_score_records WHERE id=?', [firstScore.id]))[0].total_score, '87.00');
    await assert.rejects(() => adapter.transaction(async (tx) => {
      await tx.execute('INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['rollback-year', 'sch_default_01', 'Rollback', '2025-09-01', '2026-07-31']);
      throw new Error('force rollback');
    }), /force rollback/);
    assert.deepEqual(await adapter.query('SELECT id FROM academic_years WHERE id=?', ['rollback-year']), []);

    let blockId = 0;
    const resultBlocking = createDurableResultBlockingService({ database: adapter, schoolId: 'sch_default_01', idFactory: () => `block-${++blockId}`, now: () => '2026-09-13T00:00:00.000Z' });
    const resultActor = { id: 'reviewer-1', schoolId: 'sch_default_01', roleKey: 'HEADTEACHER' };
    const firstBlock = await resultBlocking.blockResults({ academicYear: '2026/2027', term: '1st Term', classId: 'class-1', reason: 'Clearance' }, resultActor);
    const repeatedBlock = await resultBlocking.blockResults({ academicYear: '2026/2027', term: '1st Term', classId: 'class-1', reason: 'Updated clearance' }, resultActor);
    assert.equal(repeatedBlock.id, firstBlock.id);
    assert.equal(repeatedBlock.reason, 'Updated clearance');

    const accountId = 'account-1', invoiceId = 'invoice-1', paymentId = 'payment-1';
    await adapter.execute('INSERT INTO student_fee_accounts(id,school_id,student_id,permanent_student_id,academic_year_id,term_id,class_id,created_by) VALUES (?,?,?,?,?,?,?,?)', [accountId, 'sch_default_01', enrolled.student.id, enrolled.student.permanentStudentId, 'year-2026', 'term-1', 'class-1', 'reviewer-1']);
    await adapter.execute('INSERT INTO fee_invoices(id,school_id,account_id,permanent_student_id,academic_year_id,term_id,class_id,invoice_number,invoice_date,subtotal,total_amount,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [invoiceId, 'sch_default_01', accountId, enrolled.student.permanentStudentId, 'year-2026', 'term-1', 'class-1', 'INV-001', '2026-09-13', 100, 100, 'ISSUED', 'reviewer-1']);
    await adapter.execute('INSERT INTO fee_invoice_items(id,school_id,invoice_id,fee_type,description,amount) VALUES (?,?,?,?,?,?)', ['item-1', 'sch_default_01', invoiceId, 'TUITION', 'Tuition', 100]);
    await adapter.execute('INSERT INTO student_fee_payments(id,school_id,account_id,invoice_id,permanent_student_id,academic_year_id,term_id,class_id,payment_reference,amount,payment_method,payment_date,received_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [paymentId, 'sch_default_01', accountId, invoiceId, enrolled.student.permanentStudentId, 'year-2026', 'term-1', 'class-1', 'PAY-001', 25, 'CASH', '2026-09-13T10:00:00.000Z', 'reviewer-1']);
    await adapter.execute('INSERT INTO student_fee_receipts(id,school_id,payment_id,account_id,permanent_student_id,receipt_number,amount_paid,previous_balance,new_balance,issued_by,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['receipt-1', 'sch_default_01', paymentId, accountId, enrolled.student.permanentStudentId, 'RCT-001', 25, 100, 75, 'reviewer-1', '2026-09-13T10:00:00.000Z']);
    const reader = createDurableFeeReader({ adapter });
    const receipts = await reader.listReceipts({}, { id: enrolled.parentUserId, portal: 'parent', schoolId: 'sch_default_01' });
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].receiptNumber, 'RCT-001');
    assert.equal(receipts[0].studentId, enrolled.student.id);
    assert.equal(receipts[0].feeType, 'TUITION');
    assert.equal(receipts[0].balance, 75);
    assert.deepEqual(await reader.listReceipts({}, { id: 'reviewer-1', portal: 'parent', schoolId: 'sch_default_01' }), []);
    assert.equal(typeof bindPostgresParameters('SELECT $1', ['same-key']).values[0], 'string');

    await assert.rejects(() => adapter.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES (?,?,?,?,?)', ['bad-student', 'wrong-school', 'bad-admission', 'A', 'B']), { code: '23503' });
    await database.exec('SET ROLE anon');
    assert.deepEqual((await database.query('SELECT id FROM public.schools')).rows, [{ id: 'sch_default_01' }]);
    await assert.rejects(() => database.query('SELECT id FROM public.students'), { code: '42501' });
    await database.exec('RESET ROLE');
    await database.exec('SET ROLE authenticated');
    await assert.rejects(() => database.query('SELECT parent_user_id FROM public.parent_student_links'), { code: '42501' });
    await database.exec('RESET ROLE');
  } finally {
    if (database.status !== 'closed') await database.close();
  }
});
