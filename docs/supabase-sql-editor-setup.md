# Supabase SQL Editor setup

Use [the complete setup script](../supabase/osaah_supabase_setup.sql) to install the application schema in a new Supabase project. It is derived from [the canonical baseline](../supabase/migrations/202610150001_osaah_daylight_schema.sql), which reconciles `schema/001`–`schema/081` with the current runtime repositories. The script creates no fake student, teacher, parent, payment, result, or finance records; it preserves the school row `sch_default_01`.

## Before execution

1. Confirm the project reference and environment out-of-band. This repository task did not connect to Supabase project `douzohkmnuqwbpwcezke`.
2. Confirm the destination is the intended **new, empty application schema** and that a recovery/backup plan exists. The SQL performs a preflight for the Supabase-managed roles and all 165 declared table/view names. It raises before schema creation if a role is unavailable or an expected public object already exists.
3. Review the complete SQL. It assumes Supabase already provides `anon`, `authenticated`, and `service_role`; it verifies that `service_role` has `BYPASSRLS` and never creates or alters managed roles.
4. In the Supabase Dashboard SQL Editor, open a new query, paste the complete contents of `supabase/osaah_supabase_setup.sql`, and execute it once. The script is for first installation. If an expected object exists, stop and prepare a separately reviewed additive migration. Do not drop the object or rerun against an unknown schema.
5. After execution, run the read-only catalog checks in `docs/supabase-validation.sql`. Confirm all expected relations, constraints, indexes, RLS, grants, and view queries before configuring any application environment.

This script contains no connection URL, password, API key, or service-role secret. Application database access must remain server-side. Keep Supabase service-role credentials out of browser bundles and all `NEXT_PUBLIC_*` variables. The server application uses `OSAAH_POSTGRES_URL`; see the migration audit and data migration guide for configuration, backup, rehearsal, and cutover gates.

## Schema inventory

The script contains **159 tables**, **6 views**, **55 explicitly declared indexes**, **448 foreign-key constraints**, and **one RLS policy**. The disposable PGlite catalog reported **294 total indexes**, including indexes created for primary-key and unique constraints. There are **no explicit sequence or identity declarations**, **no database functions**, and **no required extensions** in the baseline. IDs are supplied by application code. Date-only school facts use `date`; instants use `timestamptz`; monetary values use exact `numeric` or integer minor-unit fields as defined by the schema.

### Tables

```text
schools, academic_years, terms, levels, classes, streams, departments, subjects, houses,
users, portal_users, students, staff, staff_profiles, roles, permissions, user_roles, role_permissions,
student_profiles, student_family_contacts, student_health_records, student_documents, student_class_history,
parent_student_links, admission_applications, admission_form_applications, admission_documents,
admission_fee_structures, admission_prospectuses, student_id_sequences, student_enrollments,
subject_class_assignments, academic_score_records, academic_result_records, academic_result_blocks,
academic_result_unblock_requests, canonical_ges_assessments, student_attendance, staff_attendance,
staff_leave, staff_leave_balances, staff_assignments, staff_documents, attendance_audit_history,
staff_attendance_reconciliation_audit, academic_calendar_events, academic_calendar_term_configs,
examinations, examination_subjects, examination_candidates, examination_timetable, grading_systems,
examination_marks, canonical_academic_scores, promotion_decisions, subject_registers,
subject_register_teachers, subject_register_history, fee_types, fee_structures, student_fee_charges,
student_fee_discounts, fee_obligations, fee_collection_records, fee_collection_corrections,
student_fee_accounts, student_fee_ledger, fee_invoices, fee_invoice_items, student_fee_payments,
student_fee_receipts, financial_audit_history, financial_audit_log, budgets, budget_items, general_income,
general_expenses, auth_sessions, announcement_records, communication_providers, communication_templates,
communication_trigger_settings, communication_outbox, communication_messages, communication_delivery_logs,
announcement_recipients, announcement_reads, sms_campaigns, sms_campaign_recipients, announcements,
notifications, messages, notification_preferences, communication_delivery_log, system_settings, audit_logs,
ai_audit_logs, ai_human_controlled_actions, invoices, payments, financial_adjustments, fee_payments,
fee_receipts, payment_gateway_configs, fee_structures_v2, calendar_events, assignment_files, assignments,
sample_data_fixtures, class_label_aliases, student_transcripts, student_transcript_versions, result_signatures,
official_documents, report_exports, managed_documents, document_versions, compliance_records,
compliance_inspections, privacy_consents, privacy_requests, retention_policies, data_protection_officers,
data_breaches, sporting_sports, sporting_teams, sporting_activities, sporting_participants, sporting_fixtures,
sporting_results, shep_activities, shep_activity_attachments, shep_activity_participants, shep_referrals,
shep_audit_history, library_books, library_loans, transport_vehicles, transport_routes, hostel_spaces,
hostel_allocations, health_records, health_visits, welfare_incidents, counselling_records, inventory_items,
inventory_movements, assets, procurement_requests, school_property, external_exam_records,
property_maintenance, sidebar_categories, sidebar_modules, attendance_notification_settings,
attendance_sync_conflicts, schema_baselines, schema_migrations, schema_migration_lock
```

