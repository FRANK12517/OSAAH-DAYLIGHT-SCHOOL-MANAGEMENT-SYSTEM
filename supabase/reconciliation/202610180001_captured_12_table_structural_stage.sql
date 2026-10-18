-- Versioned additive structural preparation for the captured 12-table catalog.
-- This creates a private canonical schema; it does not rename, alter, archive, or copy public records.
-- It retains the canonical single-school identity sch_default_01 without inserting a school row.
-- Generated from the canonical baseline and captured catalog evidence; review the source before regeneration.
BEGIN;

-- Fail closed unless the source matches the captured public catalog exactly.
DO $$
DECLARE actual_tables text[];
BEGIN
  IF to_regnamespace('osaah_recovery_20261018') IS NOT NULL THEN
    RAISE EXCEPTION 'Structural migration target schema already exists; inspect its schema_migrations ledger';
  END IF;
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Captured source precondition changed: public.schema_migrations exists';
  END IF;
  SELECT array_agg(tablename ORDER BY tablename) INTO actual_tables
    FROM pg_tables WHERE schemaname='public';
  IF actual_tables IS DISTINCT FROM ARRAY[
    'assessments',
    'attendance',
    'auth_sessions',
    'classes',
    'fee_payments',
    'permissions',
    'role_permissions',
    'roles',
    'students',
    'subjects',
    'user_roles',
    'users'
  ]::text[] THEN
    RAISE EXCEPTION 'Captured source table set does not match the approved 12-table profile';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public') THEN
    RAISE EXCEPTION 'Captured source unexpectedly contains public views';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='public' AND c.contype='p') <> 12
     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
         WHERE n.nspname='public' AND c.contype='u') <> 11
     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
         WHERE n.nspname='public' AND c.contype='f') <> 15
     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
         WHERE n.nspname='public' AND c.contype='c') <> 8 THEN
    RAISE EXCEPTION 'Captured source constraint counts changed; review before structural preparation';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity) <> 12 THEN
    RAISE EXCEPTION 'Captured source RLS state changed';
  END IF;
END $$;

CREATE TEMP TABLE osaah_captured_expected_columns (
  table_name text, column_name text, udt_name text, numeric_precision integer, numeric_scale integer,
  is_not_null boolean, is_identity boolean, generation_expression text, PRIMARY KEY (table_name, column_name)
) ON COMMIT DROP;
INSERT INTO pg_temp.osaah_captured_expected_columns VALUES
    ('assessments', 'id', 'int8', 64, 0, true, true, null),
    ('assessments', 'student_id', 'int4', 32, 0, false, false, null),
    ('assessments', 'subject_id', 'int4', 32, 0, false, false, null),
    ('assessments', 'academic_term', 'text', null, null, true, false, null),
    ('assessments', 'academic_year', 'text', null, null, true, false, null),
    ('assessments', 'class_score', 'numeric', 5, 2, false, false, null),
    ('assessments', 'exam_score', 'numeric', 5, 2, false, false, null),
    ('assessments', 'total_score', 'numeric', 5, 2, false, false, 'class_score + exam_score'),
    ('assessments', 'remarks', 'text', null, null, false, false, null),
    ('assessments', 'created_at', 'timestamptz', null, null, false, false, null),
    ('assessments', 'updated_at', 'timestamptz', null, null, false, false, null),
    ('attendance', 'id', 'int8', 64, 0, true, true, null),
    ('attendance', 'student_id', 'int4', 32, 0, false, false, null),
    ('attendance', 'class_id', 'int4', 32, 0, false, false, null),
    ('attendance', 'attendance_date', 'date', null, null, true, false, null),
    ('attendance', 'status', 'text', null, null, true, false, null),
    ('attendance', 'recorded_by', 'uuid', null, null, false, false, null),
    ('attendance', 'created_at', 'timestamptz', null, null, false, false, null),
    ('auth_sessions', 'id', 'uuid', null, null, true, false, null),
    ('auth_sessions', 'user_id', 'uuid', null, null, true, false, null),
    ('auth_sessions', 'token_hash', 'text', null, null, true, false, null),
    ('auth_sessions', 'expires_at', 'timestamptz', null, null, true, false, null),
    ('auth_sessions', 'created_at', 'timestamptz', null, null, true, false, null),
    ('classes', 'id', 'int4', 32, 0, true, true, null),
    ('classes', 'class_name', 'text', null, null, true, false, null),
    ('classes', 'section', 'text', null, null, false, false, null),
    ('classes', 'capacity', 'int4', 32, 0, false, false, null),
    ('classes', 'created_at', 'timestamptz', null, null, false, false, null),
    ('fee_payments', 'id', 'int4', 32, 0, true, true, null),
    ('fee_payments', 'student_id', 'int4', 32, 0, false, false, null),
    ('fee_payments', 'amount_paid', 'numeric', 10, 2, true, false, null),
    ('fee_payments', 'payment_method', 'text', null, null, false, false, null),
    ('fee_payments', 'reference_number', 'text', null, null, false, false, null),
    ('fee_payments', 'academic_term', 'text', null, null, true, false, null),
    ('fee_payments', 'academic_year', 'text', null, null, true, false, null),
    ('fee_payments', 'recorded_by', 'uuid', null, null, false, false, null),
    ('fee_payments', 'created_at', 'timestamptz', null, null, false, false, null),
    ('permissions', 'id', 'uuid', null, null, true, false, null),
    ('permissions', 'name', 'text', null, null, true, false, null),
    ('permissions', 'description', 'text', null, null, false, false, null),
    ('permissions', 'created_at', 'timestamptz', null, null, true, false, null),
    ('role_permissions', 'id', 'uuid', null, null, true, false, null),
    ('role_permissions', 'role_id', 'uuid', null, null, true, false, null),
    ('role_permissions', 'permission_id', 'uuid', null, null, true, false, null),
    ('role_permissions', 'created_at', 'timestamptz', null, null, true, false, null),
    ('roles', 'id', 'uuid', null, null, true, false, null),
    ('roles', 'name', 'text', null, null, true, false, null),
    ('roles', 'description', 'text', null, null, false, false, null),
    ('roles', 'created_at', 'timestamptz', null, null, true, false, null),
    ('students', 'id', 'int4', 32, 0, true, true, null),
    ('students', 'student_id', 'text', null, null, true, false, null),
    ('students', 'first_name', 'text', null, null, true, false, null),
    ('students', 'last_name', 'text', null, null, true, false, null),
    ('students', 'gender', 'text', null, null, false, false, null),
    ('students', 'date_of_birth', 'date', null, null, false, false, null),
    ('students', 'class_id', 'int4', 32, 0, false, false, null),
    ('students', 'parent_id', 'uuid', null, null, false, false, null),
    ('students', 'enrollment_status', 'text', null, null, false, false, null),
    ('students', 'created_at', 'timestamptz', null, null, false, false, null),
    ('students', 'updated_at', 'timestamptz', null, null, false, false, null),
    ('subjects', 'id', 'int4', 32, 0, true, true, null),
    ('subjects', 'subject_code', 'text', null, null, true, false, null),
    ('subjects', 'subject_name', 'text', null, null, true, false, null),
    ('subjects', 'class_id', 'int4', 32, 0, false, false, null),
    ('subjects', 'created_at', 'timestamptz', null, null, false, false, null),
    ('user_roles', 'id', 'uuid', null, null, true, false, null),
    ('user_roles', 'user_id', 'uuid', null, null, true, false, null),
    ('user_roles', 'role_id', 'uuid', null, null, true, false, null),
    ('user_roles', 'created_at', 'timestamptz', null, null, true, false, null),
    ('users', 'id', 'uuid', null, null, true, false, null),
    ('users', 'email', 'text', null, null, true, false, null),
    ('users', 'full_name', 'text', null, null, true, false, null),
    ('users', 'role', 'text', null, null, true, false, null),
    ('users', 'phone_number', 'text', null, null, false, false, null),
    ('users', 'is_active', 'bool', null, null, false, false, null),
    ('users', 'created_at', 'timestamptz', null, null, false, false, null),
    ('users', 'updated_at', 'timestamptz', null, null, false, false, null);
DO $$
BEGIN
  IF EXISTS (
    (SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,
            is_not_null, is_identity, generation_expression
       FROM pg_temp.osaah_captured_expected_columns
     EXCEPT
     SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,
            is_nullable='NO', is_identity='YES', CASE WHEN generation_expression = '(class_score + exam_score)' THEN 'class_score + exam_score' ELSE generation_expression END
       FROM information_schema.columns WHERE table_schema='public')
    UNION ALL
    (SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,
            is_nullable='NO', is_identity='YES', CASE WHEN generation_expression = '(class_score + exam_score)' THEN 'class_score + exam_score' ELSE generation_expression END
       FROM information_schema.columns WHERE table_schema='public'
     EXCEPT
     SELECT table_name, column_name, udt_name, numeric_precision, numeric_scale,
            is_not_null, is_identity, generation_expression
       FROM pg_temp.osaah_captured_expected_columns)
  ) THEN
    RAISE EXCEPTION 'Captured source columns, types, nullability, identity attributes, or generated expressions changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users GROUP BY email HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM public.roles GROUP BY name HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM public.user_roles GROUP BY user_id, role_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate source account, role, or assignment keys require owner review';
  END IF;
END $$;

