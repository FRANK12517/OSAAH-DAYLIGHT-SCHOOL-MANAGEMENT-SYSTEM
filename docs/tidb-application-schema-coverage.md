# TiDB application-to-schema coverage

> **Status: INCOMPLETE.** This is a source-coverage map, not proof of physical TiDB schema coverage.

## Repository evidence

- Numbered SQL migration files: 82.
- Runtime source files scanned: 153.
- Extracted runtime SQL observations: 543.
- Runtime-SQL-confirmed table names: 71.
- Runtime write-column observations: 134.
- Native platform metadata definitions in TiDB source: 5; these are not live-verified application schema.
- Historical table-name candidates: 157.
- Historical names with extracted runtime SQL: 65.
- Runtime-linked names whose SQL was not statically extracted: 17.
- Historical names without an extracted runtime operation: 75.
- Historical views: 8.
- Original application tables: 159.
- Source-classified active runtime tables: 66.
- Legacy compatibility alternatives: 1.
- Application tables with unresolved disposition: 92.
- Supported-workflow historical views: 5; unresolved views: 3.
- Complete authoritative application DDL definitions: 0.

These counts overlap by design. Static query extraction can miss dynamic SQL and does not establish requiredness, DDL, data lifecycle, or transaction semantics.

## Domain coverage

### Authentication and RBAC

- Status: **PARTIAL**.
- Core tables: `users`, `user_roles`, `roles`, `role_permissions`, `permissions`, `auth_sessions`.
- Evidence modules: `src/auth.js`, `src/durable-staff-provisioning.js`, `schema/001_foundation.sql`, `schema/032_production_rbac_reconciliation.sql`, `schema/052_durable_auth_sessions.sql`.
- Unresolved requirements: users uniqueness/nullability/defaults and cross-school identifier policy unresolved; user_roles primary-key/type choice and FK contract unresolved although id writes and pair uniqueness behavior are established; RBAC seeding/scope and empty-permission fallback authorization policy unresolved; TiDB FK/type/action contract unresolved.

### Proprietor and Administrator

- Status: **PARTIAL**.
- Core tables: `portal_users`, `users`, `roles`, `user_roles`, `auth_sessions`.
- Evidence modules: `src/proprietor-authentication-controller.js`, `src/server.mjs`, `src/durable-staff-provisioning.js`.
- Unresolved requirements: portal_users lacks TiDB DDL/provisioner; separate proprietor login does not establish standard durable session; secure bootstrap policy must be implemented as an explicit operational workflow.

### Staff and Teachers

- Status: **PARTIAL**.
- Core tables: `staff`, `staff_profiles`, `users`, `user_roles`, `roles`, `subject_register_teachers`.
- Evidence modules: `src/durable-staff-provisioning.js`, `src/staff-attendance-overview.js`, `src/server.mjs`, `schema/009_staff_hr.sql`.
- Unresolved requirements: staff_profiles writer/history shape conflict; staff_number is externally supplied and school-scoped in application checks; physical uniqueness/FK not established; teacher assignment contracts remain table-specific.

### Students and Parents

- Status: **PARTIAL**.
- Core tables: `students`, `student_profiles`, `parent_student_links`, `student_enrollments`, `admission_applications`, `users`.
- Evidence modules: `src/admission-enrollment.js`, `src/parent-sms-auth.js`, `src/durable-student-profile.js`, `src/existing-student-linking.js`, `src/parent-historical-records.js`.
- Unresolved requirements: link archival/guardian policy unresolved; legacy student identity bridges remain; physical types, FKs and delete actions unresolved.

### School Configuration and Academics

- Status: **PARTIAL**.
- Core tables: `schools`, `system_settings`, `academic_years`, `terms`, `classes`, `streams`, `subjects`, `class_subjects`, `subject_class_assignments`, `student_enrollments`.
- Evidence modules: `src/school-settings.js`, `src/academic-calendar.js`, `src/durable-academic.js`, `src/production-three-term-config.js`, `src/module-registry.js`.
- Unresolved requirements: historical schema drift across academic modules; scoped key and FK contracts need full per-table reconciliation; class_subjects is optional compatibility only.

