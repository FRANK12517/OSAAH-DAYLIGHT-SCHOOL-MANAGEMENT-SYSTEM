-- OSAAH PostgreSQL migration for the inspected Supabase starter schema.
-- Generated from the canonical baseline plus the verified read-only catalog on 2026-10-15.
-- Target must be verified in the Supabase dashboard as ref douzohkmnuqwbpwcezke.
-- This migration preserves the seven empty starter tables in a private archive schema,
-- then creates the canonical OSAAH schema. It never drops or converts existing records.
-- It aborts if the inspected schema has drifted, contains rows, or has dependencies not reviewed.
-- Review docs/supabase-migration-plan.md and rollback-plan.md before applying.

BEGIN;

DO $$
DECLARE
  actual_tables text[];
  actual_sequences text[];
  table_name text;
  has_rows boolean;
  catalog_signature record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Preflight stopped: required Supabase roles are missing or service_role lacks BYPASSRLS.';
  END IF;

  IF to_regnamespace('osaah_legacy_20261015') IS NOT NULL THEN
    RAISE EXCEPTION 'Preflight stopped: archive schema osaah_legacy_20261015 already exists; migration may already be applied or require review.';
  END IF;

  SELECT array_agg(tablename::text ORDER BY tablename) INTO actual_tables
  FROM pg_tables WHERE schemaname = 'public';
  IF actual_tables IS DISTINCT FROM ARRAY['assessments','attendance','classes','fee_payments','students','subjects','users']::text[] THEN
    RAISE EXCEPTION 'Preflight stopped: public table set changed from the reviewed seven-table starter schema.';
  END IF;

  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO actual_sequences
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S';
  IF actual_sequences IS DISTINCT FROM ARRAY['assessments_id_seq','attendance_id_seq','classes_id_seq','fee_payments_id_seq','students_id_seq','subjects_id_seq']::text[] THEN
    RAISE EXCEPTION 'Preflight stopped: public identity sequence set changed from the reviewed starter schema.';
  END IF;

  -- These hashes capture the complete catalog definitions observed on the hosted
  -- PostgreSQL 17 starter project. They intentionally include types, defaults,
  -- identity/generated expressions, constraints, index DDL, sequence ownership and
  -- settings, direct grants, RLS/policies, relation ownership/security flags, and
  -- catalog dependencies. Any drift fails before the archive schema is created.
  WITH
  cols AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(c.table_name,c.ordinal_position,c.column_name,
      format_type(a.atttypid,a.atttypmod),c.is_nullable,c.column_default,c.is_identity,
      c.identity_generation,c.is_generated,c.generation_expression)
      ORDER BY c.table_name,c.ordinal_position),'[]'::jsonb) AS j
    FROM information_schema.columns c
    JOIN pg_namespace n ON n.nspname=c.table_schema
    JOIN pg_class t ON t.relnamespace=n.oid AND t.relname=c.table_name
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=c.column_name
    WHERE c.table_schema='public' AND t.relkind='r'
  ),
  cons AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(t.relname,x.conname,x.contype,
      pg_get_constraintdef(x.oid,true),x.convalidated)
      ORDER BY t.relname,x.conname),'[]'::jsonb) AS j
    FROM pg_constraint x JOIN pg_class t ON t.oid=x.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
  ),
  idx AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(tablename,indexname,indexdef)
      ORDER BY tablename,indexname),'[]'::jsonb) AS j
    FROM pg_indexes WHERE schemaname='public'
  ),
  seq AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(s.relname,format_type(q.seqtypid,null),
      q.seqstart,q.seqincrement,q.seqmax,q.seqmin,q.seqcache,q.seqcycle,
      tn.nspname,t.relname,a.attname,d.deptype) ORDER BY s.relname),'[]'::jsonb) AS j
    FROM pg_class s JOIN pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_sequence q ON q.seqrelid=s.oid
    LEFT JOIN pg_depend d ON d.objid=s.oid AND d.classid='pg_class'::regclass
      AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class t ON t.oid=d.refobjid
    LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE sn.nspname='public' AND s.relkind='S'
  ),
  pol AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(tablename,policyname,permissive,
      roles,cmd,qual,with_check) ORDER BY tablename,policyname),'[]'::jsonb) AS j
    FROM pg_policies WHERE schemaname='public'
  ),
  acl AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,
      r.rolname,x.privilege_type,x.is_grantable)
      ORDER BY n.nspname,c.relname,c.relkind,r.rolname,x.privilege_type),'[]'::jsonb) AS j
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,
      acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x
    JOIN pg_roles r ON r.oid=x.grantee
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
      AND r.rolname IN ('anon','authenticated','service_role','PUBLIC')
  ),
  rel AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relrowsecurity,
      c.relforcerowsecurity,pg_get_userbyid(c.relowner)) ORDER BY c.relname),'[]'::jsonb) AS j
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
  ),
  deps AS (
    SELECT coalesce(jsonb_agg(jsonb_build_array(src.relname,dep.deptype,
      dep.refclassid::regclass::text,dep.refobjid::text,dep.refobjsubid)
      ORDER BY src.relname,dep.deptype,dep.refclassid::regclass::text,
        dep.refobjid,dep.refobjsubid),'[]'::jsonb) AS j
    FROM pg_depend dep JOIN pg_class src ON src.oid=dep.objid
      AND dep.classid='pg_class'::regclass
    JOIN pg_namespace n ON n.oid=src.relnamespace
    WHERE n.nspname='public' AND src.relkind IN ('r','S')
  )
  SELECT md5(cols.j::text) AS columns_hash, md5(cons.j::text) AS constraints_hash,
    md5(idx.j::text) AS indexes_hash, md5(seq.j::text) AS sequences_hash,
    md5(pol.j::text) AS policies_hash, md5(acl.j::text) AS grants_hash,
    md5(rel.j::text) AS relations_hash, md5(deps.j::text) AS dependencies_hash
  INTO catalog_signature FROM cols,cons,idx,seq,pol,acl,rel,deps;

  IF catalog_signature.columns_hash <> '9d02a3ed8acefcfe00c2c2cbb6430397'
     OR catalog_signature.constraints_hash <> '6844c600d4797d37d36155d01f12168b'
     OR catalog_signature.indexes_hash <> '94a3278e3571ab8bae46ca70177a9dcc'
     OR catalog_signature.sequences_hash <> '432b0da641ea0b4f25767432136c268b'
     OR catalog_signature.policies_hash <> '6090c1ddc1f5f0eeb9e4080a4e1e2014'
     OR catalog_signature.grants_hash <> '2d60fdb728a3461bc69a2d51886f7610'
     OR catalog_signature.relations_hash <> 'a85c6c94980b8858051973740ede4910'
     OR catalog_signature.dependencies_hash <> '8dd88753a3c4b98a1e9440383da4da29' THEN
    RAISE EXCEPTION 'Preflight stopped: exact hosted starter catalog signature changed; no objects were moved.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public')
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('m','f','p'))
     OR EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_schema = 'public')
     OR EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_schema = 'public') THEN
    RAISE EXCEPTION 'Preflight stopped: public views, routines, triggers, materialized/foreign/partitioned tables require dependency review.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Preflight stopped: one or more reviewed starter tables no longer have RLS enabled.';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 3
     OR EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND NOT (tablename IN ('classes','students','subjects')
                  AND policyname = 'Allow anon read access'
                  AND roles::text = '{public}'
                  AND cmd = 'SELECT'
                  AND qual = 'true'
                  AND with_check IS NULL)
     ) THEN
    RAISE EXCEPTION 'Preflight stopped: public RLS policy set differs from the three reviewed starter read policies.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_class dst ON dst.oid = con.confrelid
    JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
    WHERE con.contype = 'f' AND src_ns.nspname = 'public'
      AND src.relname = ANY (ARRAY['assessments','attendance','classes','fee_payments','students','subjects','users'])
      AND NOT (dst_ns.nspname = 'public' AND dst.relname = ANY (ARRAY['assessments','attendance','classes','fee_payments','students','subjects','users']))
  ) THEN
    RAISE EXCEPTION 'Preflight stopped: a foreign key points outside the reviewed starter tables.';
  END IF;

  FOREACH table_name IN ARRAY ARRAY['assessments','attendance','classes','fee_payments','students','subjects','users'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', table_name) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Preflight stopped: public.% contains records. Export/reconcile and approve a data-preserving mapping before schema migration.', table_name;
    END IF;
  END LOOP;
END
$$;

-- Move existing objects intact. PostgreSQL moves associated indexes, constraints,
-- and owned identity sequences with each table. These tables remain available to the
-- owner for recovery but are not part of the OSAAH application schema.
CREATE SCHEMA osaah_legacy_20261015;
REVOKE ALL ON SCHEMA osaah_legacy_20261015 FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.assessments SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.attendance SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.classes SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.fee_payments SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.students SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.subjects SET SCHEMA osaah_legacy_20261015;
ALTER TABLE public.users SET SCHEMA osaah_legacy_20261015;

DROP POLICY "Allow anon read access" ON osaah_legacy_20261015.classes;
DROP POLICY "Allow anon read access" ON osaah_legacy_20261015.students;
DROP POLICY "Allow anon read access" ON osaah_legacy_20261015.subjects;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA osaah_legacy_20261015 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA osaah_legacy_20261015 FROM PUBLIC, anon, authenticated, service_role;


create schema if not exists extensions;

create table if not exists public.schools (
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

-- Preserve the production school identifier without overwriting an existing profile.
insert into public.schools (id, name)
values ('sch_default_01', 'OSAAH Daylight School')
on conflict (id) do nothing;

create table if not exists public.academic_years (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id),
  name varchar(128) not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, name), check (ends_on >= starts_on)
);
create table if not exists public.terms (
  id varchar(191) primary key, academic_year_id varchar(191) not null references public.academic_years(id),
  name varchar(64) not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (academic_year_id, name), check (ends_on >= starts_on)
);
create table if not exists public.levels (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null,
  display_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (school_id,name)
);
create table if not exists public.classes (
  id varchar(191) primary key, level_id varchar(191) references public.levels(id), school_id varchar(64) references public.schools(id),
  name varchar(128) not null, level varchar(100), display_order integer not null default 0, sort_order integer not null default 0,
  status varchar(16) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.streams (
  id varchar(191) primary key, class_id varchar(191) not null references public.classes(id), name varchar(128) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(class_id,name)
);
create table if not exists public.departments (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists public.subjects (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), department_id varchar(191) references public.departments(id),
  code varchar(64) not null, name varchar(128) not null, subject_type varchar(32), is_scoring boolean not null default true,
  is_active boolean not null default true, classification varchar(32), assessment_components_json jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,code)
);
create table if not exists public.houses (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null, colour varchar(32),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists public.users (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), username varchar(191), email varchar(255),
  password_hash text, full_name varchar(255), phone varchar(50), role varchar(64),
  status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,username)
);
create table if not exists public.portal_users (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), portal_name varchar(255), email varchar(255) not null unique,
 phone varchar(32), full_name varchar(255), password_hash text, role varchar(64) not null, is_active boolean not null default true,
 status varchar(32) not null default 'ACTIVE', linked_user_id varchar(191) references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.students (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), user_id varchar(191) unique references public.users(id),
  admission_number varchar(128) not null, first_name varchar(128) not null, middle_name varchar(128), last_name varchar(128) not null,
  full_name varchar(255), permanent_student_id varchar(100), gender varchar(32) not null default 'NOT_SPECIFIED', date_of_birth date,
  parent_guardian_name varchar(255), parent_phone varchar(50), admission_date date, admission_type varchar(64), student_status varchar(32) not null default 'ACTIVE',
 status varchar(32) generated always as (student_status) stored,
 health_insurance_number varchar(64), current_class_id varchar(191) references public.classes(id), class_id varchar(191) generated always as (current_class_id) stored, is_test_record boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,admission_number), unique(school_id,permanent_student_id)
);
create table if not exists public.staff (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), user_id varchar(191) unique references public.users(id),
  staff_number varchar(128) not null, first_name varchar(128) not null, last_name varchar(128) not null, department_id varchar(191) references public.departments(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,staff_number)
);
create table if not exists public.staff_profiles (
  id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), staff_id varchar(191) not null unique references public.staff(id),
  employee_id varchar(128) not null unique, full_name varchar(255) not null, photograph_path text, gender varchar(32), date_of_birth date, phone varchar(50), address text,
  emergency_contact_json jsonb, department_id varchar(191) references public.departments(id), role_key varchar(64), employment_type varchar(64), appointment_date date,
  contract_json jsonb, qualification text, institution text, certificates_json jsonb, ntc_json jsonb, professional_development_json jsonb,
  appraisal_json jsonb, promotion_json jsonb, documents_json jsonb, confidential_json jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.roles (
  id varchar(191) primary key, school_id varchar(64) references public.schools(id), role_key varchar(64) not null, role_name varchar(128) not null,
  oversight_rank integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,role_key)
);
create table if not exists public.permissions (
  id varchar(191) primary key, permission_key varchar(128) not null unique, permission_name varchar(255) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.user_roles (
  id varchar(191) unique, user_id varchar(191) not null references public.users(id), role_id varchar(191) not null references public.roles(id),
  created_at timestamptz not null default now(), primary key(user_id,role_id)
);
create table if not exists public.role_permissions (
  id varchar(191) unique, role_id varchar(191) not null references public.roles(id), permission_id varchar(191) not null references public.permissions(id),
  created_at timestamptz not null default now(), primary key(role_id,permission_id)
);
create table if not exists public.student_profiles (
 id varchar(191) primary key, student_master_id varchar(191) references public.students(id), student_id varchar(128) unique, permanent_student_id varchar(32) unique,
 school_id varchar(64) not null references public.schools(id), admission_number varchar(128) not null, index_number varchar(128),
  first_name varchar(128) not null, middle_name varchar(128), surname varchar(128) not null, last_name varchar(128) generated always as (surname) stored,
  preferred_name varchar(128), gender varchar(32), date_of_birth date,
  place_of_birth text, nationality varchar(100), photograph_path text, qr_code varchar(255) not null unique, class_id varchar(191) references public.classes(id),
  stream_id varchar(191) references public.streams(id), house_id varchar(191) references public.houses(id), admission_date date, previous_school text,
 admission_type varchar(64), enrollment_status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,admission_number)
);
create table if not exists public.student_family_contacts (
 id varchar(191) primary key, student_id varchar(191) not null references public.student_profiles(id), contact_type varchar(64) not null, full_name varchar(255) not null,
 relationship varchar(100), telephone varchar(50), alternative_phone varchar(50), address text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.student_health_records (
 student_id varchar(191) primary key references public.student_profiles(id), allergies text, conditions text, medications text, blood_group varchar(16),
 emergency_notes text, restricted_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.student_documents (
 id varchar(191) primary key, student_id varchar(191) not null references public.student_profiles(id), document_type varchar(64) not null,
 storage_key text not null, uploaded_by varchar(191) references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.student_class_history (
 id varchar(191) primary key, student_id varchar(191) not null references public.student_profiles(id), class_id varchar(191) references public.classes(id),
 stream_id varchar(191) references public.streams(id), academic_year_id varchar(191) references public.academic_years(id), reason text not null, effective_at timestamptz not null
);
create table if not exists public.parent_student_links (
 parent_user_id varchar(191) not null references public.users(id), student_id varchar(191) not null references public.student_profiles(id), permanent_student_id varchar(128),
 relationship varchar(100), relationship_type varchar(64), telephone varchar(50), link_status varchar(32) not null default 'ACTIVE',
 created_at timestamptz not null default now(), updated_at timestamptz, primary key(parent_user_id,student_id)
);
create table if not exists public.admission_applications (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), application_number varchar(128) not null unique,
 stage varchar(64) not null, applicant_data jsonb not null, admission_letter_key text, enrollment_confirmation_key text,
 student_id varchar(191) references public.students(id), enquiry_request_id varchar(64), permanent_student_id varchar(128),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_admission_applications_enquiry_request on public.admission_applications(school_id,enquiry_request_id) where enquiry_request_id is not null;
create unique index if not exists uq_admission_application_student_id on public.admission_applications(student_id) where student_id is not null;
create unique index if not exists uq_admission_application_permanent_student_id on public.admission_applications(school_id,permanent_student_id) where permanent_student_id is not null;
create table if not exists public.admission_form_applications (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), temporary_application_id varchar(128) not null unique,
 application_number varchar(128) not null unique, academic_year_id varchar(191) references public.academic_years(id), term_id varchar(191) references public.terms(id),
 application_date date not null, status varchar(32) not null check(status in ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED','REJECTED')),
 parent_user_id varchar(191) references public.users(id), section1_candidate jsonb not null, section2_history jsonb not null, section3_guardians jsonb not null,
 parent_declaration_accepted boolean not null default false, parent_signature_reference text, parent_declaration_date date,
 entrance_assessment_score numeric(5,2) check(entrance_assessment_score between 0 and 100), permanent_student_id varchar(128) unique,
 official_use jsonb not null default '{}', fee_snapshot jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.admission_documents (
 id varchar(191) primary key, application_id varchar(191) not null references public.admission_form_applications(id), school_id varchar(64) not null references public.schools(id),
 document_type varchar(64) not null, file_reference text not null, uploaded_at timestamptz not null default now(), verified boolean not null default false,
 verified_by varchar(191) references public.users(id), verified_at timestamptz
);
create table if not exists public.admission_fee_structures (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), level varchar(32) not null check(level in ('CRECHE_NURSERY','KINDERGARTEN','PRIMARY','JHS')),
 academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) not null references public.terms(id),
 tuition_academic_fee numeric(12,2) not null check(tuition_academic_fee>=0), ict_lab_library_fee numeric(12,2) not null check(ict_lab_library_fee>=0),
 pta_utility_charges numeric(12,2) not null check(pta_utility_charges>=0), total_termly_fee numeric(12,2) generated always as (tuition_academic_fee+ict_lab_library_fee+pta_utility_charges) stored,
 admission_registration_fee numeric(12,2) not null default 0 check(admission_registration_fee>=0), school_uniform_fee numeric(12,2) not null default 0 check(school_uniform_fee>=0),
 pe_kit_sportswear_fee numeric(12,2) not null default 0 check(pe_kit_sportswear_fee>=0), version integer not null default 1, is_published boolean not null default false,
 published_at timestamptz, published_by varchar(191) references public.users(id), publisher_role varchar(64), updated_by varchar(191) references public.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,level,academic_year_id,term_id,version)
);
create unique index if not exists uq_admission_fee_active on public.admission_fee_structures(school_id,level,academic_year_id,term_id) where is_published;
create table if not exists public.admission_prospectuses (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), class_id varchar(191) not null references public.classes(id),
 academic_year_id varchar(191) not null references public.academic_years(id), content text, document_url text, document_name text, document_type varchar(64),
 document_size integer not null default 0, status varchar(32) not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','UNPUBLISHED')),
 is_published boolean not null default false, published_at timestamptz, published_by varchar(191) references public.users(id), created_by varchar(191) not null references public.users(id),
 created_at timestamptz not null default now(), updated_by varchar(191) not null references public.users(id), updated_at timestamptz not null default now(),
 unique(school_id,class_id,academic_year_id)
);
create table if not exists public.student_id_sequences (
 admission_year smallint primary key, next_sequence integer not null check(next_sequence>=1), updated_at timestamptz not null default now()
);
create table if not exists public.student_enrollments (
 id varchar(191) primary key, school_id varchar(64) references public.schools(id), student_id varchar(191) not null references public.students(id),
 permanent_student_id varchar(100), academic_year_id varchar(191) references public.academic_years(id), academic_year varchar(20),
 class_id varchar(191) references public.classes(id), class_name varchar(100), term_id varchar(191) references public.terms(id),
 enrollment_status varchar(32) not null default 'ACTIVE', is_current boolean not null default true, enrolled_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_student_enrollment_context on public.student_enrollments(school_id,student_id,academic_year_id,term_id,is_current);

create table if not exists public.subject_class_assignments (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), subject_id varchar(191) not null references public.subjects(id),
 class_id varchar(191) not null references public.classes(id), academic_year_id varchar(191) references public.academic_years(id), active boolean not null default true,
 configuration_version varchar(32), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_subject_class_assignments_scope on public.subject_class_assignments(school_id,subject_id,class_id,(case when academic_year_id is null then 'N' else 'V' || academic_year_id end));
create table if not exists public.academic_score_records (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), record_type varchar(16) not null check(record_type in ('TERMINAL','MOCK')),
 mock_label varchar(64), academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) not null references public.terms(id),
 class_id varchar(191) not null references public.classes(id), student_id varchar(191) not null references public.student_profiles(id), subject_id varchar(191) not null references public.subjects(id),
 ca_score numeric(6,2) not null default 0, ca_max numeric(6,2) not null default 50, examination_score numeric(6,2) not null default 0,
 examination_max numeric(6,2) not null default 50, total_score numeric(6,2) not null, grade varchar(32), remark text, entered_by varchar(191) not null references public.users(id),
 updated_at timestamptz not null default now()
);
create unique index if not exists uq_academic_score_record_scope on public.academic_score_records
 (school_id,record_type,(case when mock_label is null then 'N' else 'V' || mock_label end),academic_year_id,term_id,class_id,student_id,subject_id);
