# OSAAH Supabase owner approval checklist

- **Project:** `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`)
- **Evidence baseline:** `docs/supabase-12-table-reconciliation-audit.md`, commit `7761914b32f5b7c011e38f5db58f18860cc7d030`
- **Current decision:** BLOCKED. This checklist records evidence and decisions still required. No item below is marked complete unless the pass condition is supported by recorded evidence.

## 1. Backup and recovery verification

- [ ] **Current evidence:** The audit did not have access to a backup/PITR inventory or a successful restore record.
- **Still needed:** Exact project/region recovery point, timestamp, retention/expiry, restore operator, and a successful restore-to-new-project rehearsal with a catalog and row-count comparison.
- **Approver:** Project owner and designated database recovery operator.
- **Pass condition:** Recovery point predates any proposed schema change, restoration to a separate project completes, and the owner accepts the documented recovery procedure and measured recovery objectives.
- **Blocks:** Migration design finalization **yes**; isolated rehearsal **yes**; Production cutover **yes**.

## 2. Authoritative school data source

- [ ] **Current evidence:** The latest captured Supabase aggregates show six rows each in `users`, `roles`, and `user_roles`, and zero rows in the other nine observed public tables. No evidence establishes where the authoritative student, parent, admissions, finance, attendance, or results records reside.
- **Still needed:** Read-only TiDB/backup inventory, project/cluster/database identity, table counts and key-set comparisons, backup/export history, and an owner decision naming the system of record. Do not include personal records in the audit report.
- **Approver:** School data owner/data steward and database operator.
- **Pass condition:** A signed source-of-truth statement and repeatable, access-controlled source/target aggregate reconciliation plan exist; no school data is treated as lost based only on empty Supabase tables.
- **Blocks:** Migration design finalization **yes**; rehearsal **yes**; Production cutover **yes**.

## 3. Actual database connection target and runtime role

- [ ] **Current evidence:** Code selects server-side PostgreSQL through `OSAAH_POSTGRES_URL`. The actual configured target and login role were not inspected. Historical Vercel notes are not current verification.
- **Still needed:** Authorized operator verifies Preview project/environment scope privately, then returns only non-secret results for `current_database()`, `current_user`, `session_user`, server/project identity, TLS verification, role attributes (`rolsuper`, `rolbypassrls`, `rolcreaterole`, `rolcreatedb`), memberships, and schema privileges. Do not share a URL or secret.
- **Approver:** Vercel project owner and Supabase/database owner.
- **Pass condition:** Preview is proven to use a separate non-Production target and independent session secret; the effective runtime role is identified and is not a superuser, owner, or `BYPASSRLS` role unless an explicitly reviewed exception has compensating controls.
- **Blocks:** Migration design finalization **yes**; rehearsal **yes**; Production cutover **yes**.

## 4. Complete catalog and migration history

- [ ] **Current evidence:** The captured public catalog contains 12 tables and 77 columns, 12 primary keys, 11 unique constraints, 15 foreign keys, eight checks, 27 indexes, six sequences, no public views/routines/triggers, and no `public.schema_migrations`. All 12 tables have RLS enabled and not forced. Current schema/sequence/function grants, ownership, dependencies beyond the captured inventory, and runtime identity remain incomplete.
- **Still needed:** Fresh read-only fingerprint of every relevant schema, object, owner, constraint, index, sequence, grant, role membership, policy, dependency, migration ledger, and aggregate row count immediately before rehearsal.
- **Approver:** Database operator and application migration reviewer.
- **Pass condition:** Catalog output is timestamped, tied to the verified project ref, reviewed against the migration plan, and unchanged between preflight and execution; unknown objects cause an abort.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## 5. Grants, RLS, and least-privilege access

- [ ] **Current evidence:** Each of `anon`, `authenticated`, and `service_role` has reported `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` table privileges on all 12 public tables. Three `PUBLIC SELECT` policies named `Allow anon read access` on `classes`, `students`, and `subjects` were reported with unrestricted `USING (true)`. Other nine tables had no reported policies. RLS is enabled but not forced. `TRUNCATE` is not constrained by RLS. Effective reachability depends on API exposure, role membership, and actual runtime identity.
- **Still needed:** Complete schema/sequence/function privileges, role membership and `BYPASSRLS` state, PostgREST exposure, query dependencies, and reviewed per-table RLS/grant acceptance matrix.
- **Approver:** Security reviewer, database owner, and application owner.
- **Pass condition:** Browser-facing roles cannot read or change private school records or truncate application tables; server runtime is limited to required objects and operations; policies and negative tests prove the approved school and Parent scopes. No blanket revoke is applied before dependency review and recovery confirmation.
- **Blocks:** Executable migration **yes**; rehearsal **yes**; Production cutover **yes**.

## 6. Existing role mapping to the eight OSAAH runtime roles

- [ ] **Current evidence:** Six source role names/assignments were observed: `accountant`, `admin`, `assistant_headteacher`, `headteacher`, `proprietor`, and `teacher`, one assignment per role. `accountant` has a code alias to `ACCOUNTANT_BURSAR`; the other four non-admin staff labels normalize to corresponding keys. These observations do not prove permission equivalence.
- **Still needed:** Owner-approved mapping and permission matrix for all eight roles: Proprietor, Administrator (`SCHOOL_ADMIN` in runtime), Headteacher, Assistant Headteacher, Accountant (`ACCOUNTANT_BURSAR`), Teacher, Parent, and Admission Officer (`ADMISSIONS_OFFICER`). Identify how Parent identities/relationships are sourced; the six source roles contain no observed Parent or Admission Officer role.
- **Approver:** School owner and role/authorization owner.
- **Pass condition:** Each existing account and assignment is mapped by verified stable identifier to one approved role; every permission is reviewed against route/API checks; no mapping depends on row order or assumed semantics.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## 7. Existing `admin` mapping