CREATE TEMP TABLE osaah_captured_source_counts (table_name text PRIMARY KEY, row_count bigint) ON COMMIT DROP;
DO $$
DECLARE table_name text; row_total bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['assessments', 'attendance', 'auth_sessions', 'classes', 'fee_payments', 'permissions', 'role_permissions', 'roles', 'students', 'subjects', 'user_roles', 'users'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_total;
    INSERT INTO pg_temp.osaah_captured_source_counts VALUES (table_name, row_total);
  END LOOP;
END $$;

CREATE SCHEMA osaah_recovery_20261018;

-- Initial PostgreSQL baseline for the OSAAH Daylight School Management System.
-- Derived from schema/001-081 and current runtime repositories. No sample or
-- production records are inserted. Apply to a new, empty Supabase project.
-- Server-managed authentication remains authoritative; browser roles have no
-- direct access to application tables. Keep the Supabase service role server-only.

begin;

create schema if not exists extensions;

create table if not exists osaah_recovery_20261018.schools (
  id varchar(64) primary key,
  name text not null,
  motto text not null default '',
  address text,
  telephone text,
  email text,
  website text,
  logo_path text,
  primary_colour text not null default '#000000',
  secondary_colour text not null default '#ffffff',
  accent_colour text not null default '#000000',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists osaah_recovery_20261018.academic_years (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id),
  name varchar(128) not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, name), check (ends_on >= starts_on)
);
create table if not exists osaah_recovery_20261018.terms (
  id varchar(191) primary key, academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id),
  name varchar(64) not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (academic_year_id, name), check (ends_on >= starts_on)
);
create table if not exists osaah_recovery_20261018.levels (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null,
  display_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (school_id,name)
);
create table if not exists osaah_recovery_20261018.classes (
  id varchar(191) primary key, level_id varchar(191) references osaah_recovery_20261018.levels(id), school_id varchar(64) references osaah_recovery_20261018.schools(id),
  name varchar(128) not null, level varchar(100), display_order integer not null default 0, sort_order integer not null default 0,
  status varchar(16) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.streams (
  id varchar(191) primary key, class_id varchar(191) not null references osaah_recovery_20261018.classes(id), name varchar(128) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(class_id,name)
);
create table if not exists osaah_recovery_20261018.departments (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists osaah_recovery_20261018.subjects (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), department_id varchar(191) references osaah_recovery_20261018.departments(id),
  code varchar(64) not null, name varchar(128) not null, subject_type varchar(32), is_scoring boolean not null default true,
  is_active boolean not null default true, classification varchar(32), assessment_components_json jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,code)
);
create table if not exists osaah_recovery_20261018.houses (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null, colour varchar(32),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists osaah_recovery_20261018.users (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), username varchar(191), email varchar(255),
  password_hash text, full_name varchar(255), phone varchar(50), role varchar(64),
  status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,username)
);
create table if not exists osaah_recovery_20261018.portal_users (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), portal_name varchar(255), email varchar(255) not null unique,
 phone varchar(32), full_name varchar(255), password_hash text, role varchar(64) not null, is_active boolean not null default true,
 status varchar(32) not null default 'ACTIVE', linked_user_id varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.students (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), user_id varchar(191) unique references osaah_recovery_20261018.users(id),
  admission_number varchar(128) not null, first_name varchar(128) not null, middle_name varchar(128), last_name varchar(128) not null,
  full_name varchar(255), permanent_student_id varchar(100), gender varchar(32) not null default 'NOT_SPECIFIED', date_of_birth date,
  parent_guardian_name varchar(255), parent_phone varchar(50), admission_date date, admission_type varchar(64), student_status varchar(32) not null default 'ACTIVE',
 status varchar(32) generated always as (student_status) stored,
 health_insurance_number varchar(64), current_class_id varchar(191) references osaah_recovery_20261018.classes(id), class_id varchar(191) generated always as (current_class_id) stored, is_test_record boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,admission_number), unique(school_id,permanent_student_id)
);
create table if not exists osaah_recovery_20261018.staff (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), user_id varchar(191) unique references osaah_recovery_20261018.users(id),
  staff_number varchar(128) not null, first_name varchar(128) not null, last_name varchar(128) not null, department_id varchar(191) references osaah_recovery_20261018.departments(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,staff_number)
);
create table if not exists osaah_recovery_20261018.staff_profiles (
  id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), staff_id varchar(191) not null unique references osaah_recovery_20261018.staff(id),
  employee_id varchar(128) not null unique, full_name varchar(255) not null, photograph_path text, gender varchar(32), date_of_birth date, phone varchar(50), address text,
  emergency_contact_json jsonb, department_id varchar(191) references osaah_recovery_20261018.departments(id), role_key varchar(64), employment_type varchar(64), appointment_date date,
  contract_json jsonb, qualification text, institution text, certificates_json jsonb, ntc_json jsonb, professional_development_json jsonb,
  appraisal_json jsonb, promotion_json jsonb, documents_json jsonb, confidential_json jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.roles (
  id varchar(191) primary key, school_id varchar(64) references osaah_recovery_20261018.schools(id), role_key varchar(64) not null, role_name varchar(128) not null,
  oversight_rank integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,role_key)
);
create table if not exists osaah_recovery_20261018.permissions (
  id varchar(191) primary key, permission_key varchar(128) not null unique, permission_name varchar(255) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.user_roles (
  id varchar(191) unique, user_id varchar(191) not null references osaah_recovery_20261018.users(id), role_id varchar(191) not null references osaah_recovery_20261018.roles(id),
  created_at timestamptz not null default now(), primary key(user_id,role_id)
);
create table if not exists osaah_recovery_20261018.role_permissions (
  id varchar(191) unique, role_id varchar(191) not null references osaah_recovery_20261018.roles(id), permission_id varchar(191) not null references osaah_recovery_20261018.permissions(id),
  created_at timestamptz not null default now(), primary key(role_id,permission_id)
);
create table if not exists osaah_recovery_20261018.student_profiles (
 id varchar(191) primary key, student_master_id varchar(191) references osaah_recovery_20261018.students(id), student_id varchar(128) unique, permanent_student_id varchar(32) unique,
 school_id varchar(64) not null references osaah_recovery_20261018.schools(id), admission_number varchar(128) not null, index_number varchar(128),
  first_name varchar(128) not null, middle_name varchar(128), surname varchar(128) not null, last_name varchar(128) generated always as (surname) stored,
  preferred_name varchar(128), gender varchar(32), date_of_birth date,
  place_of_birth text, nationality varchar(100), photograph_path text, qr_code varchar(255) not null unique, class_id varchar(191) references osaah_recovery_20261018.classes(id),
  stream_id varchar(191) references osaah_recovery_20261018.streams(id), house_id varchar(191) references osaah_recovery_20261018.houses(id), admission_date date, previous_school text,
 admission_type varchar(64), enrollment_status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,admission_number)
);
create table if not exists osaah_recovery_20261018.student_family_contacts (
 id varchar(191) primary key, student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), contact_type varchar(64) not null, full_name varchar(255) not null,
 relationship varchar(100), telephone varchar(50), alternative_phone varchar(50), address text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_health_records (
 student_id varchar(191) primary key references osaah_recovery_20261018.student_profiles(id), allergies text, conditions text, medications text, blood_group varchar(16),
 emergency_notes text, restricted_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_documents (
 id varchar(191) primary key, student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), document_type varchar(64) not null,
 storage_key text not null, uploaded_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_class_history (
 id varchar(191) primary key, student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), class_id varchar(191) references osaah_recovery_20261018.classes(id),
 stream_id varchar(191) references osaah_recovery_20261018.streams(id), academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), reason text not null, effective_at timestamptz not null
);
create table if not exists osaah_recovery_20261018.parent_student_links (
 parent_user_id varchar(191) not null references osaah_recovery_20261018.users(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), permanent_student_id varchar(128),
 relationship varchar(100), relationship_type varchar(64), telephone varchar(50), link_status varchar(32) not null default 'ACTIVE',
 created_at timestamptz not null default now(), updated_at timestamptz, primary key(parent_user_id,student_id)
);
create table if not exists osaah_recovery_20261018.admission_applications (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), application_number varchar(128) not null unique,
 stage varchar(64) not null, applicant_data jsonb not null, admission_letter_key text, enrollment_confirmation_key text,
 student_id varchar(191) references osaah_recovery_20261018.students(id), enquiry_request_id varchar(64), permanent_student_id varchar(128),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_admission_applications_enquiry_request on osaah_recovery_20261018.admission_applications(school_id,enquiry_request_id) where enquiry_request_id is not null;
create unique index if not exists uq_admission_application_student_id on osaah_recovery_20261018.admission_applications(student_id) where student_id is not null;
create unique index if not exists uq_admission_application_permanent_student_id on osaah_recovery_20261018.admission_applications(school_id,permanent_student_id) where permanent_student_id is not null;
create table if not exists osaah_recovery_20261018.admission_form_applications (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), temporary_application_id varchar(128) not null unique,
 application_number varchar(128) not null unique, academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), term_id varchar(191) references osaah_recovery_20261018.terms(id),
 application_date date not null, status varchar(32) not null check(status in ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED','REJECTED')),
 parent_user_id varchar(191) references osaah_recovery_20261018.users(id), section1_candidate jsonb not null, section2_history jsonb not null, section3_guardians jsonb not null,
 parent_declaration_accepted boolean not null default false, parent_signature_reference text, parent_declaration_date date,
 entrance_assessment_score numeric(5,2) check(entrance_assessment_score between 0 and 100), permanent_student_id varchar(128) unique,
 official_use jsonb not null default '{}', fee_snapshot jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.admission_documents (
 id varchar(191) primary key, application_id varchar(191) not null references osaah_recovery_20261018.admission_form_applications(id), school_id varchar(64) not null references osaah_recovery_20261018.schools(id),
 document_type varchar(64) not null, file_reference text not null, uploaded_at timestamptz not null default now(), verified boolean not null default false,
 verified_by varchar(191) references osaah_recovery_20261018.users(id), verified_at timestamptz
);
create table if not exists osaah_recovery_20261018.admission_fee_structures (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), level varchar(32) not null check(level in ('CRECHE_NURSERY','KINDERGARTEN','PRIMARY','JHS')),
 academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) not null references osaah_recovery_20261018.terms(id),
 tuition_academic_fee numeric(12,2) not null check(tuition_academic_fee>=0), ict_lab_library_fee numeric(12,2) not null check(ict_lab_library_fee>=0),
 pta_utility_charges numeric(12,2) not null check(pta_utility_charges>=0), total_termly_fee numeric(12,2) generated always as (tuition_academic_fee+ict_lab_library_fee+pta_utility_charges) stored,
 admission_registration_fee numeric(12,2) not null default 0 check(admission_registration_fee>=0), school_uniform_fee numeric(12,2) not null default 0 check(school_uniform_fee>=0),
 pe_kit_sportswear_fee numeric(12,2) not null default 0 check(pe_kit_sportswear_fee>=0), version integer not null default 1, is_published boolean not null default false,
 published_at timestamptz, published_by varchar(191) references osaah_recovery_20261018.users(id), publisher_role varchar(64), updated_by varchar(191) references osaah_recovery_20261018.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,level,academic_year_id,term_id,version)
);
create unique index if not exists uq_admission_fee_active on osaah_recovery_20261018.admission_fee_structures(school_id,level,academic_year_id,term_id) where is_published;
create table if not exists osaah_recovery_20261018.admission_prospectuses (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), class_id varchar(191) not null references osaah_recovery_20261018.classes(id),
 academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), content text, document_url text, document_name text, document_type varchar(64),
 document_size integer not null default 0, status varchar(32) not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','UNPUBLISHED')),
 is_published boolean not null default false, published_at timestamptz, published_by varchar(191) references osaah_recovery_20261018.users(id), created_by varchar(191) not null references osaah_recovery_20261018.users(id),
 created_at timestamptz not null default now(), updated_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now(),
 unique(school_id,class_id,academic_year_id)
);
create table if not exists osaah_recovery_20261018.student_id_sequences (
 admission_year smallint primary key, next_sequence integer not null check(next_sequence>=1), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_enrollments (
 id varchar(191) primary key, school_id varchar(64) references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id),
 permanent_student_id varchar(100), academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), academic_year varchar(20),
 class_id varchar(191) references osaah_recovery_20261018.classes(id), class_name varchar(100), term_id varchar(191) references osaah_recovery_20261018.terms(id),
 enrollment_status varchar(32) not null default 'ACTIVE', is_current boolean not null default true, enrolled_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_student_enrollment_context on osaah_recovery_20261018.student_enrollments(school_id,student_id,academic_year_id,term_id,is_current);