create table if not exists public.academic_result_records (
 id varchar(191) primary key, school_id varchar(191) not null references public.schools(id), student_id varchar(191) not null references public.students(id),
 class_id varchar(191) not null references public.classes(id), academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) not null references public.terms(id),
 examination varchar(16) not null default 'TERMINAL', mock_label varchar(64), attendance_json jsonb, assessment_json jsonb, status varchar(16) not null default 'SAVED',
 version integer not null default 1, saved_by varchar(191) not null references public.users(id), saved_at timestamptz not null default now(),
 published_by varchar(191) references public.users(id), published_at timestamptz, updated_at timestamptz not null default now()
);
create unique index if not exists uq_academic_result_record_scope on public.academic_result_records
 (school_id,student_id,class_id,academic_year_id,term_id,examination,(case when mock_label is null then 'N' else 'V' || mock_label end));
create table if not exists public.academic_result_blocks (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 class_id varchar(191) not null references public.classes(id), student_id varchar(191), scope varchar(32) not null, status varchar(32) not null,
 reason text not null, blocked_by varchar(191) not null references public.users(id), blocked_by_role varchar(64) not null, blocked_at timestamptz not null,
 result_type varchar(16), mock_examination varchar(64), unblocked_by varchar(191) references public.users(id), unblocked_at timestamptz
);
create unique index if not exists uq_academic_result_block_examination_scope on public.academic_result_blocks
 (school_id,academic_year,term,class_id,result_type,(case when mock_examination is null then 'N' else 'V' || mock_examination end),student_id);
