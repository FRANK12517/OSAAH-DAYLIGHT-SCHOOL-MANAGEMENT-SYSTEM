#!/usr/bin/env node
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDatabaseAdapter } from '../src/ai/postgres-database-adapter.js';

const { Pool } = pg;
const URL_ENV = 'OSAAH_PG_INTEGRATION_URL';
const ACK_ENV = 'OSAAH_PG_INTEGRATION_DISPOSABLE';
const ACK = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE';
const BASELINE = resolve('supabase/migrations/202610150001_osaah_daylight_schema.sql');
const MARKER = 'osaah_pg_integration_baseline';
const fail = (code, message) => Object.assign(new Error(message), { code });
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validatedTarget(environment) {
  if (environment[ACK_ENV] !== ACK) throw fail('DISPOSABLE_ACK_REQUIRED', `Set ${ACK_ENV}=${ACK} only after creating a new disposable local database.`);
  const raw = environment[URL_ENV];
  if (!raw) throw fail('INTEGRATION_URL_REQUIRED', `Set ${URL_ENV} to the dedicated disposable test connection URL.`);
  let url;
  try { url = new URL(raw); } catch { throw fail('INTEGRATION_URL_INVALID', `${URL_ENV} must be a valid PostgreSQL URL.`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw fail('INTEGRATION_URL_INVALID', `${URL_ENV} must use postgres:// or postgresql://.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!localHosts.has(url.hostname.toLowerCase())) throw fail('REMOTE_HOST_REFUSED', 'Integration tests accept loopback PostgreSQL hosts only.');
  if (!/^osaah_test_[a-z0-9_]{3,48}$/i.test(database)) throw fail('DATABASE_NAME_REFUSED', 'Disposable database name must start with osaah_test_ and contain only letters, numbers, and underscores.');
  if (/prod|production|supabase|douzohkmnuqwbpwcezke/i.test(`${database} ${url.hostname}`)) throw fail('PRODUCTION_TARGET_REFUSED', 'Database target name is not allowed for disposable integration tests.');
  return { raw, database };
}

async function main(environment = process.env) {
  const target = validatedTarget(environment);
  let currentCheck = 'preflight';
  const pool = new Pool({ connectionString: target.raw, ssl: false, max: 4, connectionTimeoutMillis: 5000, application_name: 'osaah-disposable-pg-integration' });
  let adapter;
  try {
    const migration = await readFile(BASELINE, 'utf8');
    const checksum = createHash('sha256').update(migration).digest('hex');
    const expectedTables = [...migration.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase());
    const expectedViews = [...migration.matchAll(/create\s+or\s+replace\s+view\s+public\.([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase());
    const preflight = await pool.query(`SELECT current_database() AS db, pg_is_in_recovery() AS standby,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) AS public_objects,
      to_regclass('public.${MARKER}') IS NOT NULL AS marker_exists,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated')) AS api_roles`);
    const state = preflight.rows[0];
    if (state.db !== target.database) throw fail('DATABASE_NAME_MISMATCH', 'The server database name does not match the configured disposable target.');
    if (state.standby) throw fail('STANDBY_REFUSED', 'Refusing to run against a read replica.');
    if (state.api_roles !== 2) throw fail('API_ROLES_MISSING', 'Create the PostgreSQL roles anon and authenticated on this disposable local server before running the harness.');
    let baselineApplied = false;
    if (state.public_objects === 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration);
        await client.query('COMMIT');
        baselineApplied = true;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the baseline error. */ }
        throw fail('BASELINE_APPLY_FAILED', `Schema baseline failed (${error.code ?? 'database error'}).`);
      } finally { client.release(); }
    }

    const catalog = await pool.query(`SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname`);
    const expectedObjects = new Map([...expectedTables.map((name) => [name, 'r']), ...expectedViews.map((name) => [name, 'v'])]);
    const actualObjects = new Map(catalog.rows.map((row) => [row.name, row.kind]));
    const hasMarker = actualObjects.has(MARKER);
    if (hasMarker && actualObjects.get(MARKER) !== 'r') throw fail('BASELINE_MARKER_INVALID', 'The integration baseline marker has an unexpected relation type.');
    if (hasMarker) actualObjects.delete(MARKER);
    if (actualObjects.size !== expectedObjects.size || [...expectedObjects].some(([name, kind]) => actualObjects.get(name) !== kind)) {
      throw fail('DATABASE_NOT_EMPTY', 'Refusing this schema: its public tables and views do not exactly match the checked-in baseline.');
    }
    if (state.marker_exists) {
      const marker = await pool.query(`SELECT checksum FROM public.${MARKER} WHERE migration_name=$1`, ['202610150001_osaah_daylight_schema.sql']);
      if (marker.rows.length !== 1 || marker.rows[0].checksum !== checksum) throw fail('BASELINE_CHECKSUM_MISMATCH', 'The local integration baseline marker does not match the checked-in migration.');
    } else {
      await pool.query(`CREATE TABLE public.${MARKER}(migration_name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON public.${MARKER} FROM anon,authenticated; ALTER TABLE public.${MARKER} ENABLE ROW LEVEL SECURITY`);
      await pool.query(`INSERT INTO public.${MARKER}(migration_name,checksum) VALUES ($1,$2)`, ['202610150001_osaah_daylight_schema.sql', checksum]);
    }

    adapter = createDatabaseAdapter({ environment: { OSAAH_POSTGRES_URL: target.raw, OSAAH_PG_SSL_MODE: 'disable', OSAAH_PG_POOL_MAX: '4', OSAAH_PG_APPLICATION_NAME: 'osaah-disposable-pg-integration-adapter' }, retryDelay: async () => {} });
    await adapter.healthCheck().then((result) => { if (!result.healthy) throw fail('ADAPTER_HEALTH_FAILED', 'Adapter health check failed.'); });

    const report = [];
    const check = async (name, callback) => {
      currentCheck = name;
      try { await callback(); }
      catch (error) { error.integrationCheck = name; throw error; }
      report.push(name);
    };
    await check('baseline catalog and fixed school seed', async () => {
      const [objects, school] = await Promise.all([
        adapter.query(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`),
        adapter.query('SELECT id FROM public.schools WHERE id=?', ['sch_default_01'])
      ]);
      if (objects[0].count < 150 || school.length !== 1) throw fail('BASELINE_ASSERTION_FAILED', 'Expected baseline tables and sch_default_01 were not found.');
    });
    await check('parameter binding, boolean, JSONB, dates, timestamps, numeric precision, returning and row counts', async () => adapter.transaction(async (tx) => {
      await tx.execute(`CREATE TEMP TABLE adapter_probe (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text UNIQUE NOT NULL, enabled boolean NOT NULL, payload jsonb NOT NULL, day date NOT NULL, happened_at timestamptz NOT NULL, amount numeric(18,4) NOT NULL) ON COMMIT DROP`);
      const inserted = await tx.execute('INSERT INTO adapter_probe(label,enabled,payload,day,happened_at,amount) VALUES (?,?,?,?,?,?) RETURNING id', ['bound-value', true, JSON.stringify({ safe: true }), '2026-10-15', '2026-10-15T12:34:56.000Z', '123456789012.3400']);
      if (inserted.insertId !== '1' || inserted.rowCount !== 1) throw fail('ADAPTER_ASSERTION_FAILED', 'RETURNING or insert row count did not match.');
      const row = (await tx.query('SELECT enabled,payload,day,happened_at,amount FROM adapter_probe WHERE label=?', ['bound-value']))[0];
      if (row.enabled !== true || row.payload !== '{"safe": true}' || row.day !== '2026-10-15' || row.happened_at !== '2026-10-15 12:34:56+00' || row.amount !== '123456789012.3400') throw fail('ADAPTER_ASSERTION_FAILED', 'PostgreSQL scalar type round trip did not match adapter expectations.');
      const updated = await tx.execute('UPDATE adapter_probe SET enabled=? WHERE label=?', [false, 'bound-value']);
      if (updated.affectedRows !== 1) throw fail('ADAPTER_ASSERTION_FAILED', 'UPDATE row count did not match.');
    }));
    await check('unique and foreign-key SQLSTATE handling', async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute('CREATE TEMP TABLE parent_probe(id integer PRIMARY KEY) ON COMMIT DROP');
        await tx.execute('CREATE TEMP TABLE child_probe(id integer PRIMARY KEY, parent_id integer REFERENCES parent_probe(id), label text UNIQUE) ON COMMIT DROP');
        await tx.execute('INSERT INTO parent_probe VALUES (?)', [1]);
        await tx.execute('INSERT INTO child_probe VALUES (?,?,?)', [1, 1, 'one']);
        await tx.execute('SAVEPOINT unique_check');
        await assertSqlState(() => tx.execute('INSERT INTO child_probe VALUES (?,?,?)', [2, 1, 'one']), '23505');
        await tx.execute('ROLLBACK TO SAVEPOINT unique_check');
        await tx.execute('SAVEPOINT foreign_key_check');
        await assertSqlState(() => tx.execute('INSERT INTO child_probe VALUES (?,?,?)', [3, 99, 'three']), '23503');
        await tx.execute('ROLLBACK TO SAVEPOINT foreign_key_check');
      });
    });
    await check('transaction rollback and connection pooling', async () => {
      await assert.rejects(() => adapter.transaction(async (tx) => { await tx.execute('CREATE TEMP TABLE rollback_probe(value text)'); await tx.execute('INSERT INTO rollback_probe(value) VALUES (?)', ['synthetic']); throw new Error('intentional rollback'); }), /intentional rollback/);
      const poolProbe = await adapter.query('SELECT 1 AS value');
      if (poolProbe[0].value !== 1) throw fail('POOL_ASSERTION_FAILED', 'Pooled adapter query did not succeed after rollback.');
    });
    await check('RLS and API role grants', async () => {
      const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.students'::regclass`);
      if (rls.rows[0]?.relrowsecurity !== true) throw fail('RLS_ASSERTION_FAILED', 'RLS is not enabled on public.students.');
      const client = await pool.connect();
      try {
        await client.query('SET ROLE anon');
        const visible = await client.query('SELECT id FROM public.schools WHERE id=$1', ['sch_default_01']);
        if (visible.rowCount !== 1) throw fail('RLS_ASSERTION_FAILED', 'anon cannot read the canonical public school row.');
        await assertSqlState(() => client.query('SELECT id FROM public.students LIMIT 1'), '42501');
      } finally { await client.query('RESET ROLE'); client.release(); }
    });
    const rollbackOnly = async (callback) => {
      const rollback = new Error('synthetic workflow rollback sentinel');
      try { await adapter.transaction(async (tx) => { await callback(tx); throw rollback; }); }
      catch (error) { if (error !== rollback) throw error; }
    };
    const createUser = (tx, id, role) => tx.execute('INSERT INTO users(id,school_id,full_name,role,status) VALUES (?,?,?,?,?)', [id, 'sch_default_01', `Synthetic ${role}`, role, 'ACTIVE']);
    await check('workflow 1/9 authentication and session revocation (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-auth-user', 'TEACHER');
      await tx.execute('INSERT INTO auth_sessions(id,user_id,school_id,token_hash,expires_at) VALUES (?,?,?,?,?)', ['it-auth-session', 'it-auth-user', 'sch_default_01', createHash('sha256').update('synthetic-session').digest('hex'), '2027-01-01T00:00:00Z']);
      const active = await tx.query('SELECT id FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>now()', ['it-auth-user']);
      if (active.length !== 1) throw fail('WORKFLOW_ASSERTION_FAILED', 'Synthetic session was not active.');
      await tx.execute('UPDATE auth_sessions SET revoked_at=now() WHERE id=?', ['it-auth-session']);
      const revoked = await tx.query('SELECT id FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL', ['it-auth-user']);
      if (revoked.length !== 0) throw fail('WORKFLOW_ASSERTION_FAILED', 'Revoked session remained active.');
    }));
    await check('workflow 2/9 admissions, documents and enrollment (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-admit-actor', 'PROPRIETOR');
      await tx.execute('INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-admit-year', 'sch_default_01', 'Integration Year', '2026-09-01', '2027-07-31']);
      await tx.execute('INSERT INTO terms(id,academic_year_id,name,starts_on,ends_on) VALUES (?,?,?, ?,?)', ['it-admit-term', 'it-admit-year', 'Integration Term', '2026-09-01', '2026-12-20']);
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-admit-class', 'sch_default_01', 'Integration Class', 'Primary']);
      await tx.execute('INSERT INTO admission_applications(id,school_id,application_number,stage,applicant_data) VALUES (?,?,?,?,?)', ['it-admit-app', 'sch_default_01', 'IT-APP-01', 'SUBMITTED', JSON.stringify({ synthetic: true })]);
      await tx.execute('INSERT INTO admission_form_applications(id,school_id,temporary_application_id,application_number,application_date,status,section1_candidate,section2_history,section3_guardians) VALUES (?,?,?,?,?,?,?,?,?)', ['it-admit-form', 'sch_default_01', 'it-temp-app', 'IT-FORM-01', '2026-10-15', 'SUBMITTED', '{}', '{}', '{}']);
      await tx.execute('INSERT INTO admission_documents(id,application_id,school_id,document_type,file_reference) VALUES (?,?,?,?,?)', ['it-admit-doc', 'it-admit-form', 'sch_default_01', 'BIRTH_CERTIFICATE', 'synthetic://document']);
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES (?,?,?,?,?)', ['it-admit-student', 'sch_default_01', 'IT-ADM-01', 'Synthetic', 'Student']);
      await tx.execute('UPDATE admission_applications SET student_id=?,stage=? WHERE id=?', ['it-admit-student', 'ENROLLED', 'it-admit-app']);
      await tx.execute('INSERT INTO student_enrollments(id,school_id,student_id,academic_year_id,academic_year,class_id,class_name,term_id,enrollment_status,is_current) VALUES (?,?,?,?,?,?,?,?,?,?)', ['it-admit-enroll', 'sch_default_01', 'it-admit-student', 'it-admit-year', 'Integration Year', 'it-admit-class', 'Integration Class', 'it-admit-term', 'ACTIVE', true]);
      const rows = await tx.query('SELECT a.stage,d.document_type,e.is_current FROM admission_applications a JOIN admission_documents d ON d.school_id=a.school_id JOIN student_enrollments e ON e.school_id=a.school_id WHERE a.id=? AND d.id=? AND e.id=?', ['it-admit-app', 'it-admit-doc', 'it-admit-enroll']);
      if (rows.length !== 1 || rows[0].stage !== 'ENROLLED' || rows[0].document_type !== 'BIRTH_CERTIFICATE' || rows[0].is_current !== true) throw fail('WORKFLOW_ASSERTION_FAILED', 'Admission document/enrollment relation failed.');
    }));
    await check('workflow 3/9 student profile, parent link and promotion (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-parent', 'PARENT');
      await tx.execute('INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-profile-year1', 'sch_default_01', 'Integration Y1', '2025-09-01', '2026-07-31']);
      await tx.execute('INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-profile-year2', 'sch_default_01', 'Integration Y2', '2026-09-01', '2027-07-31']);
      await tx.execute('INSERT INTO terms(id,academic_year_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-profile-term1', 'it-profile-year1', 'Term 1', '2025-09-01', '2025-12-20']);
      await tx.execute('INSERT INTO terms(id,academic_year_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-profile-term2', 'it-profile-year2', 'Term 1', '2026-09-01', '2026-12-20']);
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-profile-class1', 'sch_default_01', 'Integration P1', 'Primary']);
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-profile-class2', 'sch_default_01', 'Integration P2', 'Primary']);
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name,permanent_student_id) VALUES (?,?,?,?,?,?)', ['it-profile-master', 'sch_default_01', 'IT-PROFILE-01', 'Synthetic', 'Learner', 'OSAAH/2026/998']);
      await tx.execute('INSERT INTO student_profiles(id,student_master_id,school_id,admission_number,first_name,surname,qr_code,class_id) VALUES (?,?,?,?,?,?,?,?)', ['it-profile', 'it-profile-master', 'sch_default_01', 'IT-PROFILE-01', 'Synthetic', 'Learner', 'IT-QR-PROFILE', 'it-profile-class1']);
      await tx.execute('INSERT INTO parent_student_links(parent_user_id,student_id,permanent_student_id,link_status) VALUES (?,?,?,?)', ['it-parent', 'it-profile', 'OSAAH/2026/998', 'ACTIVE']);
      await tx.execute('INSERT INTO student_enrollments(id,school_id,student_id,academic_year_id,term_id,class_id,is_current) VALUES (?,?,?,?,?,?,?)', ['it-profile-enroll1', 'sch_default_01', 'it-profile-master', 'it-profile-year1', 'it-profile-term1', 'it-profile-class1', true]);
      const parentRows = await tx.query('SELECT sp.id FROM parent_student_links p JOIN student_profiles sp ON sp.id=p.student_id JOIN students s ON s.id=sp.student_master_id WHERE p.parent_user_id=? AND p.link_status=? AND s.school_id=?', ['it-parent', 'ACTIVE', 'sch_default_01']);
      if (parentRows.length !== 1 || parentRows[0].id !== 'it-profile') throw fail('WORKFLOW_ASSERTION_FAILED', 'Parent query did not require the active linked profile.');
      await tx.execute('UPDATE student_enrollments SET is_current=false,completed_at=now() WHERE id=?', ['it-profile-enroll1']);
      await tx.execute('INSERT INTO student_enrollments(id,school_id,student_id,academic_year_id,term_id,class_id,is_current) VALUES (?,?,?,?,?,?,?)', ['it-profile-enroll2', 'sch_default_01', 'it-profile-master', 'it-profile-year2', 'it-profile-term2', 'it-profile-class2', true]);
      const enrollmentRows = await tx.query('SELECT class_id FROM student_enrollments WHERE student_id=? AND is_current=true', ['it-profile-master']);
      if (enrollmentRows.length !== 1 || enrollmentRows[0].class_id !== 'it-profile-class2') throw fail('WORKFLOW_ASSERTION_FAILED', 'Promotion did not preserve one current enrollment.');
    }));
    await check('workflow 4/9 student and staff attendance (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-attendance-actor', 'TEACHER');
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-attendance-class', 'sch_default_01', 'Integration Attendance', 'Primary']);
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES (?,?,?,?,?)', ['it-attendance-student', 'sch_default_01', 'IT-ATT-01', 'Synthetic', 'Attendee']);
      await tx.execute('INSERT INTO staff(id,school_id,staff_number,first_name,last_name) VALUES (?,?,?,?,?)', ['it-attendance-staff', 'sch_default_01', 'IT-STAFF-01', 'Synthetic', 'Staff']);
      await tx.execute('INSERT INTO student_attendance(id,school_id,attendance_date,class_id,student_id,academic_year,term,status,entered_by) VALUES (?,?,?,?,?,?,?,?,?)', ['it-student-att', 'sch_default_01', '2026-10-15', 'it-attendance-class', 'it-attendance-student', '2026/2027', '1st Term', 'PRESENT', 'it-attendance-actor']);
      await tx.execute('INSERT INTO staff_attendance(id,school_id,staff_id,attendance_date,attendance_type,academic_year,term,attendance_status,entered_by) VALUES (?,?,?,?,?,?,?,?,?)', ['it-staff-att', 'sch_default_01', 'it-attendance-staff', '2026-10-15', 'DAILY', '2026/2027', '1st Term', 'PRESENT', 'it-attendance-actor']);
      const rows = await tx.query('SELECT s.status AS "studentStatus",t.attendance_status AS "staffStatus" FROM student_attendance s JOIN staff_attendance t ON t.school_id=s.school_id WHERE s.id=? AND t.id=?', ['it-student-att', 'it-staff-att']);
      if (rows.length !== 1 || rows[0].studentStatus !== 'PRESENT' || rows[0].staffStatus !== 'PRESENT') throw fail('WORKFLOW_ASSERTION_FAILED', 'Student or staff attendance round trip failed.');
    }));
    await check('workflow 5/9 terminal and JHS mock result writes/publication (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-results-actor', 'TEACHER');
      await tx.execute('INSERT INTO academic_years(id,school_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-results-year', 'sch_default_01', 'Integration Results', '2026-09-01', '2027-07-31']);
      await tx.execute('INSERT INTO terms(id,academic_year_id,name,starts_on,ends_on) VALUES (?,?,?,?,?)', ['it-results-term', 'it-results-year', 'Term 1', '2026-09-01', '2026-12-20']);
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-results-class', 'sch_default_01', 'Integration Results', 'JHS']);
      await tx.execute('INSERT INTO subjects(id,school_id,code,name) VALUES (?,?,?,?)', ['it-results-subject', 'sch_default_01', 'IT-SUB', 'Synthetic Subject']);
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES (?,?,?,?,?)', ['it-results-master', 'sch_default_01', 'IT-RES-01', 'Synthetic', 'Result']);
      await tx.execute('INSERT INTO student_profiles(id,student_master_id,school_id,admission_number,first_name,surname,qr_code,class_id) VALUES (?,?,?,?,?,?,?,?)', ['it-results-profile', 'it-results-master', 'sch_default_01', 'IT-RES-01', 'Synthetic', 'Result', 'IT-QR-RESULT', 'it-results-class']);
      for (const [id, recordType, mockLabel, score] of [['it-score-terminal', 'TERMINAL', null, 82], ['it-score-mock', 'MOCK', 'Mock 1', 76]]) {
        await tx.execute('INSERT INTO academic_score_records(id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,total_score,entered_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, 'sch_default_01', recordType, mockLabel, 'it-results-year', 'it-results-term', 'it-results-class', 'it-results-profile', 'it-results-subject', score, 'it-results-actor']);
      }
      await tx.execute('INSERT INTO academic_result_records(id,school_id,student_id,class_id,academic_year_id,term_id,examination,mock_label,assessment_json,status,saved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['it-result-published', 'sch_default_01', 'it-results-master', 'it-results-class', 'it-results-year', 'it-results-term', 'MOCK', 'Mock 1', JSON.stringify({ synthetic: true }), 'SAVED', 'it-results-actor']);
      await tx.execute('UPDATE academic_result_records SET status=?,published_by=?,published_at=now() WHERE id=?', ['PUBLISHED', 'it-results-actor', 'it-result-published']);
      const rows = await tx.query('SELECT r.status,s.total_score FROM academic_result_records r JOIN academic_score_records s ON s.mock_label=r.mock_label WHERE r.id=? AND s.id=?', ['it-result-published', 'it-score-mock']);
      if (rows.length !== 1 || rows[0].status !== 'PUBLISHED' || rows[0].total_score !== '76.00') throw fail('WORKFLOW_ASSERTION_FAILED', 'JHS mock result publication/read failed.');
    }));
    await check('workflow 6/9 Fee Hub, payment, receipt and finance (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-fee-actor', 'ACCOUNTANT');
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-fee-class', 'sch_default_01', 'Integration Fees', 'Primary']);
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name,permanent_student_id) VALUES (?,?,?,?,?,?)', ['it-fee-student', 'sch_default_01', 'IT-FEE-01', 'Synthetic', 'Payer', 'OSAAH/2026/997']);
      await tx.execute('INSERT INTO student_fee_accounts(id,school_id,student_id,permanent_student_id,class_id,created_by) VALUES (?,?,?,?,?,?)', ['it-fee-account', 'sch_default_01', 'it-fee-student', 'OSAAH/2026/997', 'it-fee-class', 'it-fee-actor']);
      await tx.execute('INSERT INTO fee_invoices(id,school_id,account_id,permanent_student_id,invoice_number,invoice_date,subtotal,total_amount,created_by) VALUES (?,?,?,?,?,?,?,?,?)', ['it-fee-invoice', 'sch_default_01', 'it-fee-account', 'OSAAH/2026/997', 'IT-INV-01', '2026-10-15', 120.50, 120.50, 'it-fee-actor']);
      await tx.execute('INSERT INTO student_fee_payments(id,school_id,account_id,invoice_id,permanent_student_id,academic_year_id,term_id,class_id,payment_reference,amount,payment_method,payment_date,received_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['it-fee-payment', 'sch_default_01', 'it-fee-account', 'it-fee-invoice', 'OSAAH/2026/997', '2026/2027', '1st Term', 'it-fee-class', 'IT-PAY-01', 20.25, 'CASH', '2026-10-15T10:00:00Z', 'it-fee-actor']);
      await tx.execute('INSERT INTO student_fee_receipts(id,school_id,payment_id,account_id,permanent_student_id,receipt_number,amount_paid,previous_balance,new_balance,issued_by,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['it-fee-receipt', 'sch_default_01', 'it-fee-payment', 'it-fee-account', 'OSAAH/2026/997', 'IT-RCT-01', 20.25, 120.50, 100.25, 'it-fee-actor', '2026-10-15T10:00:00Z']);
      await tx.execute('INSERT INTO general_income(id,school_id,transaction_date,academic_year,term,income_category,description,reference_number,amount,payment_method,payer_or_source,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['it-finance-income', 'sch_default_01', '2026-10-15', '2026/2027', '1st Term', 'OTHER', 'Synthetic income', 'IT-INCOME-01', 20.25, 'CASH', 'Synthetic', 'it-fee-actor', 'it-fee-actor']);
      const rows = await tx.query('SELECT p.amount,r.new_balance,i.amount AS income FROM student_fee_payments p JOIN student_fee_receipts r ON r.payment_id=p.id JOIN general_income i ON i.reference_number=? WHERE p.id=?', ['IT-INCOME-01', 'it-fee-payment']);
      if (rows.length !== 1 || rows[0].amount !== '20.25' || rows[0].new_balance !== '100.25' || rows[0].income !== '20.25') throw fail('WORKFLOW_ASSERTION_FAILED', 'Payment/receipt/finance exact monetary values did not round trip.');
      await assertSqlState(() => tx.execute('INSERT INTO student_fee_payments(id,school_id,account_id,permanent_student_id,academic_year_id,term_id,class_id,payment_reference,amount,payment_method,payment_date,received_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ['it-fee-payment-dup', 'sch_default_01', 'it-fee-account', 'OSAAH/2026/997', '2026/2027', '1st Term', 'it-fee-class', 'IT-PAY-01', 1, 'CASH', '2026-10-15T11:00:00Z', 'it-fee-actor']), '23505').catch((error) => { if (error.code === '23505') return; throw error; });
    }));
    await check('workflow 7/9 staff, RBAC and class assignment (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-staff-user', 'TEACHER');
      await tx.execute('INSERT INTO roles(id,school_id,role_key,role_name) VALUES (?,?,?,?)', ['it-role', 'sch_default_01', 'IT_TEACHER', 'Integration Teacher']);
      await tx.execute('INSERT INTO permissions(id,permission_key,permission_name) VALUES (?,?,?)', ['it-permission', 'it.class.read', 'Integration class read']);
      await tx.execute('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)', ['it-staff-user', 'it-role']);
      await tx.execute('INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)', ['it-role', 'it-permission']);
      await tx.execute('INSERT INTO staff(id,school_id,user_id,staff_number,first_name,last_name) VALUES (?,?,?,?,?,?)', ['it-staff', 'sch_default_01', 'it-staff-user', 'IT-STAFF', 'Synthetic', 'Teacher']);
      await tx.execute('INSERT INTO staff_profiles(id,school_id,staff_id,employee_id,full_name,role_key) VALUES (?,?,?,?,?,?)', ['it-staff-profile', 'sch_default_01', 'it-staff', 'IT-EMPLOYEE', 'Synthetic Teacher', 'IT_TEACHER']);
      await tx.execute('INSERT INTO classes(id,school_id,name,level) VALUES (?,?,?,?)', ['it-staff-class', 'sch_default_01', 'Integration Staff', 'Primary']);
      await tx.execute('INSERT INTO staff_assignments(id,staff_id,class_id) VALUES (?,?,?)', ['it-staff-assignment', 'it-staff-profile', 'it-staff-class']);
      const allowed = await tx.query('SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id JOIN staff st ON st.user_id=ur.user_id JOIN staff_profiles sp ON sp.staff_id=st.id JOIN staff_assignments sa ON sa.staff_id=sp.id WHERE ur.user_id=? AND p.permission_key=? AND sa.class_id=?', ['it-staff-user', 'it.class.read', 'it-staff-class']);
      const denied = await tx.query('SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id JOIN staff st ON st.user_id=ur.user_id JOIN staff_profiles sp ON sp.staff_id=st.id JOIN staff_assignments sa ON sa.staff_id=sp.id WHERE ur.user_id=? AND p.permission_key=? AND sa.class_id=?', ['it-staff-user', 'it.class.read', 'other-class']);
      if (allowed.length !== 1 || denied.length !== 0) throw fail('WORKFLOW_ASSERTION_FAILED', 'Staff permission/class assignment scope failed.');
    }));
    await check('workflow 8/9 announcement and SMS linked-recipient selection (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-comms-actor', 'HEADTEACHER');
      await createUser(tx, 'it-comms-parent', 'PARENT');
      await tx.execute('INSERT INTO students(id,school_id,admission_number,first_name,last_name) VALUES (?,?,?,?,?)', ['it-comms-student', 'sch_default_01', 'IT-COMMS-01', 'Synthetic', 'Child']);
      await tx.execute('INSERT INTO student_profiles(id,student_master_id,school_id,admission_number,first_name,surname,qr_code) VALUES (?,?,?,?,?,?,?)', ['it-comms-profile', 'it-comms-student', 'sch_default_01', 'IT-COMMS-01', 'Synthetic', 'Child', 'IT-QR-COMMS']);
      await tx.execute('INSERT INTO parent_student_links(parent_user_id,student_id,link_status) VALUES (?,?,?)', ['it-comms-parent', 'it-comms-profile', 'ACTIVE']);
      await tx.execute('INSERT INTO announcement_records(id,school_id,title,message,recipient_category,status,sender_id) VALUES (?,?,?,?,?,?,?)', ['it-announcement', 'sch_default_01', 'Synthetic', 'Synthetic message', 'PARENTS', 'PUBLISHED', 'it-comms-actor']);
      await tx.execute('INSERT INTO announcement_recipients(id,school_id,announcement_id,recipient_id,recipient_type) VALUES (?,?,?,?,?)', ['it-announcement-recipient', 'sch_default_01', 'it-announcement', 'it-comms-parent', 'PARENT']);
      await tx.execute('INSERT INTO sms_campaigns(id,school_id,message_body,recipient_mode,selector_json,status,created_by) VALUES (?,?,?,?,?,?,?)', ['it-sms-campaign', 'sch_default_01', 'Synthetic notice', 'LINKED_PARENTS', '{}', 'DRAFT', 'it-comms-actor']);
      await tx.execute('INSERT INTO sms_campaign_recipients(id,school_id,campaign_id,parent_user_id,student_id,normalized_phone,recipient_name,status) VALUES (?,?,?,?,?,?,?,?)', ['it-sms-recipient', 'sch_default_01', 'it-sms-campaign', 'it-comms-parent', 'it-comms-student', '+233240000001', 'Synthetic Parent', 'PENDING']);
      const linked = await tx.query('SELECT r.id FROM sms_campaign_recipients r JOIN parent_student_links l ON l.parent_user_id=r.parent_user_id JOIN student_profiles p ON p.id=l.student_id AND p.student_master_id=r.student_id WHERE r.id=? AND l.link_status=?', ['it-sms-recipient', 'ACTIVE']);
      if (linked.length !== 1) throw fail('WORKFLOW_ASSERTION_FAILED', 'Communication recipient was not constrained by active parent link.');
    }));
    await check('workflow 9/9 export and maintenance catalog access (synthetic rollback)', () => rollbackOnly(async (tx) => {
      await createUser(tx, 'it-export-user', 'ACCOUNTANT');
      await tx.execute('INSERT INTO report_exports(id,school_id,report_type,filters_json,format,generated_by) VALUES (?,?,?,?,?,?)', ['it-export', 'sch_default_01', 'FEE_SUMMARY', JSON.stringify({ synthetic: true }), 'CSV', 'it-export-user']);
      const exported = await tx.query('SELECT report_type,filters_json,format FROM report_exports WHERE id=? AND school_id=? AND generated_by=?', ['it-export', 'sch_default_01', 'it-export-user']);
      const catalog = await tx.query("SELECT table_name FROM information_schema.views WHERE table_schema='public' AND table_name LIKE 'vw_%'");
      if (exported.length !== 1 || exported[0].format !== 'CSV' || catalog.length !== 6) throw fail('WORKFLOW_ASSERTION_FAILED', 'Report export metadata or expected PostgreSQL views were not queryable.');
    }));
    process.stdout.write(`${JSON.stringify({ success: true, database: target.database, baseline: 'supabase/migrations/202610150001_osaah_daylight_schema.sql', baselineApplied, checksum, passed: report.length, checks: report })}\n`);
  } finally {
    if (adapter) await adapter.close();
    await pool.end();
  }
}

async function assertSqlState(operation, expected) {
  try { await operation(); } catch (error) { if (error.code === expected) return; throw error; }
  throw fail('EXPECTED_DATABASE_ERROR_MISSING', `Expected PostgreSQL SQLSTATE ${expected}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, check: error.integrationCheck ?? null, error: error.code ?? 'INTEGRATION_FAILED', message: error.code ? error.message : 'PostgreSQL integration test failed.' })}\n`);
    process.exitCode = 1;
  }
}