create table if not exists osaah_recovery_20261018.subject_class_assignments (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id),
 class_id varchar(191) not null references osaah_recovery_20261018.classes(id), academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), active boolean not null default true,
 configuration_version varchar(32), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_subject_class_assignments_scope on osaah_recovery_20261018.subject_class_assignments(school_id,subject_id,class_id,(case when academic_year_id is null then 'N' else 'V' || academic_year_id end));
create table if not exists osaah_recovery_20261018.academic_score_records (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), record_type varchar(16) not null check(record_type in ('TERMINAL','MOCK')),
 mock_label varchar(64), academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) not null references osaah_recovery_20261018.terms(id),
 class_id varchar(191) not null references osaah_recovery_20261018.classes(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id),
 ca_score numeric(6,2) not null default 0, ca_max numeric(6,2) not null default 50, examination_score numeric(6,2) not null default 0,
 examination_max numeric(6,2) not null default 50, total_score numeric(6,2) not null, grade varchar(32), remark text, entered_by varchar(191) not null references osaah_recovery_20261018.users(id),
 updated_at timestamptz not null default now()
);
create unique index if not exists uq_academic_score_record_scope on osaah_recovery_20261018.academic_score_records
 (school_id,record_type,(case when mock_label is null then 'N' else 'V' || mock_label end),academic_year_id,term_id,class_id,student_id,subject_id);
create table if not exists osaah_recovery_20261018.academic_result_records (
 id varchar(191) primary key, school_id varchar(191) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id),
 class_id varchar(191) not null references osaah_recovery_20261018.classes(id), academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) not null references osaah_recovery_20261018.terms(id),
 examination varchar(16) not null default 'TERMINAL', mock_label varchar(64), attendance_json jsonb, assessment_json jsonb, status varchar(16) not null default 'SAVED',
 version integer not null default 1, saved_by varchar(191) not null references osaah_recovery_20261018.users(id), saved_at timestamptz not null default now(),
 published_by varchar(191) references osaah_recovery_20261018.users(id), published_at timestamptz, updated_at timestamptz not null default now()
);
create unique index if not exists uq_academic_result_record_scope on osaah_recovery_20261018.academic_result_records
 (school_id,student_id,class_id,academic_year_id,term_id,examination,(case when mock_label is null then 'N' else 'V' || mock_label end));
create table if not exists osaah_recovery_20261018.academic_result_blocks (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 class_id varchar(191) not null references osaah_recovery_20261018.classes(id), student_id varchar(191), scope varchar(32) not null, status varchar(32) not null,
 reason text not null, blocked_by varchar(191) not null references osaah_recovery_20261018.users(id), blocked_by_role varchar(64) not null, blocked_at timestamptz not null,
 result_type varchar(16), mock_examination varchar(64), unblocked_by varchar(191) references osaah_recovery_20261018.users(id), unblocked_at timestamptz
);
create unique index if not exists uq_academic_result_block_examination_scope on osaah_recovery_20261018.academic_result_blocks
 (school_id,academic_year,term,class_id,result_type,(case when mock_examination is null then 'N' else 'V' || mock_examination end),student_id);
create index if not exists idx_academic_result_block_examination_lookup on osaah_recovery_20261018.academic_result_blocks
 (school_id,academic_year,term,class_id,result_type,mock_examination,status);
