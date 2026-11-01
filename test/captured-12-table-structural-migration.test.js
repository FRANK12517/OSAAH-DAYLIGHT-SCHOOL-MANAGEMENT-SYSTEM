import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CAPTURED_MIGRATION_VERSION, CAPTURED_SCHEMA, renderCapturedStructuralMigration } from '../scripts/captured-12-table-structural-migration.mjs';

const canonicalPath = new URL('../supabase/migrations/202610150001_osaah_daylight_schema.sql', import.meta.url);
const auditPath = new URL('../docs/supabase-12-table-reconciliation-audit.md', import.meta.url);
const migrationPath = new URL('../supabase/reconciliation/202610180001_captured_12_table_structural_stage.sql', import.meta.url);
const normalizeLineEndings = (text) => text.replace(/\r\n?/g, '\n');

const capturedFixture = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.assessments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer, subject_id integer, academic_term text NOT NULL, academic_year text NOT NULL, class_score numeric(5,2) DEFAULT 0, exam_score numeric(5,2) DEFAULT 0, total_score numeric(5,2) GENERATED ALWAYS AS (class_score + exam_score) STORED, remarks text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.attendance (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer, class_id integer, attendance_date date NOT NULL, status text NOT NULL, recorded_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.auth_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, token_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.classes (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, class_name text NOT NULL, section text, capacity integer DEFAULT 30, created_at timestamptz DEFAULT now());
CREATE TABLE public.fee_payments (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer, amount_paid numeric(10,2) NOT NULL, payment_method text, reference_number text, academic_term text NOT NULL, academic_year text NOT NULL, recorded_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.role_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL, permission_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.students (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id text NOT NULL, first_name text NOT NULL, last_name text NOT NULL, gender text, date_of_birth date, class_id integer, parent_id uuid, enrollment_status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.subjects (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, subject_code text NOT NULL, subject_name text NOT NULL, class_id integer, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, full_name text NOT NULL, role text NOT NULL, phone_number text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE public.roles ADD CONSTRAINT uq_capture_roles_name UNIQUE(name);
ALTER TABLE public.role_permissions ADD CONSTRAINT uq_capture_role_permissions UNIQUE(role_id,permission_id);
ALTER TABLE public.user_roles ADD CONSTRAINT uq_capture_user_roles UNIQUE(user_id,role_id);
ALTER TABLE public.permissions ADD CONSTRAINT uq_capture_permissions_name UNIQUE(name);
ALTER TABLE public.classes ADD CONSTRAINT uq_capture_classes_name UNIQUE(class_name,section);
ALTER TABLE public.students ADD CONSTRAINT uq_capture_students_id UNIQUE(student_id);
ALTER TABLE public.subjects ADD CONSTRAINT uq_capture_subjects_code UNIQUE(subject_code);
ALTER TABLE public.fee_payments ADD CONSTRAINT uq_capture_fee_reference UNIQUE(reference_number);
ALTER TABLE public.attendance ADD CONSTRAINT uq_capture_attendance UNIQUE(student_id,attendance_date);
ALTER TABLE public.assessments ADD CONSTRAINT uq_capture_assessment UNIQUE(student_id,subject_id,academic_term,academic_year);
ALTER TABLE public.assessments ADD CONSTRAINT chk_capture_class_score CHECK (class_score >= 0);
ALTER TABLE public.assessments ADD CONSTRAINT chk_capture_exam_score CHECK (exam_score >= 0);
ALTER TABLE public.attendance ADD CONSTRAINT chk_capture_attendance_status CHECK (status IN ('present','absent','late','excused'));
ALTER TABLE public.classes ADD CONSTRAINT chk_capture_capacity CHECK (capacity >= 0);
ALTER TABLE public.fee_payments ADD CONSTRAINT chk_capture_amount CHECK (amount_paid >= 0);
ALTER TABLE public.students ADD CONSTRAINT chk_capture_gender CHECK (gender IS NULL OR gender IN ('Male','Female'));
ALTER TABLE public.students ADD CONSTRAINT chk_capture_enrollment CHECK (enrollment_status IS NULL OR enrollment_status IN ('active','graduated','transferred','suspended'));
ALTER TABLE public.users ADD CONSTRAINT chk_capture_email CHECK (length(email) > 0);
ALTER TABLE public.assessments ADD CONSTRAINT fk_capture_assessments_student FOREIGN KEY(student_id) REFERENCES public.students(id);
ALTER TABLE public.assessments ADD CONSTRAINT fk_capture_assessments_subject FOREIGN KEY(subject_id) REFERENCES public.subjects(id);
ALTER TABLE public.attendance ADD CONSTRAINT fk_capture_attendance_student FOREIGN KEY(student_id) REFERENCES public.students(id);
ALTER TABLE public.attendance ADD CONSTRAINT fk_capture_attendance_class FOREIGN KEY(class_id) REFERENCES public.classes(id);
ALTER TABLE public.attendance ADD CONSTRAINT fk_capture_attendance_user FOREIGN KEY(recorded_by) REFERENCES public.users(id);
ALTER TABLE public.auth_sessions ADD CONSTRAINT fk_capture_sessions_user FOREIGN KEY(user_id) REFERENCES public.users(id);
ALTER TABLE public.fee_payments ADD CONSTRAINT fk_capture_payments_student FOREIGN KEY(student_id) REFERENCES public.students(id);
ALTER TABLE public.fee_payments ADD CONSTRAINT fk_capture_payments_user FOREIGN KEY(recorded_by) REFERENCES public.users(id);
ALTER TABLE public.students ADD CONSTRAINT fk_capture_students_class FOREIGN KEY(class_id) REFERENCES public.classes(id);
ALTER TABLE public.students ADD CONSTRAINT fk_capture_students_parent FOREIGN KEY(parent_id) REFERENCES public.users(id);
ALTER TABLE public.subjects ADD CONSTRAINT fk_capture_subjects_class FOREIGN KEY(class_id) REFERENCES public.classes(id);
ALTER TABLE public.role_permissions ADD CONSTRAINT fk_capture_role_permissions_role FOREIGN KEY(role_id) REFERENCES public.roles(id);
ALTER TABLE public.role_permissions ADD CONSTRAINT fk_capture_role_permissions_permission FOREIGN KEY(permission_id) REFERENCES public.permissions(id);
ALTER TABLE public.user_roles ADD CONSTRAINT fk_capture_user_roles_user FOREIGN KEY(user_id) REFERENCES public.users(id);
ALTER TABLE public.user_roles ADD CONSTRAINT fk_capture_user_roles_role FOREIGN KEY(role_id) REFERENCES public.roles(id);
CREATE INDEX capture_idx_users_role ON public.users(role);
CREATE INDEX capture_idx_students_parent ON public.students(parent_id);
CREATE INDEX capture_idx_attendance_recorded_by ON public.attendance(recorded_by);
CREATE INDEX capture_idx_fee_year ON public.fee_payments(academic_year);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
`;

async function migrationSql() {
  const [canonical, audit, saved] = await Promise.all([
    readFile(canonicalPath, 'utf8'), readFile(auditPath, 'utf8'), readFile(migrationPath, 'utf8')
  ]);
  const rendered = renderCapturedStructuralMigration(canonical, audit).sql;
  assert.equal(normalizeLineEndings(saved), normalizeLineEndings(rendered), 'checked-in structural SQL must match the canonical source and captured catalog manifest');
  return normalizeLineEndings(saved);
}

async function seedCapturedDatabase({ extraColumn = false, invalidType = false, invalidGeneration = false, duplicateKeys = false, extraTable = false } = {}) {
  const database = new PGlite();
  let fixture = capturedFixture;
  if (extraColumn) fixture = fixture.replace('updated_at timestamptz DEFAULT now());\nALTER TABLE public.roles', 'updated_at timestamptz DEFAULT now(), unexpected text);\nALTER TABLE public.roles');
  if (invalidType) fixture = fixture.replace('email text NOT NULL UNIQUE', 'email varchar(255) NOT NULL UNIQUE');
  if (invalidGeneration) fixture = fixture.replace('class_score + exam_score', 'class_score - exam_score');
  if (duplicateKeys) fixture = fixture.replace('email text NOT NULL UNIQUE', 'email text NOT NULL').replace('ALTER TABLE public.users ADD CONSTRAINT chk_capture_email', 'ALTER TABLE public.users ADD CONSTRAINT uq_capture_users_full_name UNIQUE(full_name);\nALTER TABLE public.users ADD CONSTRAINT chk_capture_email');
  if (extraTable) fixture += '\nCREATE TABLE public.unexpected_extra_table (id uuid PRIMARY KEY);\n';
  await database.exec(fixture);
  await database.exec(`
    INSERT INTO public.users(id,email,full_name,role) SELECT md5('user'||g)::uuid, ${duplicateKeys ? "'duplicate@example.invalid'" : "'synthetic-'||g||'@example.invalid'"}, 'Synthetic User '||g, 'teacher' FROM generate_series(1,6) g;
    INSERT INTO public.roles(id,name) SELECT md5('role'||g)::uuid, 'synthetic-role-'||g FROM generate_series(1,6) g;
    INSERT INTO public.user_roles(user_id,role_id) SELECT md5('user'||g)::uuid,md5('role'||g)::uuid FROM generate_series(1,6) g;
  `);
  return database;
}

async function sourceCounts(database) {
  return (await database.query(`SELECT table_name, row_count FROM (
    SELECT 'assessments'::text table_name, count(*)::bigint row_count FROM public.assessments
    UNION ALL SELECT 'attendance', count(*) FROM public.attendance
    UNION ALL SELECT 'auth_sessions', count(*) FROM public.auth_sessions
    UNION ALL SELECT 'classes', count(*) FROM public.classes
    UNION ALL SELECT 'fee_payments', count(*) FROM public.fee_payments
    UNION ALL SELECT 'permissions', count(*) FROM public.permissions
    UNION ALL SELECT 'role_permissions', count(*) FROM public.role_permissions
    UNION ALL SELECT 'students', count(*) FROM public.students
    UNION ALL SELECT 'subjects', count(*) FROM public.subjects
    UNION ALL SELECT 'users', count(*) FROM public.users
    UNION ALL SELECT 'roles', count(*) FROM public.roles
    UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles
  ) s ORDER BY table_name`)).rows;
}

test('captured 12-table structural stage installs a private canonical schema and preserves source accounts and assignments', async () => {
  const database = await seedCapturedDatabase();
  try {
    const before = await sourceCounts(database);
    const sql = await migrationSql();
    const comparisonMarker = 'DO $$\nBEGIN\n  IF EXISTS (\n    (SELECT table_name, column_name';
    await database.exec(sql.slice(0, sql.indexOf(comparisonMarker)));
    const catalogDiff = (await database.query(`WITH actual AS (
      SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale, is_nullable='NO' is_not_null, is_identity='YES' is_identity,
        CASE WHEN generation_expression ~ '^\\([^()]*\\)$' THEN substr(generation_expression,2,length(generation_expression)-2) ELSE generation_expression END generation_expression
      FROM information_schema.columns WHERE table_schema='public'
    ), differences AS (
      (SELECT * FROM pg_temp.osaah_captured_expected_columns EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM pg_temp.osaah_captured_expected_columns)
    ) SELECT * FROM differences`)).rows;
    await database.exec('ROLLBACK');
    assert.deepEqual(catalogDiff, []);
    await database.exec(sql);
    assert.deepEqual(await sourceCounts(database), before);
    const catalog = (await database.query(`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE') tables,
      (SELECT count(*)::int FROM information_schema.views WHERE table_schema=$1) views,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='i') indexes,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='f') foreign_keys,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND c.relrowsecurity) rls_tables,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema=$1 AND table_name='users' AND column_name='school_id') has_school_scope_column,
      has_schema_privilege('anon',$1,'USAGE') anon_schema_access,
      has_schema_privilege('authenticated',$1,'USAGE') authenticated_schema_access,
      has_schema_privilege('service_role',$1,'USAGE') service_schema_access,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.schema_migrations WHERE version=$2 AND checksum ~ '^[0-9a-f]{64}$') ledger_entry`, [CAPTURED_SCHEMA, CAPTURED_MIGRATION_VERSION])).rows[0];
    assert.deepEqual(catalog, {
      tables: 159, views: 6, indexes: 294, foreign_keys: 448, rls_tables: 159,
      has_school_scope_column: 1, anon_schema_access: false,
      authenticated_schema_access: false, service_schema_access: false, ledger_entry: 1
    });
    const protectedRows = (await database.query(`SELECT
      (SELECT count(*)::int FROM public.users) users,
      (SELECT count(*)::int FROM public.roles) roles,
      (SELECT count(*)::int FROM public.user_roles) assignments,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.users) prepared_users,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.roles) prepared_roles,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.user_roles) prepared_assignments,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.parent_student_links) parent_links,
      (SELECT count(*)::int FROM ${CAPTURED_SCHEMA}.schools) schools`)).rows[0];
    assert.deepEqual(protectedRows, { users: 6, roles: 6, assignments: 6, prepared_users: 0, prepared_roles: 0, prepared_assignments: 0, parent_links: 0, schools: 0 });
  } finally { await database.close(); }
});

test('captured migration rejects an unexpected public column before creating the prepared schema', async () => {
  const database = await seedCapturedDatabase({ extraColumn: true });
  try {
    const sql = await migrationSql();
    await assert.rejects(() => database.exec(sql), /columns, types, nullability, identity attributes, or generated expressions changed/);
    await database.exec('ROLLBACK');
    assert.equal((await database.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
    assert.equal((await database.query('SELECT count(*)::int count FROM public.users')).rows[0].count, 6);
  } finally { await database.close(); }
});

test('captured migration rejects an incompatible source type before creating the prepared schema', async () => {
  const database = await seedCapturedDatabase({ invalidType: true });
  try {
    const sql = await migrationSql();
    await assert.rejects(() => database.exec(sql), /columns, types, nullability, identity attributes, or generated expressions changed/);
    await database.exec('ROLLBACK');
    assert.equal((await database.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
  } finally { await database.close(); }
});

test('captured migration accepts the observed generated total and rejects a changed generation expression', async () => {
  const accepted = await seedCapturedDatabase();
  try {
    const sql = await migrationSql();
    await accepted.exec(sql);
    assert.equal((await accepted.query(`SELECT to_regnamespace($1) IS NOT NULL present`, [CAPTURED_SCHEMA])).rows[0].present, true);
    assert.equal((await accepted.query(`SELECT count(*)::int count FROM ${CAPTURED_SCHEMA}.schema_migrations`)).rows[0].count, 1);
  } finally { await accepted.close(); }

  const rejected = await seedCapturedDatabase({ invalidGeneration: true });
  try {
    const sql = await migrationSql();
    await assert.rejects(() => rejected.exec(sql), /generated expressions changed/);
    await rejected.exec('ROLLBACK');
    assert.equal((await rejected.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
    assert.equal((await rejected.query('SELECT count(*)::int count FROM public.users')).rows[0].count, 6);
  } finally { await rejected.close(); }
});

test('captured migration rejects an unexpected source table before creating the prepared schema', async () => {
  const database = await seedCapturedDatabase({ extraTable: true });
  try {
    const sql = await migrationSql();
    await assert.rejects(() => database.exec(sql), /table set does not match the approved 12-table profile/);
    await database.exec('ROLLBACK');
    assert.equal((await database.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
  } finally { await database.close(); }
});

test('captured migration rejects duplicate account keys before creating the prepared schema', async () => {
  const database = await seedCapturedDatabase({ duplicateKeys: true });
  try {
    const sql = await migrationSql();
    await assert.rejects(() => database.exec(sql), /Duplicate source account, role, or assignment keys require owner review/);
    await database.exec('ROLLBACK');
    assert.equal((await database.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
    assert.equal((await database.query('SELECT count(*)::int count FROM public.users')).rows[0].count, 6);
  } finally { await database.close(); }
});

test('captured migration refuses a second application through its versioned schema ledger and preserves all rows', async () => {
  const database = await seedCapturedDatabase();
  try {
    const sql = await migrationSql();
    const before = await sourceCounts(database);
    await database.exec(sql);
    await assert.rejects(() => database.exec(sql), /Structural migration target schema already exists/);
    await database.exec('ROLLBACK');
    assert.deepEqual(await sourceCounts(database), before);
    assert.equal((await database.query(`SELECT count(*)::int count FROM ${CAPTURED_SCHEMA}.schema_migrations`)).rows[0].count, 1);
  } finally { await database.close(); }
});

test('a failure after structural DDL rolls back the private schema and preserves source rows', async () => {
  const database = await seedCapturedDatabase();
  try {
    const sql = (await migrationSql()).replace('COMMIT;', "SELECT osaah_nonexistent_for_rollback();\nCOMMIT;");
    await assert.rejects(() => database.exec(sql), /osaah_nonexistent_for_rollback/);
    await database.exec('ROLLBACK');
    assert.equal((await database.query(`SELECT to_regnamespace($1) IS NULL absent`, [CAPTURED_SCHEMA])).rows[0].absent, true);
    assert.equal((await database.query('SELECT count(*)::int count FROM public.users')).rows[0].count, 6);
  } finally { await database.close(); }
});

test('the generated migration is versioned and does not seed school, credentials, role mappings, or Parent links', async () => {
  const sql = await migrationSql();
  assert.match(sql, /VALUES \(20261018,'captured-12-table-structural-stage'/);
  assert.match(sql, /sch_default_01/);
  assert.doesNotMatch(sql, /INSERT INTO osaah_recovery_20261018\.(?:schools|users|roles|permissions|role_permissions|user_roles|parent_student_links|auth_sessions)\b/i);
  assert.doesNotMatch(sql, /GRANT\s/i);
});
