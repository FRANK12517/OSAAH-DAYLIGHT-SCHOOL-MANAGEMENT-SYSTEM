# OSAAH Supabase Forensic Audit and Release-Gate Report

**Decision: BLOCKED — do not connect Preview to a database, migrate, or cut over Production.**

## Scope and repository baseline

This report records the forensic and release-readiness work performed in the existing `codex/schema-reconciliation` worktree. The baseline before this report was written was commit `b1da3b90e2f2fbb530ad4c12e01bd7858b397495`, branch `codex/schema-reconciliation`, with no configured upstream. `main`/`origin/main` was at `4872f48` and 15 commits ahead of that cached reference. The worktree already contained unrelated and in-progress changes; all were preserved. After the audit and tests, the reviewed worktree changes were recorded in a local branch commit. No GitHub push, merge, or deployment occurred.

The pre-existing protected release-gate report, route-audit JSON, and captured schema/reconciliation work remain untouched by this report. Local changes made during this phase are listed in the session’s final status; none changes a hosted database or Production configuration.

## Runtime path and authentication compatibility

- Application runtime selects PostgreSQL through server-side `OSAAH_POSTGRES_URL` in `src/ai/durable-stores.js` and `src/ai/postgres-database-adapter.js`. `DATABASE_URL` alone does not select runtime PostgreSQL or TiDB; it fails closed. The TiDB adapter is not the application runtime path.
- PostgreSQL TLS defaults to `OSAAH_PG_SSL_MODE=verify` with certificate verification enabled. Optional CA material is read from `SUPABASE_CA_CERT`, then `DB_SSL_CA`, then `OSAAH_PG_SSL_CA`. TLS disablement is restricted to loopback. A real TLS handshake was not performed.
- Session signing uses `OSAAH_SESSION_SECRET`. The adapter also accepts pool tuning variables `OSAAH_PG_POOL_MAX`, `OSAAH_PG_IDLE_TIMEOUT_MS`, `OSAAH_PG_CONNECT_TIMEOUT_MS`, and `OSAAH_PG_APPLICATION_NAME`.
- `src/auth.js` staff lookup requires `users.school_id`, `username`/`email`, `password_hash`, and `status`, plus role and permission keys from related tables. The observed catalog lacks `users.school_id`, `username`, `password_hash`, and `status`; `roles.role_key` and `roles.oversight_rank`; and `permissions.permission_key`. A previous read-only `EXPLAIN` reported SQLSTATE `42703` for `users.school_id`.
- Parent authentication requires `public.parent_student_links`, which was absent in the captured catalog; prior read-only `EXPLAIN` reported `42P01`. Existing student-parent relationships and parent access policy have not been verified.
- `auth_sessions` lacks runtime-required `school_id`, `revoked_at`, and `last_used_at`. The canonical school ID remains `sch_default_01`; no mapping or credential recovery plan is approved.
- These schema mismatches are independent blockers. No schema or data changes were made to address them.

### Source re-audit and local diagnostic correction — 2026-10-18

The current staff login lookup in `src/auth.js` joins `users`, `user_roles`, `roles`, `role_permissions`, and `permissions`; it reads `users.id`, `school_id`, `username`/`email`, `password_hash`, `status`, `roles.role_key`/`oversight_rank`, and `permissions.permission_key`. Session creation/restoration/revocation additionally reads and writes `auth_sessions.school_id`, `revoked_at`, and `last_used_at`. Parent authentication joins `parent_student_links` and role assignments. The canonical baseline migration contains these expected fields and relations, but that only demonstrates repository/migration compatibility—not compatibility with the captured hosted catalog or preservation of existing credentials/links.

The reviewed application SQL uses PostgreSQL `ON CONFLICT` upserts, and the PostgreSQL adapter converts application `?` bind markers to PostgreSQL positional markers outside of SQL literals/comments. The scan found no MySQL-only `ON DUPLICATE KEY`, `INSERT IGNORE`, `AUTO_INCREMENT`, or `LAST_INSERT_ID` syntax in application runtime JavaScript outside the separate TiDB adapter. PGlite coverage exercises representative PostgreSQL paths. This source scan does not establish that every runtime query has been exercised against real PostgreSQL or the hosted database.