create table if not exists osaah_recovery_20261018.academic_result_unblock_requests (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), block_id varchar(64) not null references osaah_recovery_20261018.academic_result_blocks(id),
 academic_year varchar(128) not null, term varchar(128) not null, class_id varchar(128) not null references osaah_recovery_20261018.classes(id), student_id varchar(64) not null default '*',
 scope varchar(16) not null check(scope in ('STUDENT','CLASS')), reason varchar(500) not null, requested_by varchar(64) not null references osaah_recovery_20261018.users(id),
 requested_by_role varchar(64) not null, status varchar(16) not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 requested_at timestamptz not null, decided_by varchar(64) references osaah_recovery_20261018.users(id), decided_at timestamptz
);
create table if not exists osaah_recovery_20261018.canonical_ges_assessments (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id),
 class_id varchar(191) not null references osaah_recovery_20261018.classes(id), academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) not null references osaah_recovery_20261018.terms(id),
 conduct varchar(500), attitude varchar(500), interest varchar(500), class_teacher_remarks varchar(1000), headteacher_remarks varchar(1000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,student_id,class_id,academic_year_id,term_id)
);
create table if not exists osaah_recovery_20261018.student_attendance (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), attendance_date date not null, date date, class_id varchar(191) references osaah_recovery_20261018.classes(id),
 student_id varchar(191) not null references osaah_recovery_20261018.students(id), subject_id varchar(191) references osaah_recovery_20261018.subjects(id), subject_key varchar(128) not null default 'LEGACY_UNSPECIFIED',
 academic_year varchar(64) not null default 'LEGACY_UNSPECIFIED', term varchar(32) not null default 'LEGACY_UNSPECIFIED', status varchar(32) not null,
 method varchar(32), arrival_time timestamptz, departure_time timestamptz, reason text, remarks text, version integer not null default 1,
 entered_by varchar(191) references osaah_recovery_20261018.users(id), entered_at timestamptz, recorded_by varchar(191) references osaah_recovery_20261018.users(id), recorded_at timestamptz,
 updated_by varchar(191) references osaah_recovery_20261018.users(id), updated_at timestamptz, source varchar(32) not null default 'LEGACY_UNSPECIFIED', created_at timestamptz not null default now()
);
create unique index if not exists uq_student_attendance_scope_identity on osaah_recovery_20261018.student_attendance(school_id,academic_year,term,attendance_date,class_id,student_id,subject_key);
create table if not exists osaah_recovery_20261018.staff_attendance (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), staff_id varchar(191) not null references osaah_recovery_20261018.staff(id),
 attendance_date date not null, attendance_type varchar(32) not null, attendance_time timestamptz, academic_year varchar(64) not null default 'LEGACY_UNSPECIFIED',
 term varchar(32) not null default 'LEGACY_UNSPECIFIED', attendance_status varchar(32) not null default 'LEGACY_UNSPECIFIED',
 attendance_source varchar(32) not null default 'LEGACY_UNSPECIFIED', leave_request_id varchar(191), note text, previous_status varchar(32),
 entered_by varchar(191) references osaah_recovery_20261018.users(id), recorded_by varchar(191) references osaah_recovery_20261018.users(id), recorded_at timestamptz,
 updated_by varchar(191) references osaah_recovery_20261018.users(id), updated_at timestamptz, source varchar(32), created_at timestamptz not null default now()
);
create unique index if not exists uq_staff_attendance_scope_identity on osaah_recovery_20261018.staff_attendance(school_id,academic_year,term,attendance_date,staff_id,attendance_type);
create table if not exists osaah_recovery_20261018.staff_leave (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), staff_id varchar(191) not null references osaah_recovery_20261018.staff_profiles(id),
 leave_type varchar(64) not null, starts_on date not null, ends_on date not null, reason text, state varchar(32) not null default 'PENDING',
 applied_at timestamptz not null default now(), decided_at timestamptz, decided_by varchar(191) references osaah_recovery_20261018.users(id), academic_year varchar(64), term varchar(32),
 cancellation_reason text, updated_at timestamptz, check(ends_on>=starts_on)
);
create table if not exists osaah_recovery_20261018.staff_leave_balances (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), staff_id varchar(191) not null references osaah_recovery_20261018.staff_profiles(id), leave_type varchar(64) not null, entitled_days numeric(8,2) not null, used_days numeric(8,2) not null default 0, year varchar(16) not null, unique(staff_id,leave_type,year)
);
create table if not exists osaah_recovery_20261018.staff_assignments (
 id varchar(191) primary key, staff_id varchar(191) not null references osaah_recovery_20261018.staff_profiles(id), subject_id varchar(191) references osaah_recovery_20261018.subjects(id), class_id varchar(191) references osaah_recovery_20261018.classes(id), stream_id varchar(191) references osaah_recovery_20261018.streams(id), department_id varchar(191) references osaah_recovery_20261018.departments(id), timetable_id varchar(191), academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), term_id varchar(191) references osaah_recovery_20261018.terms(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.staff_documents (
 id varchar(191) primary key, staff_id varchar(191) not null references osaah_recovery_20261018.staff_profiles(id), document_type varchar(64) not null, storage_key text not null, uploaded_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
alter table osaah_recovery_20261018.staff_attendance add constraint staff_attendance_leave_fk foreign key(leave_request_id) references osaah_recovery_20261018.staff_leave(id);
create table if not exists osaah_recovery_20261018.attendance_audit_history (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), attendance_record_id varchar(64) not null, person_id varchar(64) not null,
 person_type varchar(16) not null, previous_status varchar(32), new_status varchar(32) not null, previous_reason text, new_reason text,
 changed_by varchar(191) not null, changed_at timestamptz not null default now(), source varchar(32) not null, action varchar(16) not null
);
create table if not exists osaah_recovery_20261018.staff_attendance_reconciliation_audit (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), leave_request_id varchar(64) not null references osaah_recovery_20261018.staff_leave(id),
 staff_attendance_id varchar(64) references osaah_recovery_20261018.staff_attendance(id), attendance_date date not null, action text not null,
 previous_status varchar(32), next_status varchar(32), details text not null, actor_id varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.academic_calendar_events (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 title varchar(255) not null, category varchar(64) not null, custom_category varchar(128), description text, start_date date not null, end_date date,
 start_time time, end_time time, all_day boolean not null default true, venue text, audience_json jsonb not null, class_scope_json jsonb not null default '[]',
 status varchar(16) not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','CANCELLED')), created_by varchar(191) not null references osaah_recovery_20261018.users(id),
 updated_by varchar(191) not null references osaah_recovery_20261018.users(id), published_by varchar(191) references osaah_recovery_20261018.users(id), published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_date is null or end_date>=start_date)
);
create table if not exists osaah_recovery_20261018.academic_calendar_term_configs (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 reopening_date date, teaching_start_date date, mid_term_break_start date, mid_term_break_end date, examination_start_date date, examination_end_date date,
 closing_date date, teaching_days integer, created_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_by varchar(191) not null references osaah_recovery_20261018.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,academic_year,term)
);
create table if not exists osaah_recovery_20261018.examinations (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(255) not null, exam_type varchar(64) not null,
 academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), term_id varchar(191) references osaah_recovery_20261018.terms(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.examination_subjects (
 id varchar(191) primary key, examination_id varchar(191) not null references osaah_recovery_20261018.examinations(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id), max_marks numeric(8,2) not null default 100, weight numeric(8,2) not null default 100
);
create table if not exists osaah_recovery_20261018.examination_candidates (
 id varchar(191) primary key, examination_id varchar(191) not null references osaah_recovery_20261018.examinations(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), unique(examination_id,student_id)
);
create table if not exists osaah_recovery_20261018.examination_timetable (
 id varchar(191) primary key, examination_id varchar(191) not null references osaah_recovery_20261018.examinations(id), subject_id varchar(191) references osaah_recovery_20261018.subjects(id), room varchar(128), starts_at timestamptz not null, ends_at timestamptz not null, invigilator_id varchar(191) references osaah_recovery_20261018.staff(id)
);
create table if not exists osaah_recovery_20261018.grading_systems (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null, boundaries_json jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.examination_marks (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), examination_id varchar(191) not null references osaah_recovery_20261018.examinations(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id), raw_marks numeric(8,2) not null, weight numeric(8,2) not null, weighted_marks numeric(8,2) not null, grade varchar(32) not null, comment text, state varchar(32) not null default 'DRAFT', version integer not null default 1, entered_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now(), unique(examination_id,student_id,subject_id)
);
create table if not exists osaah_recovery_20261018.canonical_academic_scores (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), class_id varchar(191) not null references osaah_recovery_20261018.classes(id),
 academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) not null references osaah_recovery_20261018.terms(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id),
 class_score numeric(6,2) not null, exam_score numeric(6,2) not null, total_score numeric(6,2) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,student_id,class_id,academic_year_id,term_id,subject_id)
);
create table if not exists osaah_recovery_20261018.promotion_decisions (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), academic_year_id varchar(191) not null references osaah_recovery_20261018.academic_years(id), term_id varchar(191) references osaah_recovery_20261018.terms(id), class_id varchar(191) references osaah_recovery_20261018.classes(id), to_class_id varchar(191) references osaah_recovery_20261018.classes(id), next_academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), next_term_id varchar(191) references osaah_recovery_20261018.terms(id), source_enrollment_id varchar(191) references osaah_recovery_20261018.student_enrollments(id), idempotency_key varchar(64), completion_year varchar(64), decision varchar(32) not null, comment text, decided_by varchar(191) not null references osaah_recovery_20261018.users(id), decided_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists osaah_recovery_20261018.subject_registers (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), class_id varchar(191) not null references osaah_recovery_20261018.classes(id), subject_id varchar(191) not null references osaah_recovery_20261018.subjects(id), academic_year_id varchar(191) references osaah_recovery_20261018.academic_years(id), term_id varchar(191) references osaah_recovery_20261018.terms(id), status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.subject_register_teachers (
 id varchar(191) primary key, register_id varchar(191) not null references osaah_recovery_20261018.subject_registers(id), staff_id varchar(191) not null references osaah_recovery_20261018.staff(id), created_at timestamptz not null default now(), unique(register_id,staff_id)
);
create table if not exists osaah_recovery_20261018.subject_register_history (
 id varchar(191) primary key, register_id varchar(191) not null references osaah_recovery_20261018.subject_registers(id), action varchar(64) not null, actor_id varchar(191) references osaah_recovery_20261018.users(id), details jsonb, created_at timestamptz not null default now()
);