### Views

`vw_student_fee_balances`, `vw_fee_overview`, `vw_fee_arrears`, `vw_invoice_receipt_register`, `vw_fee_collection_summary`, and `vw_published_fee_structures`.

### Security roles, grants, and policies

The script requires Supabase-managed `anon`, `authenticated`, and `service_role` to exist; it creates no roles. It enables RLS on all 159 tables. The only client-accessible table is `schools`, with `SELECT` granted to `anon` and `authenticated` and a policy limiting visible rows to `sch_default_01`. Those roles have no access to application tables or views otherwise. The script grants `service_role` schema usage, all privileges on schema tables/views, and sequence usage/select, and requires its existing `BYPASSRLS` attribute. Keep service-role credentials backend-only. Server-side cookie authentication, parent-to-student relationship checks, and staff permission checks remain application responsibilities; this schema does not map browser `auth.uid()` into OSAAH users or authorize direct browser access to private tables.

## Differences from canonical migration

The SQL Editor script retains the same tables, columns, constraints, FK references, indexes, seed, views, and limited client policy as the baseline. It adds a preflight that checks the required Supabase role assumptions and refuses collisions with any of the baseline’s table/view names. It uses `CREATE VIEW` instead of `CREATE OR REPLACE VIEW` so it cannot silently replace an existing view. It grants backend access to the already-existing `service_role`. These changes make first-run setup explicit; they do not make the script an upgrade migration.

## Validation status and blockers

The generated script executed successfully in disposable PGlite with test-created stand-in roles. Catalog checks returned 159 tables, 6 views, 294 indexes, 448 foreign keys, one policy, and RLS on all tables; privilege checks confirmed private-table denial for `anon`/`authenticated`, school read permission, and backend `service_role` schema/table access. A second execution was rejected on the existing-object guard. This validates PostgreSQL syntax and behavior in PGlite only.

Live execution in Supabase remains **pending**. A read-only check on 2026-10-15 verified project `douzohkmnuqwbpwcezke` is named `OSAAH DAYLIGHT SCHOOL`, active/healthy, on PostgreSQL 17. Its migration ledger has zero rows, but the public schema already has seven empty-at-inspection tables, six identity sequences, and 18 indexes. The existing objects collide with this empty-project baseline, so this script's preflight would stop. No SQL was applied. Recovery readiness and whether this project is non-production were not established. The separate guarded migration draft is `supabase/migrations/202610150002_reconcile_existing_supabase.sql`; review its preconditions and `docs/supabase-migration-plan.md` before considering execution.

RLS is enabled on all seven tables, but `anon` and `authenticated` have direct table grants, and the `classes`, `students`, and `subjects` policies allow `SELECT USING (true)` to `PUBLIC`. Four other tables have no policies. The role catalog confirms `service_role` has `BYPASSRLS`; anon/authenticated do not. No grants or policies were changed. Review the guarded reconciliation plan and rollback document; do not bypass the empty-project collision guard or run either SQL file until the project owner verifies recovery readiness and authorizes the environment. Hosted schema validation, `sch_default_01`, hosted app connection, RLS behavior tests, and workflows remain unverified.

## Remaining operator steps

1. In Supabase, identify a dedicated non-production target for OSAAH. Confirm its project ref/name, that it contains no data to preserve, and that its backup/recovery plan is understood. Do not run the baseline on the currently inspected project: its `classes`, `students`, and `users` tables collide, and its RLS differs from this script.
2. If using a new empty non-production target, inspect roles and the full catalog, then run `supabase/osaah_supabase_setup.sql` through SQL Editor only if its role checks pass and its collision check finds no objects. For the currently inspected target, use the guarded migration `supabase/migrations/202610150002_reconcile_existing_supabase.sql` only after verifying its exact preconditions and backup/recovery. Stop on any failure. Verify the 159-table/6-view/448-FK inventory, indexes, RLS, grants, archive privacy, and `sch_default_01` using `docs/supabase-migration-validation.sql`.
3. Configure a Preview deployment in the linked Vercel project with the non-production target's `OSAAH_POSTGRES_URL` through Vercel's server-side environment-variable settings. Use only a PostgreSQL connection string supported by the Supabase project and the app's `pg` adapter; never use a service-role API key or a `NEXT_PUBLIC_*` variable. Keep credentials out of logs/source control. Test login, sessions, parent/staff authorization, and all nine workflow families against disposable fixtures and verify teardown.
4. Rehearse source-to-target reconciliation as documented in `supabase-data-migration.md`; preserve the TiDB backup and compare counts, keys, FKs, timestamps, result totals, payment/receipt rows, and finance totals. Do not export or import production data until separately authorized.
5. Only after non-production evidence, backup/recovery verification, schema/RLS review, source reconciliation, and rollback rehearsal, obtain explicit cutover approval. Then configure Production `OSAAH_POSTGRES_URL` in the verified Vercel project, verify the deployed runtime and custom domain, and keep the prior TiDB settings available for the documented rollback window. No Vercel project is linked in this workspace, so no setting was changed here.