### Attendance and Assessments

- Status: **PARTIAL**.
- Core tables: `student_attendance`, `staff_attendance`, `examinations`, `examination_marks`, `academic_score_records`, `grading_systems`.
- Evidence modules: `src/attendance-repository.js`, `src/student-attendance-overview.js`, `src/staff-attendance-overview.js`, `src/durable-academic.js`, `src/academic-results.js`.
- Unresolved requirements: assessment/result stores have parallel historical shapes; score precision, uniqueness, version, and FK contracts require field-level reconciliation.

### Results and Report Cards

- Status: **PARTIAL**.
- Core tables: `examinations`, `examination_marks`, `academic_result_blocks`, `academic_result_records`, `academic_score_records`, `student_transcript_versions`.
- Evidence modules: `src/durable-academic.js`, `src/academic-results.js`, `src/platform/final-result-slip-reconciliation.js`, `src/platform/result-blocking-083-preflight.js`.
- Unresolved requirements: legacy/current result sources coexist; view/result reconciliation inputs need canonical selection; generated uniqueness migration needs target-version validation.

### Financial Management

- Status: **PARTIAL**.
- Core tables: `fee_types`, `fee_structures`, `student_fee_accounts`, `student_fee_ledger`, `student_fee_payments`, `fee_invoices`, `student_fee_receipts`, `fee_obligations`, `fee_collection_records`.
- Evidence modules: `src/durable-fee-payments.js`, `src/durable-fee-reader.js`, `src/parent-fee-obligations-repository.js`, `src/fee-collections-repository.js`, `src/platform/final-result-slip-reconciliation.js`.
- Unresolved requirements: conflicting historical fee view definitions; amount precision/minor-unit contracts and payment allocation constraints not fully reconciled; view dependencies need canonical base-table definitions.

- Views: `vw_student_fee_balances`, `vw_fee_overview`, `vw_fee_arrears`, `vw_invoice_receipt_register`, `vw_fee_collection_summary`.

### Reports, Notifications and Auditing

- Status: **PARTIAL**.
- Core tables: `audit_logs`, `announcements`, `announcement_records`, `notifications`.
- Evidence modules: `src/ai/operational-intelligence.js`, `src/durable-announcements.js`, `src/platform/final-result-slip-reconciliation.js`, `src/single-school-overview.js`.
- Unresolved requirements: dynamic/reporting dependencies incompletely traced; historical class views lack current direct consumers; 92 historical tables lack sufficiently evidenced dispositions.

- Views: `vw_class_database`, `vw_completed_class_database`.

## Active runtime module-to-entity trace

- Modules mapped to directly used application tables: 114.
- Complete authoritative schema contracts for these modules: 0.