create table if not exists osaah_recovery_20261018.fee_types (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), code varchar(64) not null, name varchar(128) not null,
 category varchar(64) not null, description text, is_active boolean not null default true, is_system boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,code)
);
create table if not exists osaah_recovery_20261018.fee_structures (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), fee_type varchar(128), fee_type_id varchar(64) references osaah_recovery_20261018.fee_types(id),
 category_name varchar(128), custom_fee_type_name text, amount numeric(15,2) not null, academic_year_id varchar(191), academic_year varchar(64),
 term_id varchar(191), term varchar(64), class_id varchar(191) references osaah_recovery_20261018.classes(id), student_id varchar(191) references osaah_recovery_20261018.students(id),
 boarding_type varchar(64), optional_service varchar(128), status varchar(32) not null default 'DRAFT', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_fee_charges (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), account_id varchar(64) not null, permanent_student_id varchar(100) not null, fee_structure_id varchar(64) references osaah_recovery_20261018.fee_structures(id), fee_type varchar(100) not null, description varchar(255), amount numeric(15,2) not null default 0, due_date date, charge_status varchar(16) not null default 'ACTIVE', created_by varchar(64) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_fee_discounts (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), account_id varchar(64) not null, permanent_student_id varchar(100) not null, charge_id varchar(64) references osaah_recovery_20261018.student_fee_charges(id), discount_type varchar(100) not null, description varchar(255), amount numeric(15,2) not null default 0, approved_by varchar(64) references osaah_recovery_20261018.users(id), created_by varchar(64) references osaah_recovery_20261018.users(id), status varchar(16) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.fee_obligations (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), fee_structure_id varchar(64) not null references osaah_recovery_20261018.fee_structures(id),
 academic_year_id varchar(64), term_id varchar(64), applicability_type varchar(32) not null, class_id varchar(64), student_id varchar(64) not null references osaah_recovery_20261018.students(id),
 amount_minor bigint not null, due_date date, status varchar(32) not null, published_by varchar(64) not null references osaah_recovery_20261018.users(id), published_at timestamptz not null,
 idempotency_key varchar(255) not null, custom_fee_type_name varchar(128), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists osaah_recovery_20261018.fee_collection_records (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), collection_type varchar(32) not null, class_id varchar(64),
 collection_date date not null, expected_amount_minor bigint, amount_received_minor bigint not null, recorded_by varchar(64) not null references osaah_recovery_20261018.users(id), notes text,
 academic_year_id varchar(64), term_id varchar(64), collection_period varchar(32), fee_type_id varchar(64) references osaah_recovery_20261018.fee_types(id), custom_fee_type_name varchar(128),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.fee_collection_corrections (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), collection_id varchar(64) not null references osaah_recovery_20261018.fee_collection_records(id),
 actor_user_id varchar(64) not null references osaah_recovery_20261018.users(id), reason text not null, before_amount_received_minor bigint not null, after_amount_received_minor bigint not null,
 created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_fee_accounts (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(64) not null references osaah_recovery_20261018.students(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64), term_id varchar(64), class_id varchar(64) not null references osaah_recovery_20261018.classes(id),
 account_status varchar(32) not null default 'ACTIVE', created_by varchar(64) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(),
 updated_by varchar(64) references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now(), unique(school_id,permanent_student_id,academic_year_id,term_id)
);
create table if not exists osaah_recovery_20261018.student_fee_ledger (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64) not null, term_id varchar(64) not null, class_id varchar(64) not null,
 transaction_type varchar(32) not null, fee_type varchar(128), amount numeric(15,2) not null, reference_type varchar(64), reference_id varchar(128), description text,
 transaction_date date not null, source varchar(32) not null default 'LEGACY_UNSPECIFIED', recorded_by varchar(64) not null references osaah_recovery_20261018.users(id),
 recorded_at timestamptz not null default now(), reversed_by varchar(64) references osaah_recovery_20261018.users(id), reversed_at timestamptz, reversal_reason text, status varchar(32) not null default 'ACTIVE'
);
create table if not exists osaah_recovery_20261018.fee_invoices (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64), term_id varchar(64), class_id varchar(64), invoice_number varchar(128) not null,
 invoice_date date not null, due_date date, subtotal numeric(15,2) not null default 0, discount_amount numeric(15,2) not null default 0,
 total_amount numeric(15,2) not null default 0, status varchar(32) not null default 'DRAFT', issued_by varchar(64) references osaah_recovery_20261018.users(id), issued_at timestamptz,
 created_by varchar(64) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_by varchar(64) references osaah_recovery_20261018.users(id), updated_at timestamptz,
 unique(school_id,invoice_number)
);
create table if not exists osaah_recovery_20261018.fee_invoice_items (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), invoice_id varchar(64) not null references osaah_recovery_20261018.fee_invoices(id),
 fee_structure_id varchar(64) references osaah_recovery_20261018.fee_structures(id), fee_type varchar(128) not null, description text, amount numeric(15,2) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.student_fee_payments (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id),
 invoice_id varchar(64) references osaah_recovery_20261018.fee_invoices(id), permanent_student_id varchar(128) not null, academic_year_id varchar(64) not null,
 term_id varchar(64) not null, class_id varchar(64) not null, payment_reference varchar(128) not null, amount numeric(15,2) not null,
 payment_method varchar(32) not null, provider_reference varchar(255), payment_date timestamptz not null, status varchar(32) not null default 'COMPLETED',
 received_by varchar(64) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), reversed_by varchar(64) references osaah_recovery_20261018.users(id), reversed_at timestamptz, reversal_reason text,
 unique(school_id,payment_reference)
);
create table if not exists osaah_recovery_20261018.student_fee_receipts (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), payment_id varchar(64) not null unique references osaah_recovery_20261018.student_fee_payments(id),
 account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id), permanent_student_id varchar(128) not null, receipt_number varchar(128) not null,
 amount_paid numeric(15,2) not null, previous_balance numeric(15,2) not null, new_balance numeric(15,2) not null, issued_by varchar(64) not null references osaah_recovery_20261018.users(id),
 issued_at timestamptz not null, status varchar(32) not null default 'VALID', voided_by varchar(64) references osaah_recovery_20261018.users(id), voided_at timestamptz, void_reason text,
 unique(school_id,receipt_number)
);
create table if not exists osaah_recovery_20261018.financial_audit_history (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), entity_type varchar(64) not null, entity_id varchar(64) not null,
 permanent_student_id varchar(128), action varchar(32) not null, previous_values jsonb, new_values jsonb, reason text, changed_by varchar(64) not null references osaah_recovery_20261018.users(id),
 changed_at timestamptz not null default now(), source varchar(32) not null default 'LEGACY_UNSPECIFIED', transaction_reference varchar(128)
);
create table if not exists osaah_recovery_20261018.financial_audit_log (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), user_id varchar(64) references osaah_recovery_20261018.users(id), action varchar(100) not null,
 entity_type varchar(100) not null, entity_id varchar(64), permanent_student_id varchar(100), description text, old_values jsonb, new_values jsonb, ip_address inet, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.budgets (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), academic_year varchar(64) not null, term varchar(64) not null,
 budget_name varchar(255) not null, description text, status varchar(16) not null default 'DRAFT', total_budget_amount numeric(15,2) not null default 0,
 created_by varchar(64) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_by varchar(64) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.budget_items (
 id varchar(64) primary key, budget_id varchar(64) not null references osaah_recovery_20261018.budgets(id), school_id varchar(64) not null references osaah_recovery_20261018.schools(id),
 category varchar(128) not null, custom_category varchar(255), description text, allocated_amount numeric(15,2) not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.general_income (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), transaction_date date not null, academic_year varchar(64) not null,
 term varchar(64) not null, income_category varchar(96) not null, custom_category varchar(160), description varchar(500) not null, reference_number varchar(160) not null,
 amount numeric(12,2) not null check(amount>0), payment_method varchar(32) not null, payer_or_source varchar(240) not null, notes text,
 status varchar(16) not null default 'POSTED' check(status in ('POSTED','VOIDED')), created_by varchar(191) not null references osaah_recovery_20261018.users(id),
 created_at timestamptz not null default now(), updated_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now(),
 voided_by varchar(191) references osaah_recovery_20261018.users(id), voided_at timestamptz, void_reason text, unique(school_id,reference_number,status)
);
create table if not exists osaah_recovery_20261018.general_expenses (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), transaction_date date not null, academic_year varchar(64) not null,
 term varchar(64) not null, expense_category varchar(96) not null, custom_category varchar(160), description varchar(500) not null, reference_number varchar(160) not null,
 amount numeric(12,2) not null check(amount>0), payment_method varchar(32) not null, payee varchar(240) not null, notes text,
 status varchar(16) not null default 'POSTED' check(status in ('POSTED','VOIDED')), budget_id varchar(64) references osaah_recovery_20261018.budgets(id), budget_item_id varchar(64) references osaah_recovery_20261018.budget_items(id),
 created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now(),
 voided_by varchar(191) references osaah_recovery_20261018.users(id), voided_at timestamptz, void_reason text, unique(school_id,reference_number,status)
);
create table if not exists osaah_recovery_20261018.auth_sessions (
 id varchar(191) primary key, user_id varchar(191) not null references osaah_recovery_20261018.users(id), school_id varchar(64) not null references osaah_recovery_20261018.schools(id),
 token_hash char(64) not null unique, created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz
);
create table if not exists osaah_recovery_20261018.announcement_records (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), title text not null, message text not null,
 priority varchar(32) not null default 'NORMAL', recipient_category varchar(32) not null, status varchar(32) not null default 'DRAFT',
 scheduled_for timestamptz, published_at timestamptz, sender_id varchar(64) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.communication_providers (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), provider_key varchar(128) not null,
 is_active boolean not null default false, is_default boolean not null default false, endpoint text, credentials_secret_ref text, sender_id varchar(128),
 priority integer not null default 100, fallback_provider_id varchar(191) references osaah_recovery_20261018.communication_providers(id), webhook_url text,
 created_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null, updated_at timestamptz not null, unique(school_id,provider_key)
);
create table if not exists osaah_recovery_20261018.communication_templates (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), template_key varchar(128) not null,
 channel varchar(32) not null, body_template text not null, active boolean not null default true,
 created_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null, updated_at timestamptz not null, unique(school_id,template_key)
);
create table if not exists osaah_recovery_20261018.communication_trigger_settings (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), trigger_key varchar(128) not null,
 channel varchar(32) not null, enabled boolean not null default false, template_id varchar(191) references osaah_recovery_20261018.communication_templates(id),
 provider_id varchar(191) references osaah_recovery_20261018.communication_providers(id), updated_by varchar(191) references osaah_recovery_20261018.users(id), updated_at timestamptz not null,
 unique(school_id,trigger_key,channel)
);
create table if not exists osaah_recovery_20261018.communication_outbox (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), channel varchar(32) not null,
 recipient text not null, payload_json text not null, idempotency_key varchar(191) not null, status varchar(32) not null,
 attempts integer not null default 0, next_attempt_at timestamptz, provider_id varchar(191), provider_message_id varchar(191),
 last_error text, created_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null, updated_at timestamptz not null,
 unique(school_id,idempotency_key)
);
create table if not exists osaah_recovery_20261018.communication_messages (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), outbox_id varchar(191) not null references osaah_recovery_20261018.communication_outbox(id),
 channel varchar(32) not null, provider_id varchar(191), provider_message_id varchar(191), status varchar(32) not null,
 sent_at timestamptz, delivered_at timestamptz, created_at timestamptz not null
);
create table if not exists osaah_recovery_20261018.communication_delivery_logs (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), message_id varchar(191) not null references osaah_recovery_20261018.communication_messages(id),
 provider_id varchar(191), status varchar(32) not null, response_code varchar(64), safe_error text, occurred_at timestamptz not null
);
create table if not exists osaah_recovery_20261018.announcement_recipients (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), announcement_id varchar(64) not null references osaah_recovery_20261018.announcement_records(id),
 recipient_id varchar(64) not null references osaah_recovery_20261018.users(id), recipient_type varchar(32) not null, assigned_at timestamptz not null default now(), unique(school_id,announcement_id,recipient_id)
);
create table if not exists osaah_recovery_20261018.announcement_reads (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), announcement_id varchar(64) not null references osaah_recovery_20261018.announcement_records(id),
 recipient_id varchar(64) not null references osaah_recovery_20261018.users(id), read_at timestamptz not null, unique(school_id,announcement_id,recipient_id)
);
create table if not exists osaah_recovery_20261018.sms_campaigns (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), message_body text not null, recipient_mode varchar(32) not null,
 selector_json jsonb not null, status varchar(32) not null, recipient_count integer not null default 0, created_by varchar(64) not null references osaah_recovery_20261018.users(id),
 idempotency_key varchar(128), provider_key varchar(32), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
 unique(school_id,idempotency_key)
);
create table if not exists osaah_recovery_20261018.sms_campaign_recipients (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), campaign_id varchar(64) not null references osaah_recovery_20261018.sms_campaigns(id),
 parent_user_id varchar(64) not null references osaah_recovery_20261018.users(id), student_id varchar(64) references osaah_recovery_20261018.students(id), normalized_phone varchar(20) not null,
 recipient_name varchar(255) not null, status varchar(32) not null, provider_message_id varchar(128), last_error varchar(255),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), delivered_at timestamptz,
 unique(school_id,campaign_id,normalized_phone)
);
create table if not exists osaah_recovery_20261018.announcements (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), title varchar(255) not null, body text not null, audience varchar(64) not null,
 class_id varchar(191) references osaah_recovery_20261018.classes(id), student_ids_json jsonb, emergency boolean not null default false, sender_id varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.notifications (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), type varchar(64) not null, recipient_id varchar(191) not null references osaah_recovery_20261018.users(id),
 student_id varchar(191) references osaah_recovery_20261018.students(id), title varchar(255) not null, body text not null, status varchar(32) not null, created_at timestamptz not null default now(), created_by varchar(191) references osaah_recovery_20261018.users(id)
);
create table if not exists osaah_recovery_20261018.messages (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), sender_id varchar(191) not null references osaah_recovery_20261018.users(id), recipient_id varchar(191) not null references osaah_recovery_20261018.users(id),
 student_id varchar(191) not null references osaah_recovery_20261018.students(id), body text not null, status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.notification_preferences (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), user_id varchar(191) not null references osaah_recovery_20261018.users(id), settings_json jsonb not null, updated_at timestamptz not null default now(), unique(school_id,user_id)
);
create table if not exists osaah_recovery_20261018.communication_delivery_log (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), channel varchar(32) not null, provider varchar(128), message_id varchar(191), status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.system_settings (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), setting_key varchar(128) not null, setting_value text, value_type varchar(32) not null default 'string', is_sensitive boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,setting_key)
);
create table if not exists osaah_recovery_20261018.audit_logs (
 id varchar(191) primary key, school_id varchar(64) references osaah_recovery_20261018.schools(id), user_id varchar(191) references osaah_recovery_20261018.users(id), role_id varchar(191) references osaah_recovery_20261018.roles(id),
 action varchar(128) not null, entity varchar(128) not null, entity_id varchar(191), previous_value jsonb, new_value jsonb, ip_address inet, session_id varchar(191), device_metadata jsonb, occurred_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.ai_audit_logs (
 id varchar(191) primary key, request_id varchar(191) not null, correlation_id varchar(191) not null, occurred_at timestamptz not null,
 event_type varchar(128) not null, severity varchar(32) not null, school_id varchar(64) references osaah_recovery_20261018.schools(id), user_id varchar(191) references osaah_recovery_20261018.users(id),
 role_key varchar(64), capability_id varchar(128), tool_name varchar(128), operation_type varchar(64), authorization_result varchar(32), data_scope_json jsonb,
 production_data_only boolean, data_quality_status varchar(32), request_status varchar(32) not null, duration_ms integer, provider varchar(64), model varchar(128),
 input_tokens integer, output_tokens integer, total_tokens integer, estimated_cost numeric(12,6), error_code varchar(128), action_requested boolean not null default false,
 action_executed boolean not null default false, approval_user_id varchar(191) references osaah_recovery_20261018.users(id), rejection_user_id varchar(191) references osaah_recovery_20261018.users(id),
 action_decision_at timestamptz, target_record_id varchar(191), rollback_reference_id varchar(191), environment varchar(32) not null, metadata_json jsonb
);
create table if not exists osaah_recovery_20261018.ai_human_controlled_actions (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), creator_user_id varchar(191) not null references osaah_recovery_20261018.users(id),
 action_type varchar(128) not null, proposed_change text not null, sanitized_payload text not null, required_prepare_permission varchar(128) not null,
 required_approval_permission varchar(128) not null, status varchar(32) not null check(status in ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED')),
 submitted_at timestamptz, decided_at timestamptz, decided_by varchar(191) references osaah_recovery_20261018.users(id), executed_at timestamptz,
 version integer not null default 1 check(version>0), idempotency_key varchar(191) not null, integrity char(64) not null check(length(integrity)=64),
 failure_code varchar(128), failure_reason text, execution_result text, created_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists osaah_recovery_20261018.invoices (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), invoice_number varchar(128) not null unique,
 student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), parent_user_id varchar(191) references osaah_recovery_20261018.users(id), line_items_json jsonb not null,
 discount numeric(15,2) not null default 0, total numeric(15,2) not null, paid numeric(15,2) not null default 0, balance numeric(15,2) not null,
 status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.payments (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), receipt_number varchar(128) not null unique,
 invoice_id varchar(191) not null references osaah_recovery_20261018.invoices(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id), amount numeric(15,2) not null,
 payment_method varchar(32) not null, status varchar(32) not null default 'VALID', entered_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(),
 changed_by varchar(191) references osaah_recovery_20261018.users(id), changed_at timestamptz, change_reason text
);
create table if not exists osaah_recovery_20261018.financial_adjustments (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id),
 adjustment_type varchar(64) not null, amount numeric(15,2) not null, reason text, authorized_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.fee_payments (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), payment_reference varchar(100) not null, account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id),
 invoice_id varchar(64), permanent_student_id varchar(100) not null, student_name varchar(255) not null, class_name varchar(100) not null, academic_year varchar(20) not null,
 term varchar(30) not null, fee_type varchar(100), amount numeric(15,2) not null, payment_method varchar(32) not null default 'CASH', transaction_reference varchar(150),
 payment_date timestamptz not null default now(), received_by varchar(64) references osaah_recovery_20261018.users(id), notes text, status varchar(16) not null default 'COMPLETED',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,payment_reference)
);
create table if not exists osaah_recovery_20261018.fee_receipts (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), receipt_number varchar(100) not null, payment_id varchar(64) not null unique references osaah_recovery_20261018.fee_payments(id),
 invoice_id varchar(64), account_id varchar(64) not null references osaah_recovery_20261018.student_fee_accounts(id), permanent_student_id varchar(100) not null, student_name varchar(255) not null,
 class_name varchar(100) not null, academic_year varchar(20) not null, term varchar(30) not null, amount_paid numeric(15,2) not null, previous_balance numeric(15,2) not null default 0,
 new_balance numeric(15,2) not null default 0, payment_method varchar(32), received_by varchar(64) references osaah_recovery_20261018.users(id), issued_at timestamptz not null default now(),
 status varchar(8) not null default 'VALID', voided_at timestamptz, voided_by varchar(64) references osaah_recovery_20261018.users(id), void_reason varchar(255), created_at timestamptz not null default now(), unique(school_id,receipt_number)
);
create table if not exists osaah_recovery_20261018.payment_gateway_configs (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), provider varchar(64) not null, public_config_json jsonb not null, secret_key_setting varchar(128), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.fee_structures_v2 (
 id varchar(64) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), fee_type_id varchar(64) references osaah_recovery_20261018.fee_types(id), class_id varchar(64) references osaah_recovery_20261018.classes(id),
 academic_year_id varchar(64), term_id varchar(64), amount numeric(15,2) not null, status varchar(32) not null default 'DRAFT', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.calendar_events (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), event_type varchar(64) not null, title varchar(255) not null,
 starts_at timestamptz not null, ends_at timestamptz, audience varchar(64) not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.assignment_files (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), assignment_id varchar(191) not null, storage_key text not null,
 uploaded_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.assignments (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), class_id varchar(191) not null references osaah_recovery_20261018.classes(id), subject_id varchar(191) references osaah_recovery_20261018.subjects(id),
 title varchar(255) not null, description text, due_at timestamptz, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sample_data_fixtures (
 fixture_id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), sample_student_id varchar(191) not null, academic_year_id varchar(191), term_id varchar(191), class_id varchar(191),
 fixture_type varchar(64) not null, fixture_payload jsonb not null, fixture_version varchar(32) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.class_label_aliases (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), class_id varchar(191) not null references osaah_recovery_20261018.classes(id), alias varchar(128) not null, unique(school_id,alias)
);
create table if not exists osaah_recovery_20261018.student_transcripts (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.student_profiles(id),
 transcript_reference varchar(32) not null unique, current_version integer not null default 1, status varchar(32) not null default 'DRAFT',
 generated_by varchar(191) not null references osaah_recovery_20261018.users(id), generated_at timestamptz not null, published_by varchar(191) references osaah_recovery_20261018.users(id), published_at timestamptz,
 revoked_by varchar(191) references osaah_recovery_20261018.users(id), revoked_at timestamptz, revocation_reason text, created_at timestamptz not null, updated_at timestamptz not null
);
create table if not exists osaah_recovery_20261018.student_transcript_versions (
 id varchar(191) primary key, transcript_id varchar(191) not null references osaah_recovery_20261018.student_transcripts(id), version_number integer not null, academic_snapshot text not null,
 document_checksum varchar(128) not null, verification_token_hash varchar(128) not null unique, generated_by varchar(191) not null references osaah_recovery_20261018.users(id), generated_at timestamptz not null,
 published_by varchar(191) references osaah_recovery_20261018.users(id), published_at timestamptz, regeneration_reason text, status varchar(32) not null default 'DRAFT', superseded_by_version integer,
 revoked_by varchar(191) references osaah_recovery_20261018.users(id), revoked_at timestamptz, revocation_reason text, unique(transcript_id,version_number)
);
create table if not exists osaah_recovery_20261018.result_signatures (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), signatory_role varchar(64) not null,
 storage_key text, mime_type varchar(128) not null, document_size integer not null default 0, active boolean not null default true,
 uploaded_by varchar(191) not null references osaah_recovery_20261018.users(id), uploaded_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_active_result_signature on osaah_recovery_20261018.result_signatures(school_id,signatory_role) where active;
