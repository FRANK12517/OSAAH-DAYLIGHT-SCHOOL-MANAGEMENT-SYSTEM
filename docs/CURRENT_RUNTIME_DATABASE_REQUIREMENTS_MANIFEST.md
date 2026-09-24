# Current-Runtime Database Requirements Manifest

**Repository baseline:** `8b331c3`  
**Production target:** `osaahdaylightschool`  
**Scope:** Objects referenced by current runtime database paths, not every historical migration object.

## Authentication and identity

The current authentication service uses signed, stateless `osaah_session` cookies backed by an in-process session map. The current database login path reads `portal_users`, `users`, `roles`, `user_roles`, `role_permissions`, and `permissions`. It also reads `parent_student_links` and `students` when resolving parent identity. The runtime does **not** require a database-backed `sessions` table.

## Current database-backed objects

| Runtime area | Tables and views actively referenced | Required state |
|---|---|---|
| Authentication and RBAC | `portal_users`, `users`, `roles`, `user_roles`, `role_permissions`, `permissions`, `parent_student_links`, `students` | Existing identity and access tables must remain available; no `sessions` table required |
| Admissions and enrollment | `admission_applications`, `students`, `student_profiles`, `student_enrollments`, `student_id_sequences`, `classes` | Existing admission/student identity tables; current enrollment writes preserve permanent identity |
| Student attendance | `student_attendance`, `attendance_audit_history` | Existing table retained; academic scope, provenance, timestamps, and audit history required |
| Staff attendance and leave | `staff_attendance`, `staff_leave`, `staff_attendance_reconciliation_audit` | Existing tables retained; scope, status, provenance, leave linkage, and reconciliation audit required |
| Fee obligations and collections | `fee_obligations`, `fee_collection_records`, `fee_collection_corrections` | Release blockers because current fee routes read/write these objects |
| Fee setup | `academic_years`, `terms`, `fee_structures`, `fee_types`, `classes` | Current setup options and published structures require these objects and period fields |
| Student Fee Hub | `student_fee_accounts`, `student_fee_ledger` | Current account, charge, discount, payment, and balance projections require these objects |
| Invoices and receipts | `fee_invoices`, `fee_invoice_items`, `student_fee_payments`, `student_fee_receipts` | Current invoice/payment/receipt functionality requires these objects |
| Financial audit | `financial_audit_history` | Required for server-backed financial write audit events |
| Fee reporting | `vw_student_fee_balances`, `vw_fee_overview`, `vw_fee_arrears`, `vw_published_fee_structures`, `vw_invoice_receipt_register`, `vw_fee_collection_summary` | Required projections over current financial tables |
| AI durable persistence | `ai_audit_logs`, `ai_human_controlled_actions` | Required only when production AI persistence is enabled; missing objects are required-but-non-blocking for the school-management release |
| Migration infrastructure | `schema_migrations`, `schema_migration_lock`, `schema_baselines` | Required for future migration execution and truthful current-state baseline; must not contain fabricated historical records |

## Runtime column requirements

The currently active attendance repository reads and writes school scope, student/staff identifiers, class or staff identifiers, attendance date, status, reason, academic year, term, subject key, attendance type, leave linkage, notes, provenance actors, timestamps, and source fields. The reconciliation migration uses explicit `LEGACY_UNSPECIFIED` defaults for unknown academic scope, subject scope, staff status, and source. It does not classify an old record as present or manually entered when the historical fact is unknown. Nullable provenance fields remain nullable where the source record does not provide a deterministic value.

The current fee collection repository requires `collection_type`, `collection_date`, `expected_amount_minor`, `amount_received_minor`, `recorded_by`, `academic_year_id`, `term_id`, `collection_period`, `fee_type_id`, and `custom_fee_type_name`. Extra Classes may use `1st Term`, `2nd Term`, `3rd Term`, or `Vacation Classes`; Canteen validation remains limited to the first three academic terms. `Vacation Classes` is not added to the canonical academic-term table.

The current Fee Hub projections require student fee account scope, ledger transaction type, amount, account and student identity, academic year, term, class, invoice, payment, receipt, and financial-audit fields. Monetary values in the collection subsystem remain integer minor units. The Fee Hub ledger, invoice, payment, and receipt tables retain the repository’s existing decimal amount convention.

## Release-blocking gaps found in production

The read-only inventory confirmed these current-state blockers:

1. `fee_obligations` is missing.
2. `fee_collection_records` is missing.
3. `fee_collection_corrections` is missing.
4. Student attendance academic scope and provenance columns are missing.
5. Staff attendance academic scope, status, leave linkage, notes, and provenance columns are missing.
6. Staff leave reconciliation fields and `staff_attendance_reconciliation_audit` are missing.
7. `attendance_audit_history` is missing.
8. The current Fee Hub account, ledger, invoice, payment, receipt, financial-audit, fee-type, and reporting projections are not safely established by the production inventory and must be reconciled additively before enabling their database-backed routes.

The current application does not require a `sessions` table. Creating one would add an unused persistence model and is intentionally excluded.

## Reconciliation scope

The forward-only migration `049_production_schema_reconciliation.sql` creates only current-state objects and adds only additive columns and indexes. It contains no `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, or `INSERT` statement. It does not backfill invented academic periods, people, fees, payments, or attendance facts. Historical migration files `001` through `048` remain immutable and are not replayed.