- [ ] **Current evidence:** The source label `admin` normalizes to `ADMIN`. Application aliases include `ADMINISTRATOR` and `SCHOOL_ADMINISTRATOR` → `SCHOOL_ADMIN`, but do not map bare `ADMIN`.
- **Still needed:** Explicit owner decision whether this account is the OSAAH Administrator/`SCHOOL_ADMIN`, another role, or should be disabled pending verification.
- **Approver:** School owner; application security reviewer confirms the selected runtime key and permissions.
- **Pass condition:** Decision is documented against the account’s verified identity and least-privilege role permissions, with a tested dashboard and allow/deny set.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## 8. Credential recovery for the six existing users

- [ ] **Current evidence:** The observed `users` schema has no `password_hash`; application login requires a supported password hash. The missing value cannot be reconstructed from the observed fields.
- **Still needed:** Approved password-reset/enrollment process, verified user identity, notification and support procedure, rate limiting/expiry, first-login behavior, and session revocation plan. Do not put temporary passwords or hashes in SQL, reports, or logs.
- **Approver:** School account owner and application security owner.
- **Pass condition:** Each retained user can complete the secure process, authenticate successfully in isolated Preview, and receives only the approved role; invalid credentials fail generically and are rate-limited.
- **Blocks:** Migration authoring **yes for authentication cutover**; rehearsal **yes**; Production cutover **yes**.

## 9. Session schema and signing-secret readiness

- [ ] **Current evidence:** Existing `auth_sessions` has `id`, `user_id`, `token_hash`, `expires_at`, and `created_at`; runtime expects `school_id`, `revoked_at`, and `last_used_at` as well. Captured row count was zero. Code uses signed session cookies and a 30-minute session TTL; signing requires an `OSAAH_SESSION_SECRET` of at least 32 characters. Current Preview secret scope/value independence was not verified.
- **Still needed:** Reconciled schema, unique/index and expiry/revocation behavior, secure server-side secret configured independently per Preview/Production, secret rotation and cookie attributes, and observed create/restore/expire/logout behavior.
- **Approver:** Application owner, security reviewer, and Vercel environment owner.
- **Pass condition:** Session lifecycle tests pass against isolated PostgreSQL; Preview and Production secrets are independently generated, server-only, and never logged; logout/revocation and expiry are enforced.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## 10. Parent-to-student relationship and authorization

- [ ] **Current evidence:** `parent_student_links` is absent; captured `students` count was zero. Runtime expects `parent_student_links` and checks active relationship status. `students.parent_id` in the existing catalog does not prove equivalent semantics.
- **Still needed:** Authoritative parent-child source, relationship status/consent rules, duplicate/conflict process, stable student and parent IDs, and an owner-reviewed import mapping. No Parent mapping should be invented.
- **Approver:** School registrar/records owner, Parent portal owner, and security reviewer.
- **Pass condition:** Active linked Parents see only their linked children; unlinked, inactive, and mismatched Parent identities see no child data; relationship counts and keys reconcile.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## 11. Preview database and session-secret isolation

- [ ] **Current evidence:** The audited Supabase project is identified as Production; a separate non-Production Supabase target and current Vercel Preview variable scopes were not verified in this audit.
- **Still needed:** Approved isolated Supabase project/ref, private confirmation that Preview `OSAAH_POSTGRES_URL` points only there, verified TLS certificate validation, independent Preview `OSAAH_SESSION_SECRET`, and absence of conflicting runtime URLs.
- **Approver:** Vercel project owner and Supabase project owner.
- **Pass condition:** An operator proves the Preview deployment’s database identity/role without revealing secrets, and all tests use only this target. No Production credential is copied into Preview.
- **Blocks:** Migration rehearsal **yes**; Production cutover **yes**.

## 12. Migration rehearsal, validation, rollback, and sign-off

- [ ] **Current evidence:** The canonical baseline has 159 tables and six views. The existing reconciliation migration is pinned to a different seven-table empty starter catalog and must not be run against the observed 12-table schema with populated identity/role rows. Local PGlite tests are not hosted rehearsal evidence.
- **Still needed:** Reviewed new migration plan for the actual catalog; exact preflight/abort conditions; isolated rehearsal; before/after key/count and FK checks; acceptance tests for auth, all roles, Parent, admissions, Fee Hub, payments, attendance, results and dashboards; verified restore and rollback operator; log redaction review.
- **Approver:** School owner, database change owner, application owner, and security reviewer.
- **Pass condition:** All acceptance evidence is attached to the change; exact migration hash, target, window, rollback steps, and go/no-go owner are recorded; no unexplained count/key differences remain.
- **Blocks:** Migration authoring **yes**; rehearsal **yes**; Production cutover **yes**.

## Owner decision record

Record approvals and decisions here before advancing. Do not include credentials, personal records, or password-reset tokens.

| Decision | Owner | Date (UTC) | Evidence/reference | Approved? |
|---|---|---|---|---|
| Authoritative source and recovery point |  |  |  | [ ] |
| Eight-role and `admin` mapping |  |  |  | [ ] |
| Credential recovery and Parent relationship plan |  |  |  | [ ] |
| Least-privilege grants/RLS and Preview isolation |  |  |  | [ ] |
| Rehearsal and rollback acceptance |  |  |  | [ ] |
| Production migration approval (separate change) |  |  |  | [ ] |

**No production migration, account change, grant change, RLS change, or deployment is authorized by this checklist.**