create table if not exists osaah_recovery_20261018.official_documents (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), document_number varchar(128) not null, document_type varchar(64) not null,
 recipient_id varchar(191), student_id varchar(191) references osaah_recovery_20261018.students(id), document_date date not null, title varchar(255) not null, body text, signatures_json jsonb,
 stamp text, verification_code varchar(128) not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(),
 unique(school_id,document_number), unique(school_id,verification_code)
);
create table if not exists osaah_recovery_20261018.report_exports (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), report_type varchar(64) not null, filters_json jsonb, format varchar(16) not null,
 generated_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.managed_documents (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), document_number varchar(128) not null, category varchar(64) not null,
 title varchar(255) not null, entity_id varchar(191), storage_key text not null, checksum char(64) not null, version integer not null,
 expires_at timestamptz, access_roles_json jsonb, verification_code varchar(128) not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), unique(school_id,document_number), unique(school_id,verification_code)
);
create table if not exists osaah_recovery_20261018.document_versions (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), document_id varchar(191) not null references osaah_recovery_20261018.managed_documents(id),
 version integer not null, checksum char(64) not null, expires_at timestamptz, updated_by varchar(191) not null references osaah_recovery_20261018.users(id), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.compliance_records (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), compliance_type varchar(64) not null, licence_number varchar(128), licence_type varchar(64),
 issue_date date, expiry_date date, status varchar(32) not null, recommendations_json jsonb, corrective_actions_json jsonb, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.compliance_inspections (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), compliance_id varchar(191) not null references osaah_recovery_20261018.compliance_records(id), inspected_at timestamptz not null,
 rating varchar(32), recommendations_json jsonb, corrective_actions_json jsonb, inspector varchar(255), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.privacy_consents (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), subject_id varchar(191) not null, purpose varchar(255) not null, granted boolean not null,
 recorded_by varchar(191) not null references osaah_recovery_20261018.users(id), recorded_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.privacy_requests (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), request_type varchar(64) not null, subject_id varchar(191) not null, details text,
 status varchar(32) not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.retention_policies (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), data_category varchar(128) not null, retention_period varchar(64) not null,
 action_after_expiry varchar(64) not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.data_protection_officers (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), user_id varchar(191) not null references osaah_recovery_20261018.users(id), designation varchar(128) not null,
 appointed_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.data_breaches (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), discovered_at timestamptz not null, description text not null,
 severity varchar(32) not null, containment text, status varchar(32) not null, reported_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sporting_sports (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null, created_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists osaah_recovery_20261018.sporting_teams (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), sport_id varchar(191) not null references osaah_recovery_20261018.sporting_sports(id), name varchar(128) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sporting_activities (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), title varchar(255) not null, activity_type varchar(64) not null, starts_at timestamptz, ends_at timestamptz, status varchar(32) not null, created_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sporting_participants (
 id varchar(191) primary key, activity_id varchar(191) not null references osaah_recovery_20261018.sporting_activities(id), student_id varchar(191) references osaah_recovery_20261018.students(id), staff_id varchar(191) references osaah_recovery_20261018.staff(id), participant_type varchar(32) not null, unique(activity_id,student_id,staff_id)
);
create table if not exists osaah_recovery_20261018.sporting_fixtures (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), sport_id varchar(191) not null references osaah_recovery_20261018.sporting_sports(id), home_team_id varchar(191) references osaah_recovery_20261018.sporting_teams(id), away_team_id varchar(191) references osaah_recovery_20261018.sporting_teams(id), starts_at timestamptz, venue text, status varchar(32) not null
);
create table if not exists osaah_recovery_20261018.sporting_results (
 id varchar(191) primary key, fixture_id varchar(191) not null references osaah_recovery_20261018.sporting_fixtures(id), home_score integer, away_score integer, notes text, recorded_by varchar(191) references osaah_recovery_20261018.users(id), recorded_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.shep_activities (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), title varchar(255) not null, activity_type varchar(64) not null, status varchar(32) not null, payload jsonb not null default '{}', created_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.shep_activity_attachments (
 id varchar(191) primary key, activity_id varchar(191) not null references osaah_recovery_20261018.shep_activities(id), storage_key text not null, uploaded_by varchar(191) references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.shep_activity_participants (
 id varchar(191) primary key, activity_id varchar(191) not null references osaah_recovery_20261018.shep_activities(id), student_id varchar(191) references osaah_recovery_20261018.students(id), staff_id varchar(191) references osaah_recovery_20261018.staff(id), unique(activity_id,student_id,staff_id)
);
create table if not exists osaah_recovery_20261018.shep_referrals (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), activity_id varchar(191) references osaah_recovery_20261018.shep_activities(id), reason text not null, status varchar(32) not null, referred_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.shep_audit_history (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), activity_id varchar(191) references osaah_recovery_20261018.shep_activities(id), actor_id varchar(191) references osaah_recovery_20261018.users(id), action varchar(64) not null, details jsonb, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.library_books (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), isbn varchar(32), title varchar(255) not null, authors_json jsonb,
 category varchar(128), shelf varchar(64), copies integer not null, available_copies integer not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.library_loans (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), book_id varchar(191) not null references osaah_recovery_20261018.library_books(id),
 borrower_id varchar(191) not null, borrower_type varchar(32) not null, due_at timestamptz, status varchar(32) not null, borrowed_by varchar(191) not null references osaah_recovery_20261018.users(id), borrowed_at timestamptz not null, returned_at timestamptz
);
create table if not exists osaah_recovery_20261018.transport_vehicles (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), registration varchar(64) not null, insurance_expires_at date, roadworthiness_expires_at date, driver_id varchar(191), attendant_ids_json jsonb, emergency_contact varchar(64), status varchar(32) not null, created_at timestamptz not null default now(), unique(school_id,registration)
);
create table if not exists osaah_recovery_20261018.transport_routes (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(128) not null, stops_json jsonb, vehicle_id varchar(191) references osaah_recovery_20261018.transport_vehicles(id), student_ids_json jsonb, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.hostel_spaces (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), type varchar(64) not null, name varchar(128) not null, capacity integer not null, warden_id varchar(191), matron_id varchar(191), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.hostel_allocations (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), space_id varchar(191) not null references osaah_recovery_20261018.hostel_spaces(id), bed varchar(64), active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.health_records (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), data_json jsonb not null, recorded_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.health_visits (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), data_json jsonb not null, recorded_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.welfare_incidents (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), kind varchar(64) not null, data_json jsonb not null, recorded_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.counselling_records (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), data_json jsonb not null, recorded_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.inventory_items (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(255) not null, item_type varchar(64) not null, unit varchar(32) not null, supplier varchar(255), reorder_level integer not null, quantity integer not null, created_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.inventory_movements (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), inventory_id varchar(191) not null references osaah_recovery_20261018.inventory_items(id), movement_type varchar(32) not null, quantity integer not null, delta integer not null, destination text, performed_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.assets (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), asset_id varchar(128) not null, asset_type varchar(64) not null, description text not null, serial_number varchar(128), location varchar(255), department varchar(128), custodian varchar(255), purchase_date date, purchase_value numeric(15,2), warranty text, condition varchar(32) not null, qr_code varchar(255) not null, status varchar(32) not null, created_at timestamptz not null default now(), unique(school_id,asset_id)
);
create table if not exists osaah_recovery_20261018.procurement_requests (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), request_number varchar(128) not null, item varchar(255) not null, quantity integer not null, supplier varchar(255), quotation text, state varchar(32) not null, requested_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.school_property (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), name varchar(255) not null, property_type varchar(64) not null, location text, responsible_officer varchar(255), status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.external_exam_records (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), student_id varchar(191) not null references osaah_recovery_20261018.students(id), exam_name varchar(128) not null, candidate_number varchar(128), subjects_json jsonb, preparation_notes text, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.property_maintenance (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), property_id varchar(191) not null references osaah_recovery_20261018.school_property(id), title varchar(255) not null, details text, responsible_officer varchar(255), status varchar(32) not null, requested_by varchar(191) not null references osaah_recovery_20261018.users(id), created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sidebar_categories (
 id varchar(191) primary key, category_key varchar(128) not null unique, category_name varchar(128) not null, display_order integer not null, enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.sidebar_modules (
 id varchar(191) primary key, module_key varchar(128) not null unique, module_name varchar(128) not null, category_id varchar(191) not null references osaah_recovery_20261018.sidebar_categories(id), route text not null, icon varchar(64) not null, display_order integer not null default 0, required_permission varchar(128) references osaah_recovery_20261018.permissions(permission_key), enabled boolean not null default true, parent_module_id varchar(191) references osaah_recovery_20261018.sidebar_modules(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.attendance_notification_settings (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), parent_user_id varchar(191) not null references osaah_recovery_20261018.users(id), absence_enabled boolean not null default true, lateness_enabled boolean not null default true, updated_at timestamptz not null default now(), unique(school_id,parent_user_id)
);
create table if not exists osaah_recovery_20261018.attendance_sync_conflicts (
 id varchar(191) primary key, school_id varchar(64) not null references osaah_recovery_20261018.schools(id), attendance_id varchar(191) references osaah_recovery_20261018.student_attendance(id), client_version integer, server_version integer, client_payload jsonb not null, detected_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.schema_baselines (
 id varchar(64) primary key, canonical_database varchar(128) not null, baseline_at timestamptz not null, repository_commit char(40) not null,
 schema_fingerprint char(64) not null, reconciliation_migration varchar(255) not null, workflow_provenance varchar(255) not null,
 baseline_type varchar(32) not null default 'HISTORICAL_BASELINE', historical_migrations_executed boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists osaah_recovery_20261018.schema_migrations (
 version integer primary key, name varchar(255) not null, checksum char(64) not null, applied_at timestamptz not null
);
create table if not exists osaah_recovery_20261018.schema_migration_lock (
 lock_id smallint primary key check(lock_id=1), locked boolean not null default false, acquired_at timestamptz
);

alter table osaah_recovery_20261018.student_fee_charges add constraint fk_student_fee_charges_account foreign key (account_id) references osaah_recovery_20261018.student_fee_accounts(id);
alter table osaah_recovery_20261018.student_fee_discounts add constraint fk_student_fee_discounts_account foreign key (account_id) references osaah_recovery_20261018.student_fee_accounts(id);

create index if not exists idx_communication_outbox_status on osaah_recovery_20261018.communication_outbox(school_id,status,next_attempt_at);
create index if not exists idx_communication_messages_provider on osaah_recovery_20261018.communication_messages(school_id,provider_message_id);
create index if not exists idx_communication_delivery_logs_message on osaah_recovery_20261018.communication_delivery_logs(message_id,occurred_at);
create index if not exists idx_terms_year on osaah_recovery_20261018.terms(academic_year_id);
create index if not exists idx_classes_school_sort on osaah_recovery_20261018.classes(school_id,sort_order,id);
create index if not exists idx_students_school on osaah_recovery_20261018.students(school_id);
create index if not exists idx_students_school_name on osaah_recovery_20261018.students(school_id,full_name);
create index if not exists idx_students_school_parent_phone on osaah_recovery_20261018.students(school_id,parent_phone);
create index if not exists idx_student_profiles_school_class on osaah_recovery_20261018.student_profiles(school_id,class_id);
create index if not exists idx_student_profiles_master_school on osaah_recovery_20261018.student_profiles(school_id,student_master_id);
create index if not exists idx_student_enrollments_durable_scope on osaah_recovery_20261018.student_enrollments(school_id,academic_year_id,class_id,is_current,enrollment_status);
create index if not exists idx_student_attendance_scope on osaah_recovery_20261018.student_attendance(school_id,academic_year,term,class_id,attendance_date);
create index if not exists idx_staff_attendance_scope on osaah_recovery_20261018.staff_attendance(school_id,academic_year,term,attendance_date,staff_id);
create index if not exists idx_attendance_audit_scope on osaah_recovery_20261018.attendance_audit_history(school_id,attendance_record_id,changed_at);
create index if not exists idx_fee_obligations_student on osaah_recovery_20261018.fee_obligations(school_id,student_id);
create index if not exists idx_fee_collections_period_scope on osaah_recovery_20261018.fee_collection_records(school_id,collection_type,academic_year_id,collection_period,collection_date);
create index if not exists idx_student_fee_account_student on osaah_recovery_20261018.student_fee_accounts(school_id,permanent_student_id);
create index if not exists idx_fee_ledger_account on osaah_recovery_20261018.student_fee_ledger(school_id,account_id,transaction_date);
create index if not exists idx_fee_invoice_student on osaah_recovery_20261018.fee_invoices(school_id,permanent_student_id,academic_year_id,term_id);
create index if not exists idx_fee_invoice_items_invoice on osaah_recovery_20261018.fee_invoice_items(school_id,invoice_id);
create index if not exists idx_student_fee_payment_account on osaah_recovery_20261018.student_fee_payments(school_id,account_id,payment_date);
create index if not exists idx_student_fee_receipt_student on osaah_recovery_20261018.student_fee_receipts(school_id,permanent_student_id,issued_at);
create index if not exists idx_financial_audit_entity on osaah_recovery_20261018.financial_audit_history(school_id,entity_type,entity_id,changed_at);
create index if not exists idx_general_income_school_date on osaah_recovery_20261018.general_income(school_id,transaction_date,id);
create index if not exists idx_general_expenses_school_date on osaah_recovery_20261018.general_expenses(school_id,transaction_date,id);
create index if not exists idx_budgets_school_period on osaah_recovery_20261018.budgets(school_id,academic_year,term);
create index if not exists idx_auth_sessions_expiry on osaah_recovery_20261018.auth_sessions(expires_at,revoked_at);
create index if not exists idx_announcement_recipient on osaah_recovery_20261018.announcement_recipients(school_id,recipient_id,announcement_id);
create index if not exists idx_sms_campaign_history on osaah_recovery_20261018.sms_campaigns(school_id,created_by,updated_at);
create index if not exists idx_examination_marks_student on osaah_recovery_20261018.examination_marks(school_id,student_id,examination_id);
create index if not exists idx_ai_audit_timestamp on osaah_recovery_20261018.ai_audit_logs(occurred_at);
create index if not exists idx_ai_audit_request on osaah_recovery_20261018.ai_audit_logs(request_id,correlation_id);
create index if not exists idx_ai_actions_school_status on osaah_recovery_20261018.ai_human_controlled_actions(school_id,status,created_at desc);
create index if not exists idx_student_transcripts_student on osaah_recovery_20261018.student_transcripts(school_id,student_id);
create index if not exists idx_compliance_expiry on osaah_recovery_20261018.compliance_records(school_id,expiry_date);
create index if not exists idx_report_exports_type on osaah_recovery_20261018.report_exports(school_id,report_type,created_at);
create index if not exists idx_student_fee_account_scope on osaah_recovery_20261018.student_fee_accounts(school_id,permanent_student_id,academic_year_id,term_id);
create index if not exists idx_student_fee_payment_reference on osaah_recovery_20261018.student_fee_payments(school_id,payment_reference);
create index if not exists idx_student_fee_receipt_number on osaah_recovery_20261018.student_fee_receipts(school_id,receipt_number);

create or replace view osaah_recovery_20261018.vw_student_fee_balances as
 select a.id as account_id,a.school_id,a.student_id,a.permanent_student_id,a.academic_year_id,a.term_id,a.class_id,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='CHARGE'),0) as total_charged,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='DISCOUNT'),0) as total_discount,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='PAYMENT'),0) as total_paid,
 coalesce(sum(case when l.status='ACTIVE' and l.transaction_type='CHARGE' then l.amount when l.status='ACTIVE' and l.transaction_type in ('DISCOUNT','PAYMENT') then -l.amount else 0 end),0) as balance
 from osaah_recovery_20261018.student_fee_accounts a left join osaah_recovery_20261018.student_fee_ledger l on l.account_id=a.id and l.school_id=a.school_id
 group by a.id,a.school_id,a.student_id,a.permanent_student_id,a.academic_year_id,a.term_id,a.class_id;
