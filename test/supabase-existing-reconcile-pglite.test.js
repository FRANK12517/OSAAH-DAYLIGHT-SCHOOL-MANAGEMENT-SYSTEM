import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/202610150002_reconcile_existing_supabase.sql', import.meta.url);
const validationPath = new URL('../docs/supabase-migration-validation.sql', import.meta.url);

const starterSchema = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, full_name text NOT NULL, role text NOT NULL CHECK (role = ANY (ARRAY['proprietor'::text, 'admin'::text, 'teacher'::text, 'accountant'::text, 'parent'::text])), phone_number text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.classes (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, class_name text UNIQUE NOT NULL, section text, capacity integer DEFAULT 30, created_at timestamptz DEFAULT now());
CREATE TABLE public.students (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id text UNIQUE NOT NULL, first_name text NOT NULL, last_name text NOT NULL, gender text CHECK (gender = ANY (ARRAY['Male'::text, 'Female'::text])), date_of_birth date, class_id integer REFERENCES public.classes(id) ON DELETE SET NULL, parent_id uuid REFERENCES public.users(id) ON DELETE SET NULL, enrollment_status text DEFAULT 'active' CHECK (enrollment_status = ANY (ARRAY['active'::text, 'graduated'::text, 'transferred'::text, 'suspended'::text])), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.subjects (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, subject_code text UNIQUE NOT NULL, subject_name text NOT NULL, class_id integer REFERENCES public.classes(id) ON DELETE CASCADE, created_at timestamptz DEFAULT now());
CREATE TABLE public.attendance (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer REFERENCES public.students(id) ON DELETE CASCADE, class_id integer REFERENCES public.classes(id) ON DELETE CASCADE, attendance_date date NOT NULL, status text NOT NULL CHECK (status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'excused'::text])), recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now(), UNIQUE(student_id, attendance_date));
CREATE TABLE public.assessments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer REFERENCES public.students(id) ON DELETE CASCADE, subject_id integer REFERENCES public.subjects(id) ON DELETE CASCADE, academic_term text NOT NULL, academic_year text NOT NULL, class_score numeric(5,2) DEFAULT 0.00 CHECK (class_score >= 0 AND class_score <= 50), exam_score numeric(5,2) DEFAULT 0.00 CHECK (exam_score >= 0 AND exam_score <= 50), total_score numeric(5,2) GENERATED ALWAYS AS (class_score + exam_score) STORED, remarks text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(student_id, subject_id, academic_term, academic_year));
CREATE TABLE public.fee_payments (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, student_id integer REFERENCES public.students(id) ON DELETE CASCADE, amount_paid numeric(10,2) NOT NULL CHECK (amount_paid > 0), payment_method text CHECK (payment_method = ANY (ARRAY['cash'::text, 'mobile_money'::text, 'bank_transfer'::text, 'paystack'::text])), reference_number text UNIQUE, academic_term text NOT NULL, academic_year text NOT NULL, recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now());
CREATE INDEX idx_students_class ON public.students(class_id);
CREATE INDEX idx_assessments_student ON public.assessments(student_id);
CREATE INDEX idx_attendance_date ON public.attendance(attendance_date);
CREATE INDEX idx_fee_payments_student ON public.fee_payments(student_id);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read access" ON public.classes FOR SELECT TO public USING (true);
CREATE POLICY "Allow anon read access" ON public.students FOR SELECT TO public USING (true);
CREATE POLICY "Allow anon read access" ON public.subjects FOR SELECT TO public USING (true);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
`;

async function createStarterDatabase({ withClassRow = false } = {}) {
  const database = new PGlite();
  await database.exec(starterSchema);
  if (withClassRow) await database.exec("INSERT INTO public.classes(class_name) VALUES ('Nursery 1')");
  return database;
}

async function migrationForFixture(database) {
  const migration = await readFile(migrationPath, 'utf8');
  const signatureStart = migration.indexOf('  WITH\n  cols AS (');
  const signatureEnd = migration.indexOf('  SELECT md5(cols.j::text)', signatureStart);
  assert.notEqual(signatureStart, -1, 'migration must pin the hosted catalog signature');
  assert.notEqual(signatureEnd, -1, 'migration must complete the catalog signature query');
  const signatureSql = migration.slice(signatureStart, signatureEnd)
    + 'SELECT md5(cols.j::text) AS columns_hash, md5(cons.j::text) AS constraints_hash, '
    + 'md5(idx.j::text) AS indexes_hash, md5(seq.j::text) AS sequences_hash, '
    + 'md5(pol.j::text) AS policies_hash, md5(acl.j::text) AS grants_hash, '
    + 'md5(rel.j::text) AS relations_hash, md5(deps.j::text) AS dependencies_hash '
    + 'FROM cols,cons,idx,seq,pol,acl,rel,deps;';
  const signature = (await database.query(signatureSql)).rows[0];
  let fixtureMigration = migration;
  const hostedHashes = [
    '9d02a3ed8acefcfe00c2c2cbb6430397', '6844c600d4797d37d36155d01f12168b',
    '94a3278e3571ab8bae46ca70177a9dcc', '432b0da641ea0b4f25767432136c268b',
    '6090c1ddc1f5f0eeb9e4080a4e1e2014', '2d60fdb728a3461bc69a2d51886f7610',
    'a85c6c94980b8858051973740ede4910', '8dd88753a3c4b98a1e9440383da4da29'
  ];
  const fixtureHashes = [signature.columns_hash, signature.constraints_hash, signature.indexes_hash,
    signature.sequences_hash, signature.policies_hash, signature.grants_hash,
    signature.relations_hash, signature.dependencies_hash];
  for (let i = 0; i < hostedHashes.length; i += 1) fixtureMigration = fixtureMigration.replace(hostedHashes[i], fixtureHashes[i]);
  return fixtureMigration;
}

test('existing-schema migration archives the empty starter schema and installs the canonical OSAAH schema', async () => {
  const database = await createStarterDatabase();
  try {
    const migration = await migrationForFixture(database);
    await database.exec(migration);
    const counts = await database.query(`SELECT
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS app_tables,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='osaah_legacy_20261015' AND table_type='BASE TABLE') AS archived_tables,
      (SELECT count(*)::int FROM information_schema.views WHERE table_schema='public') AS views,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f') AS foreign_keys,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_tables,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') AS policies`);
    assert.deepEqual(counts.rows[0], { app_tables: 159, archived_tables: 7, views: 6, foreign_keys: 448, rls_tables: 159, policies: 1 });

    const school = await database.query("SELECT id FROM public.schools WHERE id='sch_default_01'");
    assert.deepEqual(school.rows, [{ id: 'sch_default_01' }]);
    const access = await database.query(`SELECT
      has_schema_privilege('anon','osaah_legacy_20261015','USAGE') AS anon_archive_schema,
      has_table_privilege('anon','osaah_legacy_20261015.students','SELECT') AS anon_archive_students,
      has_table_privilege('anon','public.students','SELECT') AS anon_app_students,
      has_table_privilege('anon','public.schools','SELECT') AS anon_school,
      has_table_privilege('service_role','public.students','SELECT') AS service_app_students`);
    assert.deepEqual(access.rows[0], {
      anon_archive_schema: false,
      anon_archive_students: false,
      anon_app_students: false,
      anon_school: true,
      service_app_students: true
    });

    await database.exec('SET ROLE anon');
    const anonSchool = await database.query("SELECT id FROM public.schools WHERE id='sch_default_01'");
    assert.deepEqual(anonSchool.rows, [{ id: 'sch_default_01' }]);
    await assert.rejects(() => database.query('SELECT id FROM public.students'), /permission denied/i);
    await database.exec('RESET ROLE');

    const validationSql = await readFile(validationPath, 'utf8');
    await database.exec(validationSql);

    await assert.rejects(() => database.exec(migration), /Preflight stopped: archive schema osaah_legacy_20261015 already exists/);
    await database.exec('ROLLBACK');
    const archived = await database.query("SELECT count(*)::int AS n FROM osaah_legacy_20261015.students");
    assert.equal(archived.rows[0].n, 0);
  } finally {
    await database.close();
  }
});

test('existing-schema migration aborts before moving any table when starter records exist', async () => {
  const database = await createStarterDatabase({ withClassRow: true });
  try {
    const migration = await migrationForFixture(database);
    await assert.rejects(() => database.exec(migration), /public\.classes contains records/);
    await database.exec('ROLLBACK');
    const state = await database.query(`SELECT
      to_regnamespace('osaah_legacy_20261015') IS NULL AS no_archive,
      (SELECT count(*)::int FROM public.classes) AS classes`);
    assert.deepEqual(state.rows[0], { no_archive: true, classes: 1 });
  } finally {
    await database.close();
  }
});

test('existing-schema migration refuses catalog drift before creating the archive', async () => {
  const database = await createStarterDatabase();
  try {
    const migration = await migrationForFixture(database);
    await database.exec('ALTER TABLE public.classes ADD COLUMN unexpected_column text');
    await assert.rejects(() => database.exec(migration), /exact hosted starter catalog signature changed/);
    await database.exec('ROLLBACK');
    const state = await database.query(`SELECT
      to_regnamespace('osaah_legacy_20261015') IS NULL AS no_archive,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='classes' AND column_name='unexpected_column') AS drift_preserved`);
    assert.deepEqual(state.rows[0], { no_archive: true, drift_preserved: true });
  } finally {
    await database.close();
  }
});
