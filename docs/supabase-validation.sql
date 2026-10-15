-- Read-only checks plus explicit rollback-only negative tests. Use only on a
-- disposable/local PostgreSQL database. The baseline has parsed and executed on
-- PGlite PostgreSQL 18.6; hosted Supabase behavior still requires its own rehearsal.
-- Never run against production. Run the expected-error blocks individually.

-- Inventory tables, columns, constraints/FKs, indexes, and views.
select count(*) as base_table_count from information_schema.tables where table_schema='public' and table_type='BASE TABLE';
select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name;
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position;
select tc.table_name,tc.constraint_name,tc.constraint_type,kcu.column_name,ccu.table_name as foreign_table,ccu.column_name as foreign_column
from information_schema.table_constraints tc left join information_schema.key_column_usage kcu
 on kcu.constraint_schema=tc.constraint_schema and kcu.constraint_name=tc.constraint_name and kcu.table_name=tc.table_name
left join information_schema.constraint_column_usage ccu on ccu.constraint_schema=tc.constraint_schema and ccu.constraint_name=tc.constraint_name
where tc.constraint_schema='public' order by tc.table_name,tc.constraint_type,tc.constraint_name,kcu.ordinal_position;
select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname;
select table_name from information_schema.views where table_schema='public' order by table_name;
select count(*) as view_count from information_schema.views where table_schema='public';
select * from public.vw_student_fee_balances limit 0;
select * from public.vw_fee_overview limit 0;
select * from public.vw_fee_arrears limit 0;
select * from public.vw_invoice_receipt_register limit 0;
select * from public.vw_fee_collection_summary limit 0;
select * from public.vw_published_fee_structures limit 0;
select conrelid::regclass as table_name,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' order by tablename,policyname;

-- The seed should preserve the required identifier; no personal/financial data is seeded.
select id,name from public.schools where id='sch_default_01';
select 'students' as table_name,count(*) from public.students
union all select 'student_profiles',count(*) from public.student_profiles
union all select 'staff',count(*) from public.staff
union all select 'student_fee_payments',count(*) from public.student_fee_payments
union all select 'academic_score_records',count(*) from public.academic_score_records;

-- Authentication assumptions: current auth stays server-managed. Verify token_hash
-- exists and there is no raw session token column.
select column_name from information_schema.columns where table_schema='public' and table_name='auth_sessions' order by ordinal_position;

-- RLS must be enabled for every public base table.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname;
select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by grantee,table_name,privilege_type;

-- Run these checks individually in a disposable session. Each private-table query
-- should fail with permission denied; the public school profile read should pass.
begin;
set local role anon;
select id from public.schools where id='sch_default_01';
-- Expected denial:
select id from public.students;
rollback;

begin;
set local role authenticated;
select id from public.schools where id='sch_default_01';
-- Expected denial; parent links must only be checked through authorized server API:
select student_id from public.parent_student_links;
rollback;

-- Negative constraint tests; execute each block individually and expect the insert
-- to error (then rollback): invalid FK, duplicate school ID, bad enum-like check.
begin;
insert into public.academic_years(id,school_id,name,starts_on,ends_on) values ('validation-year','missing-school','validation',date '2026-01-01',date '2026-12-31');
rollback;

begin;
insert into public.schools(id,name) values ('sch_default_01','duplicate');
rollback;

begin;
insert into public.admission_fee_structures(id,school_id,level,academic_year_id,term_id,tuition_academic_fee,ict_lab_library_fee,pta_utility_charges)
values ('validation-fee','sch_default_01','INVALID','no-year','no-term',-1,0,0);
rollback;

-- Transaction rollback/concurrency must also be tested through the PostgreSQL app
-- adapter; raw SQL here cannot establish the Node transaction lifecycle contract.

-- Nullable mock_label uniqueness test. Run only against an empty disposable DB
-- after applying the baseline. The two NULL terminal rows have the same complete
-- score scope; the expression index must reject the second row. The outer
-- transaction is rolled back so no fixture data remains.
begin;
insert into public.schools(id,name) values ('validation-school','Validation Only');
insert into public.users(id,school_id,username,status) values ('validation-user','validation-school','validation-user','ACTIVE');
insert into public.academic_years(id,school_id,name,starts_on,ends_on) values ('validation-year','validation-school','Validation Year',date '2026-01-01',date '2026-12-31');
insert into public.terms(id,academic_year_id,name,starts_on,ends_on) values ('validation-term','validation-year','Validation Term',date '2026-01-01',date '2026-12-31');
insert into public.classes(id,school_id,name) values ('validation-class','validation-school','Validation Class');
insert into public.departments(id,school_id,name) values ('validation-dept','validation-school','Validation Department');
insert into public.subjects(id,school_id,department_id,code,name) values ('validation-subject','validation-school','validation-dept','VAL','Validation Subject');
insert into public.students(id,school_id,admission_number,first_name,last_name,student_status) values ('validation-student','validation-school','VALIDATION-ADM','Validation','Student','ACTIVE');
insert into public.student_profiles(id,student_master_id,student_id,school_id,admission_number,first_name,surname,qr_code)
values ('validation-profile','validation-student','VALIDATION-PID','validation-school','VALIDATION-ADM','Validation','Student','osaah:student:validation-profile');
insert into public.academic_score_records(id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,total_score,entered_by)
values ('validation-score-1','validation-school','TERMINAL',null,'validation-year','validation-term','validation-class','validation-profile','validation-subject',0,'validation-user');
do $$ begin
  begin
    insert into public.academic_score_records(id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,total_score,entered_by)
    values ('validation-score-2','validation-school','TERMINAL',null,'validation-year','validation-term','validation-class','validation-profile','validation-subject',0,'validation-user');
    raise exception 'Expected duplicate NULL mock_label scope to violate unique index';
  exception when unique_violation then null;
  end;
end $$;
rollback;
