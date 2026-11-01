# OSAAH Supabase Forensic Remediation Checklist

This checklist is a dependency-ordered owner/action list. It is not authorization to change Production. Do not connect Preview to an unverified database or apply any migration while a prerequisite is open.

| Order | Owner action | Status | Required evidence to close |
|---:|---|---|---|
| 1 | Confirm Vercel project/team ownership and identify the exact Preview deployment/commit. | PARTIAL | Dashboard verified project `osaah-daylight-school-management-system` in `frank12517s-projects`; capture deployment commit and Preview URL without reading secret values. |
| 1a | Preserve safe server diagnostics that distinguish known PostgreSQL schema and permission SQLSTATEs. | PASS (local) | `src/auth.js` now classifies `42703`, `42P01`, `3F000`, and `42501`; focused regression tests verify categories and confirm response/log redaction. This does not identify the live failure cause. |
| 2 | Privately verify the Preview `OSAAH_POSTGRES_URL` destination and prove it is a dedicated non-production database/project, separate from Production and Supabase main. Provision an isolated target if needed. | BLOCKED | Owner attestation of project reference/database identity, plus read-only application-runtime identity check. Never copy Production credentials into Preview. |
| 3 | Verify Preview `OSAAH_SESSION_SECRET` is independently generated, server-only, and meets the application contract; verify Production scope is handled by a separately approved release change. | BLOCKED | Scope/name inspection and owner confirmation without disclosing secret values. No setting was changed. |
| 4 | Confirm TLS validation for the isolated Preview target, including CA requirements and successful certificate verification. | BLOCKED | Real application-runtime TLS connection with verification enabled; no certificate bypass. |
| 5 | Identify the authoritative school-data source (TiDB, Supabase, or verified export) using read-only catalog and aggregate counts. | BLOCKED | Provider/project identity, object inventory and non-personal aggregate counts; no record contents. |
| 6 | Confirm a recoverable backup and perform a successful restore to a separate isolated target. | BLOCKED | Provider backup/PITR evidence and successful restore validation; keep the original source unchanged. |
| 7 | Reconcile schemas and data mappings before implementation: school ID `sch_default_01`, permanent student IDs, all staff accounts/roles/permissions, password-reset/enrollment process, parent-student links, fees/payments, attendance, assessment/results, admissions, and other records. | BLOCKED | Reviewed source-to-target mapping, duplicate/conflict policy, row-count reconciliation, integrity checks, and rollback plan. Do not fabricate accounts or relationships. |
| 8 | Resolve observed runtime schema gaps with an additive, reviewed migration design. | BLOCKED | Evidence-backed DDL for `users` auth fields/school ID, role/permission keys, session fields, parent links, and all other required application objects; exact preconditions and rollback verified on isolated copy. |
| 9 | Review effective runtime role, grants, default ACLs, sequence/function privileges, and RLS. Remove broad access only through a reviewed migration that preserves required workflows. | BLOCKED | Runtime role identified separately from SQL Editor `postgres`; least-privilege matrix and policy tests for all eight roles, Parent access, and public endpoints. |
| 10 | Provision disposable real PostgreSQL for the captured 12-table structural rehearsal. | BLOCKED | Local loopback host and database named `osaah_test_<suffix>`, required roles `anon` and `authenticated`, and the exact harness acknowledgement `I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE`. Do not point the harness at hosted/Production. |
| 11 | Run structural migration rehearsal with synthetic fixtures: preserve source objects/rows, reject drift, validate created schema/ledger, refuse repeat application, test transaction rollback and API-role denial. | BLOCKED | Successful real PostgreSQL test logs; document any non-transactional PostgreSQL operations separately. PGlite does not close this gate. |
| 12 | Verify school authentication, invalid credentials, session persistence/restoration, role resolution and dashboard routing on isolated Preview. | BLOCKED | Authorized test accounts; capture status/request IDs and confirm all eight role boundaries. No real student/parent credentials in tests. |
| 13 | Obtain owner approval for Parent authentication semantics and test authorization. | BLOCKED | Explicit policy decision for parent identity verification and student-link authorization; approved safe test account; no login until approved. |
| 14 | Verify Admissions, Parent Portal, Fee Hub publication/payment, accounting, attendance, assessments/results, reporting and dashboards on isolated Preview. | BLOCKED | Workflow results against isolated data with synthetic fixtures and reconciled non-production copy; prove role-specific access and data integrity. |
| 15 | Resolve the Vercel billing action shown in the project dashboard through the account owner, if it affects deployment availability. | OPEN / OWNER | Account owner confirms project remains deployable; do not change billing from this task. |
| 16 | Release review only after every applicable gate passes: review exact diff, push authorized branch, deploy Preview, run smoke tests, then separately approve any Production plan. | BLOCKED | A local commit exists, but GitHub authentication is invalid and network lookup failed; no push, merge, or deployment was performed. Required evidence remains the signed release checklist, rollback/restore plan, reviewed migration, isolated Preview target, and explicit Production authorization. |

## Current stop conditions

- Preview target isolation is unknown because the URL value and destination were not inspected.
- No real application-runtime database identity, connection, or TLS handshake is verified.
- The captured Supabase catalog is structurally incompatible with the current staff and parent authentication queries.
- Authoritative source data, backup validity, and restore success are unknown.
- Broad grants/default ACLs and unrestricted public read policies require a least-privilege review.
- The dedicated real PostgreSQL rehearsal has not run.
- Hosted workflow verification and Parent policy approval are outstanding.

Until each stop condition is closed with evidence, do not run a Preview login/query, migrate data, change database security settings, or declare production readiness.