One confirmed local diagnostics defect was corrected in `src/auth.js`: PostgreSQL SQLSTATEs `42703` and `42P01` were previously reported as generic query failures because categorization recognized only MySQL error codes. Diagnostics now classify missing columns, missing relations, missing schemas (`3F000`), and privilege failures (`42501`) separately while keeping the client response generic and retaining field redaction. Regression cases were added to `test/production-user-auth-migration.test.js`. `42501` is labeled a database privilege failure; the label does not assert whether RLS, grants, ownership, or another PostgreSQL permission mechanism caused it.

## Vercel configuration evidence

The authenticated Vercel dashboard was inspected read-only for the project `osaah-daylight-school-management-system` in team `frank12517s-projects`; the repository linkage appeared correct. Secret values were not opened or displayed.

Observed environment variable names and scopes:

| Variable | Observed scope | Notes |
|---|---|---|
| `OSAAH_POSTGRES_URL` | Preview and Production | Value and destination not inspected; Preview isolation is unproved. |
| `OSAAH_SESSION_SECRET` | Preview only | No shared variable was linked; no Production scope was observed. Production authentication configuration therefore needs owner review before any release. |
| `SUPABASE_CA_CERT` | Preview and Production | Value not inspected; does not prove successful TLS verification. |
| `DATABASE_URL` | Production only | Not used as the application PostgreSQL runtime selector. |
| `DB_SSL_CA`, `OSAAH_PG_SSL_CA`, `OSAAH_PG_SSL_MODE` | No entry observed in the displayed project variable list | No conclusion about external runtime injection; none was changed. |

The dashboard also listed Supabase integration variables (including `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL`, and related `POSTGRES_*` names) in Preview and Production. The reviewed application runtime does not use these as a fallback for `OSAAH_POSTGRES_URL`. Their values were not inspected. The project page showed an outstanding billing action; no billing setting was changed. The Vercel dashboard scopes do not establish which database a hidden URL targets. No Preview login, query, or deployment was attempted because the isolated Preview target is not proven.

## Supabase catalog and security findings

The repository’s existing read-only SQL Editor evidence identifies Supabase project `douzohkmnuqwbpwcezke`, PostgreSQL `17.11`, and the SQL Editor role as `postgres`. It is catalog evidence from the recorded audit time, not a fresh runtime connection. It must not be treated as proof that Preview uses this project or database.

Recorded catalog inventory: 12 `public` base tables, 77 columns, 12 primary keys, 11 unique constraints, 15 foreign keys, eight check constraints, 27 indexes, six sequences, five extensions, no public views/routines/non-internal triggers, and no `public.schema_migrations` ledger. Aggregate counts at capture time were six each in `users`, `roles`, and `user_roles`, and zero in nine other application tables. Counts are not proof that school data is lost; TiDB and backups have not been verified.

The catalog capture recorded RLS enabled but not forced on all 12 tables. Three public `SELECT USING (true)` policies applied to `classes`, `students`, and `subjects`. `anon`, `authenticated`, and `service_role` each had broad table privileges including `TRUNCATE`, and broad sequence privileges; default ACLs were also broad. `service_role` and `postgres` bypass RLS. These are material security findings requiring an approved least-privilege plan. No grants, ACLs, or policies were altered. The application’s actual database role remains unknown; SQL Editor’s `postgres` identity is not a substitute.

The canonical baseline migration describes a much larger OSAAH schema (159 tables, six views, 55 explicit indexes, 448 foreign-key references, RLS declarations). The observed 12-table catalog is not compatible with that baseline or the current login and parent-auth query contracts. The existing reconciliation script’s preconditions must be validated against a verified isolated target; no migration was applied.

## Data authority and recovery

The authoritative school-data source is **undetermined**. No authorized TiDB catalog/count evidence or backup export/restore evidence was obtained in this phase. Supabase’s empty school-data tables do not establish data loss. No student or parent record contents were read, and no records were copied.

There is no verified recovery point or successful restore-to-separate-project result in the evidence reviewed. Before any migration, the owner must identify the authoritative source, prove a recoverable backup by restoring it to an isolated target, reconcile permanent student IDs and account/role/parent relationships, and approve credential recovery for accounts whose password hashes are not present in the observed Supabase catalog.

## Local validation and end-to-end evidence

The local suite exercises unit, fixture, and PGlite-compatible behavior. The structural migration rehearsal uses synthetic fixtures in PGlite and does **not** count as a real PostgreSQL or hosted Supabase test. A real local PostgreSQL server/client/container runtime was not available, and no software was installed.