- `academic-calendar`: `academic_calendar_events`, `academic_years`, `classes`, `staff`, `students`, `terms`.
- `academic-results`: `academic_years`, `classes`, `examinations`, `students`, `subjects`, `terms`.
- `admission-enrollment`: `admission_applications`, `audit_logs`, `classes`, `parent_student_links`, `roles`, `student_enrollments`, `student_id_sequences`, `student_profiles`, `students`, `user_roles`, `users`.
- `admission-form`: `invoices`, `payments`, `students`.
- `admission-prospectus`: `assignments`, `classes`, `staff`, `students`.
- `ai/academic-attendance-intelligence`: `classes`, `staff`, `students`, `subjects`.
- `ai/admissions-workforce-intelligence`: `assignments`, `roles`, `staff`.
- `ai/authorization-guard`: `classes`, `students`, `subjects`.
- `ai/capabilities/core.capability`: `announcements`, `roles`, `staff`, `students`.
- `ai/contracts`: `classes`, `levels`, `subjects`.
- `ai/conversation`: `staff`, `students`.
- `ai/durable-stores`: `ai_audit_logs`, `ai_human_controlled_actions`.
- `ai/executive-intelligence`: `roles`.
- `ai/financial-intelligence`: `invoices`, `payments`.
- `ai/human-controlled-actions`: `staff`.
- `ai/module-manifest-registry`: `roles`.
- `ai/operational-intelligence`: `announcements`, `assignments`.
- `ai/registry`: `roles`.
- `ai/school-context`: `assignments`, `classes`, `roles`, `staff`, `subjects`, `terms`.
- `ai/school-knowledge-intelligence`: `roles`, `users`.
- `ai/system-of-record-readiness`: `assignments`, `classes`, `invoices`, `payments`, `staff`, `students`, `subjects`, `terms`.
- `ai/tidb-database-adapter`: `auth_sessions`.
- `ai/tidb-readiness`: `academic_calendar_events`, `academic_years`, `announcements`, `assignment_files`, `assignments`, `auth_sessions`, `classes`, `invoices`, `parent_auth_rate_limits`, `parent_student_links`, `payments`, `roles`, `schools`, `student_attendance`, `student_enrollments`, `student_profiles`, `students`, `terms`, `user_roles`, `users`.
- `assignments`: `assignment_files`, `assignments`, `classes`, `students`, `subject_class_assignments`, `subjects`.
- `attendance`: `staff`.
- `attendance-aggregation`: `students`.
- `attendance-analytics`: `classes`, `staff`, `students`.
- `attendance-page`: `students`.
- `attendance-register-service`: `academic_years`, `student_enrollments`, `student_profiles`, `students`, `terms`.
- `attendance-reports`: `staff`, `students`, `terms`.
- `attendance-repository`: `attendance_audit_history`, `staff`, `staff_attendance`, `student_attendance`.
- `auth`: `announcements`, `assignments`, `auth_sessions`, `examinations`, `parent_auth_rate_limits`, `parent_student_links`, `roles`, `schools`, `staff`, `staff_assignments`, `student_profiles`, `students`, `subjects`, `user_roles`, `users`.
- `budgets`: `academic_years`, `budget_items`, `budgets`, `financial_audit_history`, `staff`, `terms`.
- `cashbook`: `fee_payments`, `general_expenses`, `general_income`, `students`.
- `class-database`: `classes`, `students`.
- `communication`: `announcements`, `notifications`, `staff`.
- `compliance`: `classes`, `staff`.
- `default-subject-catalog`: `classes`.
- `durable-academic`: `academic_years`, `assignments`, `classes`, `examinations`, `levels`, `student_enrollments`, `student_profiles`, `students`, `subject_class_assignments`, `subjects`, `terms`.
- `durable-administrator-credential-reset`: `auth_sessions`, `roles`, `user_roles`, `users`.
- `durable-admissions`: `admission_applications`, `classes`.
- `durable-announcements`: `announcement_reads`, `announcement_recipients`, `announcement_records`, `announcements`, `parent_student_links`, `roles`, `staff`, `user_roles`, `users`.
- `durable-credential-management`: `auth_sessions`, `roles`, `staff`, `user_roles`, `users`.
- `durable-fee-payments`: `academic_years`, `fee_invoice_items`, `fee_invoices`, `fee_obligations`, `payments`, `student_fee_accounts`, `student_fee_ledger`, `student_fee_payments`, `student_fee_receipts`, `students`, `terms`.
- `durable-fee-reader`: `fee_invoice_items`, `fee_invoices`, `parent_student_links`, `payments`, `student_fee_accounts`, `student_fee_payments`, `student_fee_receipts`, `student_profiles`, `students`, `users`.
- `durable-promotion`: `academic_years`, `classes`, `promotion_decisions`, `student_enrollments`, `student_profiles`, `students`, `terms`.
- `durable-result-blocking`: `academic_result_blocks`, `academic_result_unblock_requests`, `roles`.
- `durable-sms`: `academic_years`, `classes`, `parent_student_links`, `roles`, `student_enrollments`, `student_profiles`, `students`, `terms`, `user_roles`, `users`.
- `durable-staff-provisioning`: `auth_sessions`, `classes`, `roles`, `schools`, `staff`, `staff_assignments`, `staff_profiles`, `subjects`, `user_roles`, `users`.
- `durable-student-profile`: `assignments`, `student_family_contacts`, `student_profiles`, `students`.
- `examinations`: `classes`, `examinations`, `promotion_decisions`, `students`, `subjects`, `terms`.
- `existing-student-linking`: `academic_years`, `admission_applications`, `audit_logs`, `classes`, `staff`, `student_enrollments`, `student_id_sequences`, `student_profiles`, `students`.
- `fee-collections`: `classes`, `roles`, `students`.
- `fee-collections-repository`: `academic_years`, `classes`, `fee_collection_corrections`, `fee_collection_records`, `fee_obligations`, `fee_structures`, `fee_types`, `levels`, `students`, `terms`.
- `fee-obligation-balances`: `fee_obligations`, `invoices`, `payments`.
- `fee-types`: `classes`.
- `fees`: `fee_types`, `invoices`, `payments`.
- `financial-authorization`: `budgets`, `invoices`, `payments`, `roles`.
- `gender-distribution`: `students`.
- `general-finance`: `academic_years`, `budget_items`, `budgets`, `financial_audit_history`, `general_expenses`, `general_income`, `terms`.
- `ges-assessment-libraries`: `assignments`, `examinations`, `students`, `subjects`.
- `module-registry`: `announcements`, `assignments`, `budgets`, `classes`, `examinations`, `invoices`, `notifications`, `payments`, `roles`, `staff`, `students`, `subjects`, `terms`, `users`.
- `operations`: `assignments`.
- `parent-authorization`: `students`.
- `parent-dashboard`: `announcements`, `assignments`, `classes`, `examinations`, `invoices`, `payments`, `students`, `terms`.
- `parent-fee-obligations-repository`: `fee_obligations`, `parent_student_links`, `student_profiles`, `students`.
- `parent-historical-records`: `academic_years`, `classes`, `parent_student_links`, `promotion_decisions`, `student_enrollments`, `student_profiles`, `students`, `terms`, `users`.
- `parent-sms-auth`: `parent_auth_challenges`, `parent_auth_rate_limits`, `parent_student_links`, `roles`, `student_profiles`, `students`, `user_roles`, `users`.
- `permanent-student-id`: `students`.
- `platform/academic-result-blocking-075-schema`: `academic_result_blocks`, `academic_result_unblock_requests`.
- `platform/assignment-migration-schema`: `assignment_files`, `assignments`.
- `platform/final-result-slip-reconciliation`: `academic_years`, `classes`, `fee_collection_records`, `fee_invoices`, `fee_structures`, `parent_student_links`, `payments`, `schools`, `student_enrollments`, `student_fee_accounts`, `student_fee_ledger`, `student_fee_payments`, `student_fee_receipts`, `student_profiles`, `students`.
- `platform/forward-finance-migration`: `academic_years`, `budget_items`, `budgets`, `financial_audit_history`, `general_expenses`, `general_income`, `schools`, `terms`, `users`.
- `platform/forward-production-reconciliation`: `auth_sessions`, `financial_audit_history`, `student_fee_receipts`.
- `platform/result-blocking-083-preflight`: `academic_result_blocks`.
- `platform/result-slip-migration-preflight`: `academic_years`, `classes`, `schools`, `students`, `subjects`, `terms`.
- `platform/subject-assignment-preview`: `assignments`, `classes`, `subject_class_assignments`, `subjects`.
- `platform/subject-configuration-preview`: `assignments`, `classes`, `subjects`.
- `platform/subject-sync-guards`: `schools`.
- `production-terms-uniqueness-migration`: `terms`.
- `production-three-term-config`: `academic_years`, `schools`, `terms`.
- `proprietor-authentication-controller`: `portal_users`.
- `proprietor-sidebar-routes`: `announcements`, `assignments`, `budgets`, `classes`, `examinations`, `invoices`, `notifications`, `payments`, `roles`, `staff`, `students`, `subjects`, `terms`, `users`.
- `receipt-branding`: `students`.
- `reporting`: `examinations`, `invoices`, `payments`, `students`, `terms`.
- `result-calculation`: `subjects`.
- `result-slip`: `subjects`.
- `result-slip-pdf`: `students`, `subjects`.
- `roles`: `staff`.
- `sample-academic-context`: `classes`, `terms`.
- `sample-fixture-repository`: `announcements`, `assignments`, `payments`, `sample_data_fixtures`.
- `sample-result-workflow`: `classes`, `students`, `subjects`.
- `school-context`: `staff`.
- `school-profile`: `classes`, `roles`, `staff`, `staff_profiles`, `students`, `terms`, `user_roles`, `users`.
- `school-settings`: `academic_years`, `assignments`, `schools`, `system_settings`, `terms`.
- `server`: `academic_years`, `announcements`, `assignments`, `auth_sessions`, `budgets`, `classes`, `examinations`, `fee_structures`, `fee_structures_v2`, `fee_types`, `invoices`, `levels`, `notifications`, `payments`, `roles`, `staff`, `students`, `subjects`, `terms`, `user_roles`, `users`.
- `shep-activities`: `staff`, `students`.
- `sidebar-classification`: `announcements`, `examinations`, `roles`, `staff`, `students`, `users`.
- `sidebar-registry`: `assignments`, `budgets`, `classes`, `examinations`, `invoices`, `payments`, `roles`, `staff`, `students`, `subjects`, `users`.
- `sidebar-route-contract`: `assignments`, `budgets`, `classes`, `examinations`, `invoices`, `payments`, `staff`, `students`, `subjects`, `terms`.
- `signatures`: `assignments`, `classes`, `staff`, `students`.
- `single-school-overview`: `admission_applications`, `announcements`, `audit_logs`, `classes`, `examination_marks`, `examinations`, `fee_collection_records`, `general_expenses`, `general_income`, `invoices`, `notifications`, `payments`, `roles`, `staff`, `staff_attendance`, `staff_leave`, `staff_profiles`, `student_attendance`, `student_profiles`, `students`, `terms`, `users`.
- `sporting-activities`: `students`.
- `staff`: `assignments`, `staff`.
- `staff-attendance-overview`: `academic_calendar_events`, `academic_years`, `roles`, `staff`, `staff_attendance`, `staff_leave`, `staff_profiles`, `user_roles`, `users`.
- `staff-leave-reconciler`: `staff`.
- `student-attendance-overview`: `academic_calendar_events`, `academic_years`, `classes`, `levels`, `student_attendance`, `student_enrollments`, `student_profiles`, `students`, `terms`.
- `student-classes`: `students`.
- `students`: `students`.
- `subject-register`: `classes`, `staff`, `subjects`, `terms`.
- `subjects`: `classes`, `students`, `subjects`.
- `test-parent-fixture`: `students`.
- `transcripts`: `students`, `subjects`.
- `user-directory`: `roles`, `staff`, `user_roles`, `users`.
## Cross-cutting coverage gaps

- Exact active columns, types, nullability, defaults, physical keys, and TiDB-specific definitions are not established for all runtime entities.
- Historical SQL, PostgreSQL-only schema evidence, and generated source scans remain candidates; they are not merged into an executable TiDB schema.
- The target TiDB server version, SQL mode, default charset/collation, timezone, and foreign-key policy are not configured in repository deployment files.
- `portal_users` is referenced by the separate Proprietor authentication path but has no TiDB DDL or secure bootstrap writer in the inspected migrations.
- Historical fee views conflict; their exact output and financial semantics require owner review.
- The full disposition of historical entities and dynamic query dependencies is not complete.

## Release rule

No domain is schema-complete until its required entities, query columns, constraints, relationships, indexes, and TiDB compatibility checks are approved and tested. The fresh initializer must continue to reject any plan with unresolved requirements.