create index if not exists idx_academic_result_block_examination_lookup on public.academic_result_blocks
 (school_id,academic_year,term,class_id,result_type,mock_examination,status);
create table if not exists public.academic_result_unblock_requests (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), block_id varchar(64) not null references public.academic_result_blocks(id),
 academic_year varchar(128) not null, term varchar(128) not null, class_id varchar(128) not null references public.classes(id), student_id varchar(64) not null default '*',
 scope varchar(16) not null check(scope in ('STUDENT','CLASS')), reason varchar(500) not null, requested_by varchar(64) not null references public.users(id),
 requested_by_role varchar(64) not null, status varchar(16) not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 requested_at timestamptz not null, decided_by varchar(64) references public.users(id), decided_at timestamptz
);
create table if not exists public.canonical_ges_assessments (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id),
 class_id varchar(191) not null references public.classes(id), academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) not null references public.terms(id),
 conduct varchar(500), attitude varchar(500), interest varchar(500), class_teacher_remarks varchar(1000), headteacher_remarks varchar(1000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,student_id,class_id,academic_year_id,term_id)
);
create table if not exists public.student_attendance (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), attendance_date date not null, date date, class_id varchar(191) references public.classes(id),
 student_id varchar(191) not null references public.students(id), subject_id varchar(191) references public.subjects(id), subject_key varchar(128) not null default 'LEGACY_UNSPECIFIED',
 academic_year varchar(64) not null default 'LEGACY_UNSPECIFIED', term varchar(32) not null default 'LEGACY_UNSPECIFIED', status varchar(32) not null,
 method varchar(32), arrival_time timestamptz, departure_time timestamptz, reason text, remarks text, version integer not null default 1,
 entered_by varchar(191) references public.users(id), entered_at timestamptz, recorded_by varchar(191) references public.users(id), recorded_at timestamptz,
 updated_by varchar(191) references public.users(id), updated_at timestamptz, source varchar(32) not null default 'LEGACY_UNSPECIFIED', created_at timestamptz not null default now()
);
create unique index if not exists uq_student_attendance_scope_identity on public.student_attendance(school_id,academic_year,term,attendance_date,class_id,student_id,subject_key);
create table if not exists public.staff_attendance (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), staff_id varchar(191) not null references public.staff(id),
 attendance_date date not null, attendance_type varchar(32) not null, attendance_time timestamptz, academic_year varchar(64) not null default 'LEGACY_UNSPECIFIED',
 term varchar(32) not null default 'LEGACY_UNSPECIFIED', attendance_status varchar(32) not null default 'LEGACY_UNSPECIFIED',
 attendance_source varchar(32) not null default 'LEGACY_UNSPECIFIED', leave_request_id varchar(191), note text, previous_status varchar(32),
 entered_by varchar(191) references public.users(id), recorded_by varchar(191) references public.users(id), recorded_at timestamptz,
 updated_by varchar(191) references public.users(id), updated_at timestamptz, source varchar(32), created_at timestamptz not null default now()
);
create unique index if not exists uq_staff_attendance_scope_identity on public.staff_attendance(school_id,academic_year,term,attendance_date,staff_id,attendance_type);
create table if not exists public.staff_leave (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), staff_id varchar(191) not null references public.staff_profiles(id),
 leave_type varchar(64) not null, starts_on date not null, ends_on date not null, reason text, state varchar(32) not null default 'PENDING',
 applied_at timestamptz not null default now(), decided_at timestamptz, decided_by varchar(191) references public.users(id), academic_year varchar(64), term varchar(32),
 cancellation_reason text, updated_at timestamptz, check(ends_on>=starts_on)
);
create table if not exists public.staff_leave_balances (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), staff_id varchar(191) not null references public.staff_profiles(id), leave_type varchar(64) not null, entitled_days numeric(8,2) not null, used_days numeric(8,2) not null default 0, year varchar(16) not null, unique(staff_id,leave_type,year)
);
create table if not exists public.staff_assignments (
 id varchar(191) primary key, staff_id varchar(191) not null references public.staff_profiles(id), subject_id varchar(191) references public.subjects(id), class_id varchar(191) references public.classes(id), stream_id varchar(191) references public.streams(id), department_id varchar(191) references public.departments(id), timetable_id varchar(191), academic_year_id varchar(191) references public.academic_years(id), term_id varchar(191) references public.terms(id), created_at timestamptz not null default now()
);
create table if not exists public.staff_documents (
 id varchar(191) primary key, staff_id varchar(191) not null references public.staff_profiles(id), document_type varchar(64) not null, storage_key text not null, uploaded_by varchar(191) references public.users(id), created_at timestamptz not null default now()
);
alter table public.staff_attendance add constraint staff_attendance_leave_fk foreign key(leave_request_id) references public.staff_leave(id);
create table if not exists public.attendance_audit_history (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), attendance_record_id varchar(64) not null, person_id varchar(64) not null,
 person_type varchar(16) not null, previous_status varchar(32), new_status varchar(32) not null, previous_reason text, new_reason text,
 changed_by varchar(191) not null, changed_at timestamptz not null default now(), source varchar(32) not null, action varchar(16) not null
);
create table if not exists public.staff_attendance_reconciliation_audit (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), leave_request_id varchar(64) not null references public.staff_leave(id),
 staff_attendance_id varchar(64) references public.staff_attendance(id), attendance_date date not null, action text not null,
 previous_status varchar(32), next_status varchar(32), details text not null, actor_id varchar(191) references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.academic_calendar_events (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 title varchar(255) not null, category varchar(64) not null, custom_category varchar(128), description text, start_date date not null, end_date date,
 start_time time, end_time time, all_day boolean not null default true, venue text, audience_json jsonb not null, class_scope_json jsonb not null default '[]',
 status varchar(16) not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','CANCELLED')), created_by varchar(191) not null references public.users(id),
 updated_by varchar(191) not null references public.users(id), published_by varchar(191) references public.users(id), published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_date is null or end_date>=start_date)
);
create table if not exists public.academic_calendar_term_configs (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), academic_year varchar(64) not null, term varchar(32) not null,
 reopening_date date, teaching_start_date date, mid_term_break_start date, mid_term_break_end date, examination_start_date date, examination_end_date date,
 closing_date date, teaching_days integer, created_by varchar(191) not null references public.users(id), updated_by varchar(191) not null references public.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,academic_year,term)
);
create table if not exists public.examinations (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(255) not null, exam_type varchar(64) not null,
 academic_year_id varchar(191) references public.academic_years(id), term_id varchar(191) references public.terms(id), created_at timestamptz not null default now()
);
create table if not exists public.examination_subjects (
 id varchar(191) primary key, examination_id varchar(191) not null references public.examinations(id), subject_id varchar(191) not null references public.subjects(id), max_marks numeric(8,2) not null default 100, weight numeric(8,2) not null default 100
);
create table if not exists public.examination_candidates (
 id varchar(191) primary key, examination_id varchar(191) not null references public.examinations(id), student_id varchar(191) not null references public.student_profiles(id), unique(examination_id,student_id)
);
create table if not exists public.examination_timetable (
 id varchar(191) primary key, examination_id varchar(191) not null references public.examinations(id), subject_id varchar(191) references public.subjects(id), room varchar(128), starts_at timestamptz not null, ends_at timestamptz not null, invigilator_id varchar(191) references public.staff(id)
);
create table if not exists public.grading_systems (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null, boundaries_json jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.examination_marks (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), examination_id varchar(191) not null references public.examinations(id), student_id varchar(191) not null references public.student_profiles(id), subject_id varchar(191) not null references public.subjects(id), raw_marks numeric(8,2) not null, weight numeric(8,2) not null, weighted_marks numeric(8,2) not null, grade varchar(32) not null, comment text, state varchar(32) not null default 'DRAFT', version integer not null default 1, entered_by varchar(191) not null references public.users(id), updated_at timestamptz not null default now(), unique(examination_id,student_id,subject_id)
);
create table if not exists public.canonical_academic_scores (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), class_id varchar(191) not null references public.classes(id),
 academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) not null references public.terms(id), subject_id varchar(191) not null references public.subjects(id),
 class_score numeric(6,2) not null, exam_score numeric(6,2) not null, total_score numeric(6,2) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,student_id,class_id,academic_year_id,term_id,subject_id)
);
create table if not exists public.promotion_decisions (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), academic_year_id varchar(191) not null references public.academic_years(id), term_id varchar(191) references public.terms(id), class_id varchar(191) references public.classes(id), to_class_id varchar(191) references public.classes(id), next_academic_year_id varchar(191) references public.academic_years(id), next_term_id varchar(191) references public.terms(id), source_enrollment_id varchar(191) references public.student_enrollments(id), idempotency_key varchar(64), completion_year varchar(64), decision varchar(32) not null, comment text, decided_by varchar(191) not null references public.users(id), decided_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists public.subject_registers (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), class_id varchar(191) not null references public.classes(id), subject_id varchar(191) not null references public.subjects(id), academic_year_id varchar(191) references public.academic_years(id), term_id varchar(191) references public.terms(id), status varchar(32) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.subject_register_teachers (
 id varchar(191) primary key, register_id varchar(191) not null references public.subject_registers(id), staff_id varchar(191) not null references public.staff(id), created_at timestamptz not null default now(), unique(register_id,staff_id)
);
create table if not exists public.subject_register_history (
 id varchar(191) primary key, register_id varchar(191) not null references public.subject_registers(id), action varchar(64) not null, actor_id varchar(191) references public.users(id), details jsonb, created_at timestamptz not null default now()
);