create or replace view osaah_recovery_20261018.vw_fee_overview as select school_id,academic_year_id,term_id,count(*) as student_accounts,sum(total_charged) as expected_fees,sum(total_discount) as discounts,sum(total_paid) as collected,sum(balance) as outstanding from osaah_recovery_20261018.vw_student_fee_balances group by school_id,academic_year_id,term_id;
create or replace view osaah_recovery_20261018.vw_fee_arrears as select * from osaah_recovery_20261018.vw_student_fee_balances where balance>0;
create or replace view osaah_recovery_20261018.vw_invoice_receipt_register as
 select p.school_id,p.permanent_student_id,p.academic_year_id,p.term_id,p.class_id,i.invoice_number,p.payment_reference,r.receipt_number,
 p.amount as amount_paid,p.payment_method,p.payment_date,r.previous_balance,r.new_balance,r.issued_at,p.status as payment_status,r.status as receipt_status
 from osaah_recovery_20261018.student_fee_payments p left join osaah_recovery_20261018.fee_invoices i on i.id=p.invoice_id and i.school_id=p.school_id
 left join osaah_recovery_20261018.student_fee_receipts r on r.payment_id=p.id and r.school_id=p.school_id;
create or replace view osaah_recovery_20261018.vw_fee_collection_summary as
 select school_id,collection_type,academic_year_id,term_id,collection_period,collection_date,count(*) as transaction_count,sum(amount_received_minor) as amount_received_minor
 from osaah_recovery_20261018.fee_collection_records group by school_id,collection_type,academic_year_id,term_id,collection_period,collection_date;
