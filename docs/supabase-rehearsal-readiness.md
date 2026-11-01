# OSAAH Supabase Isolated-Rehearsal Readiness

- **Audit date:** 2026-10-18
- **Repository baseline:** `codex/schema-reconciliation` at `c48f9c3aa1d30d2275122053b347f01f497858be`
- **Hosted project observed:** `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`)
- **Decision:** **BLOCKED — NOT READY FOR ISOLATED REHEARSAL**
- **Scope:** readiness assessment and proposed plan only. No migration, login test, data transfer, database mutation, Vercel change, or deployment was performed.

## Gate status

| Gate | Result | Evidence and unblock action |
|---|---|---|
| Correct Supabase project identity | **PASS (project identity only)** | Dashboard project name/reference matched. This does not identify an isolated Preview database. |
| Effective database role | **BLOCKED** | SQL Editor is connected as `postgres`, a `BYPASSRLS` role. This is not the OSAAH adapter's role. Owner must verify the private Preview URL target and runtime identity without sharing the URL. |
| Permission safety | **FAIL** | All three API roles have all seven table privileges on 12 public tables; anon/authenticated include `TRUNCATE`. `service_role` has `BYPASSRLS`; `authenticator` membership includes service_role. Owner/security review and a tested least-privilege design are required. No live remediation is authorized here. |
| Public read policy safety | **FAIL** | Public SELECT with `USING (true)` exists on `students`, `classes`, and `subjects`; RLS is enabled but not forced. Student privacy is not protected by these policies. Current student count of zero does not reduce the need to fix before data is loaded. |
| Canonical schema compatibility | **FAIL** | Captured live schema has 12 starter tables; canonical migration expects 159 tables, six views, and a different application contract. Login-referenced fields/relations are missing, including `users.school_id`/`password_hash`, role-key fields, and `parent_student_links`. |
| Migration ledger | **BLOCKED** | `public.schema_migrations` was absent in captured catalog. Owner must determine deployment history and migration reconciliation strategy. |
| Recovery point and restore | **BLOCKED** | No verified PITR/backup or restore-to-new-project evidence. Owner must confirm exact project, point, retention, operator, and a successful restore test. |
| Authoritative school data source | **BLOCKED** | Current aggregate counts do not establish whether TiDB, Supabase, or a backup is authoritative. Obtain read-only table counts/key-set reconciliation from each candidate source. Do not treat empty Supabase tables as data loss. |
| Isolated non-Production target | **BLOCKED** | No separate non-Production Supabase target is confirmed. Provision or identify one and verify its project ref/region and isolation from Production. |
| Preview cannot write Production | **BLOCKED** | No fresh Vercel scope/target proof. Owner must verify Preview-only `OSAAH_POSTGRES_URL` points to isolated DB and Production URL is never used by Preview. |
| TLS and session-secret separation | **BLOCKED** | Adapter defaults to certificate verification; Preview's effective TLS/CA and separate session signing secret were not verified. Confirm server-side variable names/scopes without exposing values and prove Preview secret differs from Production. |
| Eight-role permission map | **BLOCKED** | Only six source role labels/assignments were observed. Owner must approve mapping for Proprietor, Administrator, Headteacher, Assistant Headteacher, Accountant, Teacher, Parent, and Admission Officer; resolve source `admin`. |
| Existing account recovery | **BLOCKED** | Existing `users` table has no password hash field and no tested credential recovery/enrollment process exists. Owner must approve a secure process for six source accounts without manufacturing credentials. |
| Parent relationship mapping | **BLOCKED** | `parent_student_links` is absent; existing `students.parent_id` was empty and does not prove active link semantics. Identify authoritative mapping and approve access rules. |
| School identity | **BLOCKED** | Preserve `sch_default_01`; live captured schema lacks `schools` and user school scope. Define and test the one-school constraint before copying records. |
| Application workflow verification | **BLOCKED** | No isolated hosted integration or Preview workflow tests were performed. Local PGlite tests are not hosted evidence. |

## Why rehearsal is blocked

The target currently observed is the Supabase project used for Production catalog review, not a verified disposable Preview database. Its actual runtime role is unknown, recovery is unproven, the school data source has not been established, and the canonical schema differs materially from the hosted 12-table catalog. The current reconciliation migration targets a seven-table starter schema and does not match. Applying migrations, creating a clone, copying records, or changing privileges is outside this audit and must wait for owner-approved recovery and isolation evidence.