create table if not exists public.fee_types (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), code varchar(64) not null, name varchar(128) not null,
 category varchar(64) not null, description text, is_active boolean not null default true, is_system boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,code)
);
create table if not exists public.fee_structures (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), fee_type varchar(128), fee_type_id varchar(64) references public.fee_types(id),
 category_name varchar(128), custom_fee_type_name text, amount numeric(15,2) not null, academic_year_id varchar(191), academic_year varchar(64),
 term_id varchar(191), term varchar(64), class_id varchar(191) references public.classes(id), student_id varchar(191) references public.students(id),
 boarding_type varchar(64), optional_service varchar(128), status varchar(32) not null default 'DRAFT', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.student_fee_charges (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), account_id varchar(64) not null, permanent_student_id varchar(100) not null, fee_structure_id varchar(64) references public.fee_structures(id), fee_type varchar(100) not null, description varchar(255), amount numeric(15,2) not null default 0, due_date date, charge_status varchar(16) not null default 'ACTIVE', created_by varchar(64) references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.student_fee_discounts (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), account_id varchar(64) not null, permanent_student_id varchar(100) not null, charge_id varchar(64) references public.student_fee_charges(id), discount_type varchar(100) not null, description varchar(255), amount numeric(15,2) not null default 0, approved_by varchar(64) references public.users(id), created_by varchar(64) references public.users(id), status varchar(16) not null default 'ACTIVE', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.fee_obligations (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), fee_structure_id varchar(64) not null references public.fee_structures(id),
 academic_year_id varchar(64), term_id varchar(64), applicability_type varchar(32) not null, class_id varchar(64), student_id varchar(64) not null references public.students(id),
 amount_minor bigint not null, due_date date, status varchar(32) not null, published_by varchar(64) not null references public.users(id), published_at timestamptz not null,
 idempotency_key varchar(255) not null, custom_fee_type_name varchar(128), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists public.fee_collection_records (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), collection_type varchar(32) not null, class_id varchar(64),
 collection_date date not null, expected_amount_minor bigint, amount_received_minor bigint not null, recorded_by varchar(64) not null references public.users(id), notes text,
 academic_year_id varchar(64), term_id varchar(64), collection_period varchar(32), fee_type_id varchar(64) references public.fee_types(id), custom_fee_type_name varchar(128),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.fee_collection_corrections (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), collection_id varchar(64) not null references public.fee_collection_records(id),
 actor_user_id varchar(64) not null references public.users(id), reason text not null, before_amount_received_minor bigint not null, after_amount_received_minor bigint not null,
 created_at timestamptz not null default now()
);
create table if not exists public.student_fee_accounts (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(64) not null references public.students(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64), term_id varchar(64), class_id varchar(64) not null references public.classes(id),
 account_status varchar(32) not null default 'ACTIVE', created_by varchar(64) references public.users(id), created_at timestamptz not null default now(),
 updated_by varchar(64) references public.users(id), updated_at timestamptz not null default now(), unique(school_id,permanent_student_id,academic_year_id,term_id)
);
create table if not exists public.student_fee_ledger (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), account_id varchar(64) not null references public.student_fee_accounts(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64) not null, term_id varchar(64) not null, class_id varchar(64) not null,
 transaction_type varchar(32) not null, fee_type varchar(128), amount numeric(15,2) not null, reference_type varchar(64), reference_id varchar(128), description text,
 transaction_date date not null, source varchar(32) not null default 'LEGACY_UNSPECIFIED', recorded_by varchar(64) not null references public.users(id),
 recorded_at timestamptz not null default now(), reversed_by varchar(64) references public.users(id), reversed_at timestamptz, reversal_reason text, status varchar(32) not null default 'ACTIVE'
);
create table if not exists public.fee_invoices (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), account_id varchar(64) not null references public.student_fee_accounts(id),
 permanent_student_id varchar(128) not null, academic_year_id varchar(64), term_id varchar(64), class_id varchar(64), invoice_number varchar(128) not null,
 invoice_date date not null, due_date date, subtotal numeric(15,2) not null default 0, discount_amount numeric(15,2) not null default 0,
 total_amount numeric(15,2) not null default 0, status varchar(32) not null default 'DRAFT', issued_by varchar(64) references public.users(id), issued_at timestamptz,
 created_by varchar(64) not null references public.users(id), created_at timestamptz not null default now(), updated_by varchar(64) references public.users(id), updated_at timestamptz,
 unique(school_id,invoice_number)
);
create table if not exists public.fee_invoice_items (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), invoice_id varchar(64) not null references public.fee_invoices(id),
 fee_structure_id varchar(64) references public.fee_structures(id), fee_type varchar(128) not null, description text, amount numeric(15,2) not null, created_at timestamptz not null default now()
);
create table if not exists public.student_fee_payments (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), account_id varchar(64) not null references public.student_fee_accounts(id),
 invoice_id varchar(64) references public.fee_invoices(id), permanent_student_id varchar(128) not null, academic_year_id varchar(64) not null,
 term_id varchar(64) not null, class_id varchar(64) not null, payment_reference varchar(128) not null, amount numeric(15,2) not null,
 payment_method varchar(32) not null, provider_reference varchar(255), payment_date timestamptz not null, status varchar(32) not null default 'COMPLETED',
 received_by varchar(64) not null references public.users(id), created_at timestamptz not null default now(), reversed_by varchar(64) references public.users(id), reversed_at timestamptz, reversal_reason text,
 unique(school_id,payment_reference)
);
create table if not exists public.student_fee_receipts (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), payment_id varchar(64) not null unique references public.student_fee_payments(id),
 account_id varchar(64) not null references public.student_fee_accounts(id), permanent_student_id varchar(128) not null, receipt_number varchar(128) not null,
 amount_paid numeric(15,2) not null, previous_balance numeric(15,2) not null, new_balance numeric(15,2) not null, issued_by varchar(64) not null references public.users(id),
 issued_at timestamptz not null, status varchar(32) not null default 'VALID', voided_by varchar(64) references public.users(id), voided_at timestamptz, void_reason text,
 unique(school_id,receipt_number)
);
create table if not exists public.financial_audit_history (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), entity_type varchar(64) not null, entity_id varchar(64) not null,
 permanent_student_id varchar(128), action varchar(32) not null, previous_values jsonb, new_values jsonb, reason text, changed_by varchar(64) not null references public.users(id),
 changed_at timestamptz not null default now(), source varchar(32) not null default 'LEGACY_UNSPECIFIED', transaction_reference varchar(128)
);
create table if not exists public.financial_audit_log (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), user_id varchar(64) references public.users(id), action varchar(100) not null,
 entity_type varchar(100) not null, entity_id varchar(64), permanent_student_id varchar(100), description text, old_values jsonb, new_values jsonb, ip_address inet, created_at timestamptz not null default now()
);
create table if not exists public.budgets (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), academic_year varchar(64) not null, term varchar(64) not null,
 budget_name varchar(255) not null, description text, status varchar(16) not null default 'DRAFT', total_budget_amount numeric(15,2) not null default 0,
 created_by varchar(64) not null references public.users(id), created_at timestamptz not null default now(), updated_by varchar(64) not null references public.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.budget_items (
 id varchar(64) primary key, budget_id varchar(64) not null references public.budgets(id), school_id varchar(64) not null references public.schools(id),
 category varchar(128) not null, custom_category varchar(255), description text, allocated_amount numeric(15,2) not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.general_income (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), transaction_date date not null, academic_year varchar(64) not null,
 term varchar(64) not null, income_category varchar(96) not null, custom_category varchar(160), description varchar(500) not null, reference_number varchar(160) not null,
 amount numeric(12,2) not null check(amount>0), payment_method varchar(32) not null, payer_or_source varchar(240) not null, notes text,
 status varchar(16) not null default 'POSTED' check(status in ('POSTED','VOIDED')), created_by varchar(191) not null references public.users(id),
 created_at timestamptz not null default now(), updated_by varchar(191) not null references public.users(id), updated_at timestamptz not null default now(),
 voided_by varchar(191) references public.users(id), voided_at timestamptz, void_reason text, unique(school_id,reference_number,status)
);
create table if not exists public.general_expenses (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), transaction_date date not null, academic_year varchar(64) not null,
 term varchar(64) not null, expense_category varchar(96) not null, custom_category varchar(160), description varchar(500) not null, reference_number varchar(160) not null,
 amount numeric(12,2) not null check(amount>0), payment_method varchar(32) not null, payee varchar(240) not null, notes text,
 status varchar(16) not null default 'POSTED' check(status in ('POSTED','VOIDED')), budget_id varchar(64) references public.budgets(id), budget_item_id varchar(64) references public.budget_items(id),
 created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now(), updated_by varchar(191) not null references public.users(id), updated_at timestamptz not null default now(),
 voided_by varchar(191) references public.users(id), voided_at timestamptz, void_reason text, unique(school_id,reference_number,status)
);
create table if not exists public.auth_sessions (
 id varchar(191) primary key, user_id varchar(191) not null references public.users(id), school_id varchar(64) not null references public.schools(id),
 token_hash char(64) not null unique, created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz
);
create table if not exists public.announcement_records (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), title text not null, message text not null,
 priority varchar(32) not null default 'NORMAL', recipient_category varchar(32) not null, status varchar(32) not null default 'DRAFT',
 scheduled_for timestamptz, published_at timestamptz, sender_id varchar(64) not null references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.communication_providers (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), provider_key varchar(128) not null,
 is_active boolean not null default false, is_default boolean not null default false, endpoint text, credentials_secret_ref text, sender_id varchar(128),
 priority integer not null default 100, fallback_provider_id varchar(191) references public.communication_providers(id), webhook_url text,
 created_by varchar(191) references public.users(id), created_at timestamptz not null, updated_at timestamptz not null, unique(school_id,provider_key)
);
create table if not exists public.communication_templates (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), template_key varchar(128) not null,
 channel varchar(32) not null, body_template text not null, active boolean not null default true,
 created_by varchar(191) references public.users(id), created_at timestamptz not null, updated_at timestamptz not null, unique(school_id,template_key)
);
create table if not exists public.communication_trigger_settings (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), trigger_key varchar(128) not null,
 channel varchar(32) not null, enabled boolean not null default false, template_id varchar(191) references public.communication_templates(id),
 provider_id varchar(191) references public.communication_providers(id), updated_by varchar(191) references public.users(id), updated_at timestamptz not null,
 unique(school_id,trigger_key,channel)
);
create table if not exists public.communication_outbox (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), channel varchar(32) not null,
 recipient text not null, payload_json text not null, idempotency_key varchar(191) not null, status varchar(32) not null,
 attempts integer not null default 0, next_attempt_at timestamptz, provider_id varchar(191), provider_message_id varchar(191),
 last_error text, created_by varchar(191) references public.users(id), created_at timestamptz not null, updated_at timestamptz not null,
 unique(school_id,idempotency_key)
);
create table if not exists public.communication_messages (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), outbox_id varchar(191) not null references public.communication_outbox(id),
 channel varchar(32) not null, provider_id varchar(191), provider_message_id varchar(191), status varchar(32) not null,
 sent_at timestamptz, delivered_at timestamptz, created_at timestamptz not null
);
create table if not exists public.communication_delivery_logs (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), message_id varchar(191) not null references public.communication_messages(id),
 provider_id varchar(191), status varchar(32) not null, response_code varchar(64), safe_error text, occurred_at timestamptz not null
);
create table if not exists public.announcement_recipients (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), announcement_id varchar(64) not null references public.announcement_records(id),
 recipient_id varchar(64) not null references public.users(id), recipient_type varchar(32) not null, assigned_at timestamptz not null default now(), unique(school_id,announcement_id,recipient_id)
);
create table if not exists public.announcement_reads (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), announcement_id varchar(64) not null references public.announcement_records(id),
 recipient_id varchar(64) not null references public.users(id), read_at timestamptz not null, unique(school_id,announcement_id,recipient_id)
);
create table if not exists public.sms_campaigns (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), message_body text not null, recipient_mode varchar(32) not null,
 selector_json jsonb not null, status varchar(32) not null, recipient_count integer not null default 0, created_by varchar(64) not null references public.users(id),
 idempotency_key varchar(128), provider_key varchar(32), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), sent_at timestamptz,
 unique(school_id,idempotency_key)
);
create table if not exists public.sms_campaign_recipients (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), campaign_id varchar(64) not null references public.sms_campaigns(id),
 parent_user_id varchar(64) not null references public.users(id), student_id varchar(64) references public.students(id), normalized_phone varchar(20) not null,
 recipient_name varchar(255) not null, status varchar(32) not null, provider_message_id varchar(128), last_error varchar(255),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), delivered_at timestamptz,
 unique(school_id,campaign_id,normalized_phone)
);
create table if not exists public.announcements (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), title varchar(255) not null, body text not null, audience varchar(64) not null,
 class_id varchar(191) references public.classes(id), student_ids_json jsonb, emergency boolean not null default false, sender_id varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.notifications (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), type varchar(64) not null, recipient_id varchar(191) not null references public.users(id),
 student_id varchar(191) references public.students(id), title varchar(255) not null, body text not null, status varchar(32) not null, created_at timestamptz not null default now(), created_by varchar(191) references public.users(id)
);
create table if not exists public.messages (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), sender_id varchar(191) not null references public.users(id), recipient_id varchar(191) not null references public.users(id),
 student_id varchar(191) not null references public.students(id), body text not null, status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists public.notification_preferences (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), user_id varchar(191) not null references public.users(id), settings_json jsonb not null, updated_at timestamptz not null default now(), unique(school_id,user_id)
);
create table if not exists public.communication_delivery_log (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), channel varchar(32) not null, provider varchar(128), message_id varchar(191), status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists public.system_settings (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), setting_key varchar(128) not null, setting_value text, value_type varchar(32) not null default 'string', is_sensitive boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,setting_key)
);
create table if not exists public.audit_logs (
 id varchar(191) primary key, school_id varchar(64) references public.schools(id), user_id varchar(191) references public.users(id), role_id varchar(191) references public.roles(id),
 action varchar(128) not null, entity varchar(128) not null, entity_id varchar(191), previous_value jsonb, new_value jsonb, ip_address inet, session_id varchar(191), device_metadata jsonb, occurred_at timestamptz not null default now()
);
create table if not exists public.ai_audit_logs (
 id varchar(191) primary key, request_id varchar(191) not null, correlation_id varchar(191) not null, occurred_at timestamptz not null,
 event_type varchar(128) not null, severity varchar(32) not null, school_id varchar(64) references public.schools(id), user_id varchar(191) references public.users(id),
 role_key varchar(64), capability_id varchar(128), tool_name varchar(128), operation_type varchar(64), authorization_result varchar(32), data_scope_json jsonb,
 production_data_only boolean, data_quality_status varchar(32), request_status varchar(32) not null, duration_ms integer, provider varchar(64), model varchar(128),
 input_tokens integer, output_tokens integer, total_tokens integer, estimated_cost numeric(12,6), error_code varchar(128), action_requested boolean not null default false,
 action_executed boolean not null default false, approval_user_id varchar(191) references public.users(id), rejection_user_id varchar(191) references public.users(id),
 action_decision_at timestamptz, target_record_id varchar(191), rollback_reference_id varchar(191), environment varchar(32) not null, metadata_json jsonb
);
create table if not exists public.ai_human_controlled_actions (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), creator_user_id varchar(191) not null references public.users(id),
 action_type varchar(128) not null, proposed_change text not null, sanitized_payload text not null, required_prepare_permission varchar(128) not null,
 required_approval_permission varchar(128) not null, status varchar(32) not null check(status in ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED')),
 submitted_at timestamptz, decided_at timestamptz, decided_by varchar(191) references public.users(id), executed_at timestamptz,
 version integer not null default 1 check(version>0), idempotency_key varchar(191) not null, integrity char(64) not null check(length(integrity)=64),
 failure_code varchar(128), failure_reason text, execution_result text, created_at timestamptz not null default now(), unique(school_id,idempotency_key)
);
create table if not exists public.invoices (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), invoice_number varchar(128) not null unique,
 student_id varchar(191) not null references public.student_profiles(id), parent_user_id varchar(191) references public.users(id), line_items_json jsonb not null,
 discount numeric(15,2) not null default 0, total numeric(15,2) not null, paid numeric(15,2) not null default 0, balance numeric(15,2) not null,
 status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists public.payments (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), receipt_number varchar(128) not null unique,
 invoice_id varchar(191) not null references public.invoices(id), student_id varchar(191) not null references public.student_profiles(id), amount numeric(15,2) not null,
 payment_method varchar(32) not null, status varchar(32) not null default 'VALID', entered_by varchar(191) not null references public.users(id), created_at timestamptz not null default now(),
 changed_by varchar(191) references public.users(id), changed_at timestamptz, change_reason text
);
create table if not exists public.financial_adjustments (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.student_profiles(id),
 adjustment_type varchar(64) not null, amount numeric(15,2) not null, reason text, authorized_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.fee_payments (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), payment_reference varchar(100) not null, account_id varchar(64) not null references public.student_fee_accounts(id),
 invoice_id varchar(64), permanent_student_id varchar(100) not null, student_name varchar(255) not null, class_name varchar(100) not null, academic_year varchar(20) not null,
 term varchar(30) not null, fee_type varchar(100), amount numeric(15,2) not null, payment_method varchar(32) not null default 'CASH', transaction_reference varchar(150),
 payment_date timestamptz not null default now(), received_by varchar(64) references public.users(id), notes text, status varchar(16) not null default 'COMPLETED',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,payment_reference)
);
create table if not exists public.fee_receipts (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), receipt_number varchar(100) not null, payment_id varchar(64) not null unique references public.fee_payments(id),
 invoice_id varchar(64), account_id varchar(64) not null references public.student_fee_accounts(id), permanent_student_id varchar(100) not null, student_name varchar(255) not null,
 class_name varchar(100) not null, academic_year varchar(20) not null, term varchar(30) not null, amount_paid numeric(15,2) not null, previous_balance numeric(15,2) not null default 0,
 new_balance numeric(15,2) not null default 0, payment_method varchar(32), received_by varchar(64) references public.users(id), issued_at timestamptz not null default now(),
 status varchar(8) not null default 'VALID', voided_at timestamptz, voided_by varchar(64) references public.users(id), void_reason varchar(255), created_at timestamptz not null default now(), unique(school_id,receipt_number)
);
create table if not exists public.payment_gateway_configs (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), provider varchar(64) not null, public_config_json jsonb not null, secret_key_setting varchar(128), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.fee_structures_v2 (
 id varchar(64) primary key, school_id varchar(64) not null references public.schools(id), fee_type_id varchar(64) references public.fee_types(id), class_id varchar(64) references public.classes(id),
 academic_year_id varchar(64), term_id varchar(64), amount numeric(15,2) not null, status varchar(32) not null default 'DRAFT', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.calendar_events (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), event_type varchar(64) not null, title varchar(255) not null,
 starts_at timestamptz not null, ends_at timestamptz, audience varchar(64) not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.assignment_files (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), assignment_id varchar(191) not null, storage_key text not null,
 uploaded_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.assignments (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), class_id varchar(191) not null references public.classes(id), subject_id varchar(191) references public.subjects(id),
 title varchar(255) not null, description text, due_at timestamptz, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sample_data_fixtures (
 fixture_id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), sample_student_id varchar(191) not null, academic_year_id varchar(191), term_id varchar(191), class_id varchar(191),
 fixture_type varchar(64) not null, fixture_payload jsonb not null, fixture_version varchar(32) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.class_label_aliases (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), class_id varchar(191) not null references public.classes(id), alias varchar(128) not null, unique(school_id,alias)
);
create table if not exists public.student_transcripts (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.student_profiles(id),
 transcript_reference varchar(32) not null unique, current_version integer not null default 1, status varchar(32) not null default 'DRAFT',
 generated_by varchar(191) not null references public.users(id), generated_at timestamptz not null, published_by varchar(191) references public.users(id), published_at timestamptz,
 revoked_by varchar(191) references public.users(id), revoked_at timestamptz, revocation_reason text, created_at timestamptz not null, updated_at timestamptz not null
);
create table if not exists public.student_transcript_versions (
 id varchar(191) primary key, transcript_id varchar(191) not null references public.student_transcripts(id), version_number integer not null, academic_snapshot text not null,
 document_checksum varchar(128) not null, verification_token_hash varchar(128) not null unique, generated_by varchar(191) not null references public.users(id), generated_at timestamptz not null,
 published_by varchar(191) references public.users(id), published_at timestamptz, regeneration_reason text, status varchar(32) not null default 'DRAFT', superseded_by_version integer,
 revoked_by varchar(191) references public.users(id), revoked_at timestamptz, revocation_reason text, unique(transcript_id,version_number)
);
create table if not exists public.result_signatures (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), signatory_role varchar(64) not null,
 storage_key text, mime_type varchar(128) not null, document_size integer not null default 0, active boolean not null default true,
 uploaded_by varchar(191) not null references public.users(id), uploaded_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_active_result_signature on public.result_signatures(school_id,signatory_role) where active;