create or replace view osaah_recovery_20261018.vw_published_fee_structures as
 select id,school_id,academic_year as academic_year_id,term as term_id,class_id,category_name as fee_type,amount,status
 from osaah_recovery_20261018.fee_structures where status='PUBLISHED';

-- Existing runtime reads this literal ID; database roles and auth sessions remain
-- private. The API server should verify cookie/session/RBAC before using service credentials.
create unique index if not exists uq_auth_sessions_token_hash on osaah_recovery_20261018.auth_sessions(token_hash);
create index if not exists idx_auth_sessions_user_active on osaah_recovery_20261018.auth_sessions(user_id,revoked_at,expires_at);
create index if not exists idx_auth_sessions_school on osaah_recovery_20261018.auth_sessions(school_id);
-- Keep the prepared application schema private until a reviewed runtime role and policies exist.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='osaah_recovery_20261018' LOOP
    EXECUTE format('ALTER TABLE osaah_recovery_20261018.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA osaah_recovery_20261018 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA osaah_recovery_20261018 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA osaah_recovery_20261018 FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO osaah_recovery_20261018.schema_migrations(version,name,checksum,applied_at)
VALUES (20261018,'captured-12-table-structural-stage','6d960fff24f381775b84d53c33f0ce36a9100e4e9882b6d6af186cf51447608a',now());

-- Structural postconditions; source rows and public objects remain untouched.
DO $$
DECLARE actual_count bigint;
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='osaah_recovery_20261018' AND table_type='BASE TABLE') <> 159
     OR (SELECT count(*) FROM information_schema.views WHERE table_schema='osaah_recovery_20261018') <> 6
     OR (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
         WHERE n.nspname='osaah_recovery_20261018' AND c.contype='f') <> 448
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='osaah_recovery_20261018' AND c.relkind IN ('r','p') AND c.relrowsecurity) <> 159 THEN
    RAISE EXCEPTION 'Canonical schema postcondition failed';
  END IF;
  IF has_schema_privilege('anon','osaah_recovery_20261018','USAGE')
     OR has_schema_privilege('authenticated','osaah_recovery_20261018','USAGE')
     OR has_schema_privilege('service_role','osaah_recovery_20261018','USAGE') THEN
    RAISE EXCEPTION 'Prepared schema unexpectedly grants API-role schema access';
  END IF;
  IF (SELECT count(*) FROM osaah_recovery_20261018.schema_migrations) <> 1
     OR NOT EXISTS (SELECT 1 FROM osaah_recovery_20261018.schema_migrations
                    WHERE version=20261018 AND name='captured-12-table-structural-stage'
                      AND checksum='6d960fff24f381775b84d53c33f0ce36a9100e4e9882b6d6af186cf51447608a') THEN
    RAISE EXCEPTION 'Structural migration ledger postcondition failed';
  END IF;
  IF (SELECT count(*) FROM osaah_recovery_20261018.schools) <> 0
     OR (SELECT count(*) FROM osaah_recovery_20261018.users) <> 0
     OR (SELECT count(*) FROM osaah_recovery_20261018.roles) <> 0
     OR (SELECT count(*) FROM osaah_recovery_20261018.user_roles) <> 0
     OR (SELECT count(*) FROM osaah_recovery_20261018.parent_student_links) <> 0
     OR (SELECT count(*) FROM osaah_recovery_20261018.auth_sessions) <> 0 THEN
    RAISE EXCEPTION 'Structural stage must not create school, account, role, Parent, or session data';
  END IF;
  FOR actual_count IN SELECT row_count FROM pg_temp.osaah_captured_source_counts LOOP
    NULL;
  END LOOP;
END $$;
DO $$ DECLARE t record; observed bigint; BEGIN
  FOR t IN SELECT table_name, row_count FROM pg_temp.osaah_captured_source_counts LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t.table_name) INTO observed;
    IF observed <> t.row_count THEN
      RAISE EXCEPTION 'Source row count changed for public.%', t.table_name;
    END IF;
  END LOOP;
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Structural stage unexpectedly modified the public migration ledger';
  END IF;
END $$;

DROP TABLE pg_temp.osaah_captured_source_counts;
DROP TABLE pg_temp.osaah_captured_expected_columns;
COMMIT;