## Proposed rehearsal plan (not executed)

### Gate 0 — owner provision and evidence

1. Identify authoritative school data among TiDB, exports, Supabase, and backups using aggregate counts and keyed hashes only; retain personal data in its authorized source.
2. Verify a dated recovery point for the selected source and complete a restore-to-new-project rehearsal. Record project/region, timestamp, retention, operator, catalog fingerprint, and aggregate count comparison.
3. Provision/identify a separate non-Production Supabase project. Confirm that Preview cannot route to Production; privately verify Preview-only database URL, verified TLS, and an independent session secret.
4. Approve role mapping for all eight OSAAH roles, account recovery for the six observed users, Parent-student relation source/semantics, and single-school identifier `sch_default_01`.
5. Review exact grants, role memberships/SET options, role attributes, owners, schema/table/view/sequence/function ACLs, default privileges, RLS policies, and the exact OSAAH runtime role. Approve a least-privilege target role and policy design.

### Gate 1 — prepare and review rehearsal package

1. Generate a catalog fingerprint and migration checksum against the isolated target. Explicit preflight assertions must abort on unexpected catalog state, data, counts, ownership, dependencies, or migration-ledger drift.
2. Review the source-to-target map for every table family and stable identifier. Preserve student permanent IDs, staff IDs, roles, assignments, admissions, fee balances/payments, attendance, results, and audit history. Do not synthesize missing hashes or Parent links.
3. Use masked/restored data only with separate approval; otherwise use synthetic fixtures in the isolated test database. Never put real student/person details in logs or reports.
4. Produce a transaction/restore plan with named operator, exact checkpoint, post-snapshot write handling, abort criteria, and rollback owner. Keep source TiDB and any legacy archive intact.

### Gate 2 — execute only after separate authorization

No migration is authorized by this report. Once the owner has verified prerequisites and separately approves a non-Production rehearsal:

1. Apply the reviewed migration to the isolated target only, using a second-person verified project identity and migration checksum.
2. Compare pre/post table counts and stable key-set hashes. Check primary/unique keys, orphan FKs, ledger entries, sequence state, school scope, accounting totals, and audit history.
3. Verify that `anon` and `authenticated` cannot read private tables or write/truncate; verify the app runtime has only required permissions and cannot truncate or manage schema/security. Execute RLS probes as exact roles, including `BYPASSRLS`/owner negative controls.
4. Test staff and invalid login, session restore/revoke/expiry, each of the eight role dashboards and denied actions, Parent linked/unlinked child restrictions, admissions/enrollment, Fee Hub publication and payment/accounting, attendance, assessment/results, reports, and dashboards.
5. Verify verified TLS, safe diagnostics, and absence of secrets/personal data in logs. Require all acceptance checks before considering Preview readiness.

### Rollback and cleanup criteria

- Abort before migration if the target is Production, target identity is uncertain, preflight differs, backup restore is not proven, authoritative source is unknown, required mapping is incomplete, or any unexpected row/object appears.
- For rehearsal only, retain the original schema/data and recovery point. Do not drop, truncate, overwrite, or retire TiDB. If a transactional operation fails, inspect the exact catalog before retry; do not bypass preconditions.
- After a committed rehearsal, rollback only using a rehearsed restore/reverse procedure and reconcile any writes after the snapshot. Do not assume reversing grants or renaming tables restores sessions, data, or audit state.
- Cleanup synthetic fixtures only after count/key reconciliation and log review, using the approved disposable-target cleanup procedure. No cleanup or database writes were performed in this audit.

## Owner actions to unblock

1. Privately confirm a separate, non-Production Supabase database and Preview isolation.
2. Produce verified backup/restore evidence and identify the authoritative school data source.
3. Have the authorized database owner capture complete effective permissions and the actual OSAAH Preview runtime role; do not send secrets to the auditor.
4. Approve eight-role mapping, six-account recovery, Parent-to-student mapping, and school-scope enforcement.
5. Review the security audit and authorize a separate implementation/rehearsal phase only after the above evidence is complete.

## Validation distinction

Local `npm run test:supabase` and the static migration validator check repository behavior and SQL structure only. They do not connect to Supabase or prove schema compatibility, recoverability, Preview isolation, authentication, or production readiness. No Preview login or migration was attempted.