create table if not exists public.official_documents (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), document_number varchar(128) not null, document_type varchar(64) not null,
 recipient_id varchar(191), student_id varchar(191) references public.students(id), document_date date not null, title varchar(255) not null, body text, signatures_json jsonb,
 stamp text, verification_code varchar(128) not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now(),
 unique(school_id,document_number), unique(school_id,verification_code)
);
create table if not exists public.report_exports (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), report_type varchar(64) not null, filters_json jsonb, format varchar(16) not null,
 generated_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.managed_documents (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), document_number varchar(128) not null, category varchar(64) not null,
 title varchar(255) not null, entity_id varchar(191), storage_key text not null, checksum char(64) not null, version integer not null,
 expires_at timestamptz, access_roles_json jsonb, verification_code varchar(128) not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now(), unique(school_id,document_number), unique(school_id,verification_code)
);
create table if not exists public.document_versions (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), document_id varchar(191) not null references public.managed_documents(id),
 version integer not null, checksum char(64) not null, expires_at timestamptz, updated_by varchar(191) not null references public.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.compliance_records (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), compliance_type varchar(64) not null, licence_number varchar(128), licence_type varchar(64),
 issue_date date, expiry_date date, status varchar(32) not null, recommendations_json jsonb, corrective_actions_json jsonb, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.compliance_inspections (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), compliance_id varchar(191) not null references public.compliance_records(id), inspected_at timestamptz not null,
 rating varchar(32), recommendations_json jsonb, corrective_actions_json jsonb, inspector varchar(255), created_at timestamptz not null default now()
);
create table if not exists public.privacy_consents (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), subject_id varchar(191) not null, purpose varchar(255) not null, granted boolean not null,
 recorded_by varchar(191) not null references public.users(id), recorded_at timestamptz not null default now()
);
create table if not exists public.privacy_requests (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), request_type varchar(64) not null, subject_id varchar(191) not null, details text,
 status varchar(32) not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.retention_policies (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), data_category varchar(128) not null, retention_period varchar(64) not null,
 action_after_expiry varchar(64) not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.data_protection_officers (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), user_id varchar(191) not null references public.users(id), designation varchar(128) not null,
 appointed_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.data_breaches (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), discovered_at timestamptz not null, description text not null,
 severity varchar(32) not null, containment text, status varchar(32) not null, reported_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.sporting_sports (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null, created_at timestamptz not null default now(), unique(school_id,name)
);
create table if not exists public.sporting_teams (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), sport_id varchar(191) not null references public.sporting_sports(id), name varchar(128) not null, created_at timestamptz not null default now()
);
create table if not exists public.sporting_activities (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), title varchar(255) not null, activity_type varchar(64) not null, starts_at timestamptz, ends_at timestamptz, status varchar(32) not null, created_by varchar(191) references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.sporting_participants (
 id varchar(191) primary key, activity_id varchar(191) not null references public.sporting_activities(id), student_id varchar(191) references public.students(id), staff_id varchar(191) references public.staff(id), participant_type varchar(32) not null, unique(activity_id,student_id,staff_id)
);
create table if not exists public.sporting_fixtures (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), sport_id varchar(191) not null references public.sporting_sports(id), home_team_id varchar(191) references public.sporting_teams(id), away_team_id varchar(191) references public.sporting_teams(id), starts_at timestamptz, venue text, status varchar(32) not null
);
create table if not exists public.sporting_results (
 id varchar(191) primary key, fixture_id varchar(191) not null references public.sporting_fixtures(id), home_score integer, away_score integer, notes text, recorded_by varchar(191) references public.users(id), recorded_at timestamptz not null default now()
);
create table if not exists public.shep_activities (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), title varchar(255) not null, activity_type varchar(64) not null, status varchar(32) not null, payload jsonb not null default '{}', created_by varchar(191) references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.shep_activity_attachments (
 id varchar(191) primary key, activity_id varchar(191) not null references public.shep_activities(id), storage_key text not null, uploaded_by varchar(191) references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.shep_activity_participants (
 id varchar(191) primary key, activity_id varchar(191) not null references public.shep_activities(id), student_id varchar(191) references public.students(id), staff_id varchar(191) references public.staff(id), unique(activity_id,student_id,staff_id)
);
create table if not exists public.shep_referrals (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), activity_id varchar(191) references public.shep_activities(id), reason text not null, status varchar(32) not null, referred_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.shep_audit_history (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), activity_id varchar(191) references public.shep_activities(id), actor_id varchar(191) references public.users(id), action varchar(64) not null, details jsonb, created_at timestamptz not null default now()
);
create table if not exists public.library_books (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), isbn varchar(32), title varchar(255) not null, authors_json jsonb,
 category varchar(128), shelf varchar(64), copies integer not null, available_copies integer not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.library_loans (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), book_id varchar(191) not null references public.library_books(id),
 borrower_id varchar(191) not null, borrower_type varchar(32) not null, due_at timestamptz, status varchar(32) not null, borrowed_by varchar(191) not null references public.users(id), borrowed_at timestamptz not null, returned_at timestamptz
);
create table if not exists public.transport_vehicles (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), registration varchar(64) not null, insurance_expires_at date, roadworthiness_expires_at date, driver_id varchar(191), attendant_ids_json jsonb, emergency_contact varchar(64), status varchar(32) not null, created_at timestamptz not null default now(), unique(school_id,registration)
);
create table if not exists public.transport_routes (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(128) not null, stops_json jsonb, vehicle_id varchar(191) references public.transport_vehicles(id), student_ids_json jsonb, created_at timestamptz not null default now()
);
create table if not exists public.hostel_spaces (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), type varchar(64) not null, name varchar(128) not null, capacity integer not null, warden_id varchar(191), matron_id varchar(191), created_at timestamptz not null default now()
);
create table if not exists public.hostel_allocations (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), space_id varchar(191) not null references public.hostel_spaces(id), bed varchar(64), active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.health_records (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), data_json jsonb not null, recorded_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.health_visits (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), data_json jsonb not null, recorded_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.welfare_incidents (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), kind varchar(64) not null, data_json jsonb not null, recorded_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.counselling_records (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), data_json jsonb not null, recorded_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.inventory_items (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(255) not null, item_type varchar(64) not null, unit varchar(32) not null, supplier varchar(255), reorder_level integer not null, quantity integer not null, created_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.inventory_movements (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), inventory_id varchar(191) not null references public.inventory_items(id), movement_type varchar(32) not null, quantity integer not null, delta integer not null, destination text, performed_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.assets (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), asset_id varchar(128) not null, asset_type varchar(64) not null, description text not null, serial_number varchar(128), location varchar(255), department varchar(128), custodian varchar(255), purchase_date date, purchase_value numeric(15,2), warranty text, condition varchar(32) not null, qr_code varchar(255) not null, status varchar(32) not null, created_at timestamptz not null default now(), unique(school_id,asset_id)
);
create table if not exists public.procurement_requests (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), request_number varchar(128) not null, item varchar(255) not null, quantity integer not null, supplier varchar(255), quotation text, state varchar(32) not null, requested_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.school_property (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), name varchar(255) not null, property_type varchar(64) not null, location text, responsible_officer varchar(255), status varchar(32) not null, created_at timestamptz not null default now()
);
create table if not exists public.external_exam_records (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), student_id varchar(191) not null references public.students(id), exam_name varchar(128) not null, candidate_number varchar(128), subjects_json jsonb, preparation_notes text, created_at timestamptz not null default now()
);
create table if not exists public.property_maintenance (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), property_id varchar(191) not null references public.school_property(id), title varchar(255) not null, details text, responsible_officer varchar(255), status varchar(32) not null, requested_by varchar(191) not null references public.users(id), created_at timestamptz not null default now()
);
create table if not exists public.sidebar_categories (
 id varchar(191) primary key, category_key varchar(128) not null unique, category_name varchar(128) not null, display_order integer not null, enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sidebar_modules (
 id varchar(191) primary key, module_key varchar(128) not null unique, module_name varchar(128) not null, category_id varchar(191) not null references public.sidebar_categories(id), route text not null, icon varchar(64) not null, display_order integer not null default 0, required_permission varchar(128) references public.permissions(permission_key), enabled boolean not null default true, parent_module_id varchar(191) references public.sidebar_modules(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.attendance_notification_settings (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), parent_user_id varchar(191) not null references public.users(id), absence_enabled boolean not null default true, lateness_enabled boolean not null default true, updated_at timestamptz not null default now(), unique(school_id,parent_user_id)
);
create table if not exists public.attendance_sync_conflicts (
 id varchar(191) primary key, school_id varchar(64) not null references public.schools(id), attendance_id varchar(191) references public.student_attendance(id), client_version integer, server_version integer, client_payload jsonb not null, detected_at timestamptz not null default now()
);
create table if not exists public.schema_baselines (
 id varchar(64) primary key, canonical_database varchar(128) not null, baseline_at timestamptz not null, repository_commit char(40) not null,
 schema_fingerprint char(64) not null, reconciliation_migration varchar(255) not null, workflow_provenance varchar(255) not null,
 baseline_type varchar(32) not null default 'HISTORICAL_BASELINE', historical_migrations_executed boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.schema_migrations (
 version integer primary key, name varchar(255) not null, checksum char(64) not null, applied_at timestamptz not null
);
create table if not exists public.schema_migration_lock (
 lock_id smallint primary key check(lock_id=1), locked boolean not null default false, acquired_at timestamptz
);

alter table public.student_fee_charges add constraint fk_student_fee_charges_account foreign key (account_id) references public.student_fee_accounts(id);
alter table public.student_fee_discounts add constraint fk_student_fee_discounts_account foreign key (account_id) references public.student_fee_accounts(id);

-- Migration 078 permissions: grant only to the existing leadership role rows.
-- No users or roles are fabricated by this bootstrap.
insert into public.permissions (id,permission_key,permission_name)
values ('permission-admissions-write','admissions.write','Create and update admission applications')
on conflict (permission_key) do nothing;
insert into public.role_permissions (id,role_id,permission_id,created_at)
select 'roleperm-admissions-write-' || r.id,r.id,p.id,now()
from public.roles r cross join public.permissions p
where r.role_key in ('HEADTEACHER','ASSISTANT_HEADTEACHER') and p.permission_key='admissions.write'
on conflict (role_id,permission_id) do nothing;

create index if not exists idx_communication_outbox_status on public.communication_outbox(school_id,status,next_attempt_at);
create index if not exists idx_communication_messages_provider on public.communication_messages(school_id,provider_message_id);
create index if not exists idx_communication_delivery_logs_message on public.communication_delivery_logs(message_id,occurred_at);
create index if not exists idx_terms_year on public.terms(academic_year_id);
create index if not exists idx_classes_school_sort on public.classes(school_id,sort_order,id);
create index if not exists idx_students_school on public.students(school_id);
create index if not exists idx_students_school_name on public.students(school_id,full_name);
create index if not exists idx_students_school_parent_phone on public.students(school_id,parent_phone);
create index if not exists idx_student_profiles_school_class on public.student_profiles(school_id,class_id);
create index if not exists idx_student_profiles_master_school on public.student_profiles(school_id,student_master_id);
create index if not exists idx_student_enrollments_durable_scope on public.student_enrollments(school_id,academic_year_id,class_id,is_current,enrollment_status);
create index if not exists idx_student_attendance_scope on public.student_attendance(school_id,academic_year,term,class_id,attendance_date);
create index if not exists idx_staff_attendance_scope on public.staff_attendance(school_id,academic_year,term,attendance_date,staff_id);
create index if not exists idx_attendance_audit_scope on public.attendance_audit_history(school_id,attendance_record_id,changed_at);
create index if not exists idx_fee_obligations_student on public.fee_obligations(school_id,student_id);
create index if not exists idx_fee_collections_period_scope on public.fee_collection_records(school_id,collection_type,academic_year_id,collection_period,collection_date);
create index if not exists idx_student_fee_account_student on public.student_fee_accounts(school_id,permanent_student_id);
create index if not exists idx_fee_ledger_account on public.student_fee_ledger(school_id,account_id,transaction_date);
create index if not exists idx_fee_invoice_student on public.fee_invoices(school_id,permanent_student_id,academic_year_id,term_id);
create index if not exists idx_fee_invoice_items_invoice on public.fee_invoice_items(school_id,invoice_id);
create index if not exists idx_student_fee_payment_account on public.student_fee_payments(school_id,account_id,payment_date);
create index if not exists idx_student_fee_receipt_student on public.student_fee_receipts(school_id,permanent_student_id,issued_at);
create index if not exists idx_financial_audit_entity on public.financial_audit_history(school_id,entity_type,entity_id,changed_at);
create index if not exists idx_general_income_school_date on public.general_income(school_id,transaction_date,id);
create index if not exists idx_general_expenses_school_date on public.general_expenses(school_id,transaction_date,id);
create index if not exists idx_budgets_school_period on public.budgets(school_id,academic_year,term);
create index if not exists idx_auth_sessions_expiry on public.auth_sessions(expires_at,revoked_at);
create index if not exists idx_announcement_recipient on public.announcement_recipients(school_id,recipient_id,announcement_id);
create index if not exists idx_sms_campaign_history on public.sms_campaigns(school_id,created_by,updated_at);
create index if not exists idx_examination_marks_student on public.examination_marks(school_id,student_id,examination_id);
create index if not exists idx_ai_audit_timestamp on public.ai_audit_logs(occurred_at);
create index if not exists idx_ai_audit_request on public.ai_audit_logs(request_id,correlation_id);
create index if not exists idx_ai_actions_school_status on public.ai_human_controlled_actions(school_id,status,created_at desc);
create index if not exists idx_student_transcripts_student on public.student_transcripts(school_id,student_id);
create index if not exists idx_compliance_expiry on public.compliance_records(school_id,expiry_date);
create index if not exists idx_report_exports_type on public.report_exports(school_id,report_type,created_at);
create index if not exists idx_student_fee_account_scope on public.student_fee_accounts(school_id,permanent_student_id,academic_year_id,term_id);
create index if not exists idx_student_fee_payment_reference on public.student_fee_payments(school_id,payment_reference);
create index if not exists idx_student_fee_receipt_number on public.student_fee_receipts(school_id,receipt_number);

create view public.vw_student_fee_balances as
 select a.id as account_id,a.school_id,a.student_id,a.permanent_student_id,a.academic_year_id,a.term_id,a.class_id,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='CHARGE'),0) as total_charged,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='DISCOUNT'),0) as total_discount,
 coalesce(sum(l.amount) filter(where l.status='ACTIVE' and l.transaction_type='PAYMENT'),0) as total_paid,
 coalesce(sum(case when l.status='ACTIVE' and l.transaction_type='CHARGE' then l.amount when l.status='ACTIVE' and l.transaction_type in ('DISCOUNT','PAYMENT') then -l.amount else 0 end),0) as balance
 from public.student_fee_accounts a left join public.student_fee_ledger l on l.account_id=a.id and l.school_id=a.school_id
 group by a.id,a.school_id,a.student_id,a.permanent_student_id,a.academic_year_id,a.term_id,a.class_id;