Previously completed checks in this worktree:

- `npm test` after the diagnostic category fix: **1,482 passed, 0 failed, 0 cancelled, 2 skipped**. This required local loopback access for the repository’s HTTP test servers; Python and Chromium executable paths were process-scoped only.
- The two skips are the top-level cases in `test/staff-role-auth-browser.test.js`, skipped by default unless `OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1` and a Chromium-compatible browser are available. They are useful local synthetic evidence and should be run for a complete local auth test report, but they are not hosted release verification. Explicit local execution with loopback access passed **9/9 Node test cases/subtests** (the suite’s synthetic role matrix, session restoration, logout, administrator boundary, and invalid-password flow). Under the default full-suite command the two opt-in top-level cases remain skipped.
- `npm run test:supabase`: **27/27 passed** (local adapter, CLI, and PGlite coverage; no hosted application database).
- `npm run supabase:schema:validate` and `npm run supabase:migration:validate`: **passed** static migration validation (159 tables, six views, 55 explicit indexes, 448 foreign-key references, RLS declarations present).
- `node --test test/captured-12-table-structural-migration.test.js test/production-user-auth-migration.test.js`: **20/20 passed** (PGlite and fake-error tests; no real PostgreSQL rehearsal).
- After the diagnostic taxonomy change, focused PostgreSQL/auth/session/Supabase tests: **38/38 passed**, including SQLSTATE classification/redaction regressions; adapters/PGlite/CLI only.
- `node --test test/postgres-integration-harness.test.js`: **2/2 passed** in the earlier focused run; these verify guard behavior and do not connect to PostgreSQL.
- `git diff --check`: **passed**; Git emitted only existing LF-to-CRLF working-copy warnings.
- No hosted application connection, Preview login, session restore, role dashboard, Parent Portal, or school workflow was tested against Supabase.
- No real PostgreSQL structural rehearsal ran.

The local synthetic browser coverage checks staff role routing and protected routes, but cannot prove hosted data, permissions, or connection health. Parent login remains untested; owner approval of parent authentication semantics and a safe test account is required.

## Release gate status

| Gate | Status | Evidence / blocker |
|---|---|---|
| Repository changes preserved | PASS | Existing worktree changes retained and recorded in a local commit; no reset, cleanup, push, merge, or deployment. |
| SQLSTATE-based diagnostic classification | PASS (local) | Regression tests cover missing column/table/schema and permission SQLSTATEs; HTTP response remains generic. |
| Runtime adapter/selector identified | PASS | Explicit PostgreSQL URL selector; no runtime TiDB fallback. |
| Preview database target is isolated and non-production | BLOCKED | `OSAAH_POSTGRES_URL` value/destination not inspected; owner must privately verify and provision isolation. |
| Preview session secret and TLS CA ready | BLOCKED | Preview scope names observed; secret values/strength and certificate chain not verified. |
| Production session-signing configuration | BLOCKED | Vercel project list showed `OSAAH_SESSION_SECRET` Preview-only and no shared variable; release owner must resolve via approved change process. |
| Actual application runtime identity/privileges | BLOCKED | No application connection; SQL Editor `postgres` is not the runtime role. |
| Hosted schema compatible with application | FAIL | Recorded missing staff-auth, session, and parent-link objects/columns. |
| Least-privilege grants/RLS | FAIL | Recorded broad API-role table/sequence/default privileges and public unrestricted read policies. |
| Authoritative data source and backup restore | BLOCKED | TiDB/backups and restore point not verified. |
| Real PostgreSQL structural rehearsal | BLOCKED | No disposable local PostgreSQL target available. |
| Hosted Preview workflows and role boundaries | BLOCKED | No safe target or hosted runtime test. |
| Production deployment/cutover | BLOCKED | Multiple data, schema, security, runtime, and release gates remain. |

**Release decision:** BLOCKED. Do not deploy, point Preview at the existing Supabase main database, apply migrations, transfer records, or claim OSAAH is connected to Supabase until the gates above pass.

## Change and safety record

Local changes in this phase are limited to PostgreSQL error-category mapping and regression tests plus these reports. No hosted database, Vercel variable, alias, schema, grant, RLS policy, account, or Production deployment was changed. No real login was attempted. Existing user modifications were preserved.