create view public.vw_fee_overview as select school_id,academic_year_id,term_id,count(*) as student_accounts,sum(total_charged) as expected_fees,sum(total_discount) as discounts,sum(total_paid) as collected,sum(balance) as outstanding from public.vw_student_fee_balances group by school_id,academic_year_id,term_id;
create view public.vw_fee_arrears as select * from public.vw_student_fee_balances where balance>0;
create view public.vw_invoice_receipt_register as
 select p.school_id,p.permanent_student_id,p.academic_year_id,p.term_id,p.class_id,i.invoice_number,p.payment_reference,r.receipt_number,
 p.amount as amount_paid,p.payment_method,p.payment_date,r.previous_balance,r.new_balance,r.issued_at,p.status as payment_status,r.status as receipt_status
 from public.student_fee_payments p left join public.fee_invoices i on i.id=p.invoice_id and i.school_id=p.school_id
 left join public.student_fee_receipts r on r.payment_id=p.id and r.school_id=p.school_id;
create view public.vw_fee_collection_summary as
 select school_id,collection_type,academic_year_id,term_id,collection_period,collection_date,count(*) as transaction_count,sum(amount_received_minor) as amount_received_minor
 from public.fee_collection_records group by school_id,collection_type,academic_year_id,term_id,collection_period,collection_date;
create view public.vw_published_fee_structures as
 select id,school_id,academic_year as academic_year_id,term as term_id,class_id,category_name as fee_type,amount,status
 from public.fee_structures where status='PUBLISHED';

-- Existing runtime reads this literal ID; database roles and auth sessions remain
-- private. The API server should verify cookie/session/RBAC before using service credentials.
create unique index if not exists uq_auth_sessions_token_hash on public.auth_sessions(token_hash);
create index if not exists idx_auth_sessions_user_active on public.auth_sessions(user_id,revoked_at,expires_at);
create index if not exists idx_auth_sessions_school on public.auth_sessions(school_id);

-- Remove browser/API roles' table grants and enable RLS on private records.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' and tablename <> 'schools' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
  alter table public.schools enable row level security;
  revoke all on table public.schools from anon, authenticated;
end $$;
do $$ declare v record; begin
  for v in select table_name from information_schema.views where table_schema='public' loop
    execute format('revoke all on table public.%I from anon, authenticated', v.table_name);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.schools to anon, authenticated;
create policy schools_public_read on public.schools for select to anon, authenticated using (id='sch_default_01');

-- Backend-only database access. Never expose the service_role key to browsers.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;



COMMIT;
