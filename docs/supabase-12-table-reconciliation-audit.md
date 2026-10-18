# OSAAH Supabase schema and migration-readiness audit

- **Status:** BLOCKED before migration execution or production cutover
- **Audit branch baseline:** `codex/schema-reconciliation` at `02b0c0b43be1bd9e7d3b350f91a3bf1ddff1520d`
- **Target:** Supabase project `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`)
- **Scope:** read-only catalog review and local validation; no hosted database, Vercel configuration, account, or deployment was changed.

## Evidence and limits

The Supabase Dashboard SQL Editor showed the expected project reference and name. Read-only catalog queries were run there. They did not retrieve user rows, credentials, or personal data. Catalog evidence below describes the observed `public` schema at audit time; it is not a guarantee that the catalog has not changed since. The dashboard account did not expose a verified backup/restore point or identify the application’s direct PostgreSQL login role. Current Vercel Preview target isolation was not freshly verified in this audit.

The database reports PostgreSQL 17.11. The migration ledger relation `public.schema_migrations` is absent. The public schema has 12 base tables, no views, no public routines, no public triggers, six sequences, and five installed extensions (`pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`). The read-only catalog counts are 12 primary keys, 11 unique constraints, 15 foreign keys, eight check constraints, and 27 indexes.

### Observed public columns

The catalog returned 77 columns across these tables. Types, nullability, identity/default details shown here are from `information_schema.columns`/PostgreSQL catalog output.

| Table | Observed definition (column: type and notable attributes) |
|---|---|
| `assessments` | `id bigint NOT NULL IDENTITY ALWAYS`; `student_id integer`; `subject_id integer`; `academic_term text NOT NULL`; `academic_year text NOT NULL`; `class_score numeric(5,2) DEFAULT 0.00`; `exam_score numeric(5,2) DEFAULT 0.00`; `total_score numeric(5,2) GENERATED ALWAYS AS (class_score + exam_score) STORED`; `remarks text`; `created_at timestamptz DEFAULT now()`; `updated_at timestamptz DEFAULT now()` |
| `attendance` | `id bigint NOT NULL IDENTITY ALWAYS`; `student_id integer`; `class_id integer`; `attendance_date date NOT NULL`; `status text NOT NULL`; `recorded_by uuid`; `created_at timestamptz DEFAULT now()` |
| `auth_sessions` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `user_id uuid NOT NULL`; `token_hash text NOT NULL`; `expires_at timestamptz NOT NULL`; `created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())` |
| `classes` | `id integer NOT NULL IDENTITY ALWAYS`; `class_name text NOT NULL`; `section text`; `capacity integer DEFAULT 30`; `created_at timestamptz DEFAULT now()` |
| `fee_payments` | `id integer NOT NULL IDENTITY ALWAYS`; `student_id integer`; `amount_paid numeric(10,2) NOT NULL`; `payment_method text`; `reference_number text`; `academic_term text NOT NULL`; `academic_year text NOT NULL`; `recorded_by uuid`; `created_at timestamptz DEFAULT now()` |
| `permissions` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `name text NOT NULL`; `description text`; `created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())` |
| `role_permissions` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `role_id uuid NOT NULL`; `permission_id uuid NOT NULL`; `created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())` |
| `roles` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `name text NOT NULL`; `description text`; `created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())` |
| `students` | `id integer NOT NULL IDENTITY ALWAYS`; `student_id text NOT NULL`; `first_name text NOT NULL`; `last_name text NOT NULL`; `gender text`; `date_of_birth date`; `class_id integer`; `parent_id uuid`; `enrollment_status text DEFAULT 'active'::text`; `created_at timestamptz DEFAULT now()`; `updated_at timestamptz DEFAULT now()` |
| `subjects` | `id integer NOT NULL IDENTITY ALWAYS`; `subject_code text NOT NULL`; `subject_name text NOT NULL`; `class_id integer`; `created_at timestamptz DEFAULT now()` |
| `user_roles` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `user_id uuid NOT NULL`; `role_id uuid NOT NULL`; `created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())` |
| `users` | `id uuid NOT NULL DEFAULT gen_random_uuid()`; `email text NOT NULL`; `full_name text NOT NULL`; `role text NOT NULL`; `phone_number text`; `is_active boolean DEFAULT true`; `created_at timestamptz DEFAULT now()`; `updated_at timestamptz DEFAULT now()` |

The catalog reported all 12 public tables with RLS enabled and not forced. It returned three policies, all `SELECT` policies applying to `PUBLIC`: `classes`, `students`, and `subjects`, each named `Allow anon read access`. Previously captured policy definitions show unrestricted `USING (true)`. No policies were returned for the other nine tables.

The table-grant aggregate covered all 12 public tables. `anon`, `authenticated`, and `service_role` each had `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges on every table (84 privilege rows per grantee). RLS does not filter `TRUNCATE`; it is not a row-level operation. Therefore the broad table grants are a serious exposure if the API roles are usable against this schema. The three unrestricted read policies also make rows in `classes`, `students`, and `subjects` selectable to grantees with `SELECT`. This report records the risk; it does not alter any grant or policy. Effective access still depends on role membership, API exposure, and connection path.

The catalog returned 15 foreign keys, including relationships from assessments, attendance, and payments to students/classes/users; students to classes/users; sessions to users; and role assignments to roles/permissions. No views, routines, or triggers were found in `public`. The five extension names are listed above. The initial capture did not establish schema ownership, schema-level privileges, sequence privileges, function privileges, or the actual role used by `OSAAH_POSTGRES_URL`; those were checked in the fresh catalog pass below. Do not treat the SQL Editor role as the application runtime role.

### Aggregate data observations

The most recent captured aggregate counts reported six rows each in `users`, `roles`, and `user_roles`, and zero rows in each of `assessments`, `attendance`, `auth_sessions`, `classes`, `fee_payments`, `permissions`, `role_permissions`, `students`, and `subjects`. These are counts only and can change after inspection. A joined aggregate showed one assignment for each of the six role labels `accountant`, `admin`, `assistant_headteacher`, `headteacher`, `proprietor`, and `teacher`; each matching `users.role` value agreed with its joined role name. No personal fields or records were retrieved. Empty Supabase school-data tables do not establish that the records are lost: TiDB, exports, or backups have not been verified in this phase.

## Application authentication and authorization contract

The runtime uses a server-side PostgreSQL adapter selected by `OSAAH_POSTGRES_URL`; application code does not use Supabase Auth/PostgREST as the school-login authority. The actual database role behind the deployed URL remains unknown because secret values and connection details were not inspected. The runtime URL must remain server-only.

In `src/auth.js`, staff lookup expects `users.id`, `school_id`, `username`/`email`, `password_hash`, and `status`, and joins role/permission data using `user_roles`, `roles.role_key`/`oversight_rank`, `role_permissions`, and `permissions.permission_key`. The live catalog lacks `users.school_id`, `username`, `password_hash`, `status`, `roles.role_key`, `roles.oversight_rank`, and `permissions.permission_key`. Read-only `EXPLAIN` previously reproduced the missing `users.school_id` as SQLSTATE `42703`.

Password verification expects the application’s stored password-hash representation (bcrypt or the supported encoded form). There is no `password_hash` column in the observed `users` table. No safe migration can recreate these values from the observed data. Existing accounts need an owner-approved credential recovery/enrollment process; no password reset or account change is part of this audit.

The six observed labels map as follows against `src/auth.js` canonicalization: `accountant` is explicitly aliased to `ACCOUNTANT_BURSAR`; `assistant_headteacher`, `headteacher`, `proprietor`, and `teacher` normalize to corresponding uppercase role keys. `admin` normalizes to `ADMIN`, but application aliases do not establish whether it should mean `SCHOOL_ADMIN` or another role. That mapping is an owner decision. The current `permissions` and `role_permissions` tables were empty at count time; any move must preserve the effective authorization model and cannot assume the existing assignments express the eight runtime roles. There are eight OSAAH runtime role boundaries; this six-role source map is not sufficient to prove all eight.

Parent login expects `parent_student_links` with parent identity, telephone, and link status fields. That relation is absent; read-only `EXPLAIN` previously returned `42P01`. The current `students` table has a nullable `parent_id`, but it had zero rows at count time and does not establish the intended parent-to-student authorization semantics. Creating an empty link table would not make Parent access operational.

Session restoration expects `auth_sessions.school_id`, `revoked_at`, and `last_used_at` in addition to token/user/expiry fields. Those fields are absent. The current `auth_sessions` count was zero, so there are no reported live rows to translate, but that does not resolve the authentication contract. The canonical single-school identifier is `sch_default_01`; current `users` has no `school_id`, and the observed catalog has no `schools` table.

## Canonical schema comparison and migration history

The canonical baseline `supabase/migrations/202610150001_osaah_daylight_schema.sql` defines 159 tables, six views, 448 foreign-key references, RLS on every table, and the school identity `sch_default_01`. It is not the observed 12-table schema. The existing `202610150002_reconcile_existing_supabase.sql` was prepared for a different seven-table starter catalog and has strict table/signature/empty-row preconditions. It cannot safely reconcile the observed 12-table catalog, which includes three populated authentication/authorization tables. The absent `public.schema_migrations` relation means the expected migration ledger is not present; do not mark scripts applied or rerun migrations based on assumption.

No hosted migration was run. Do not apply the baseline or seven-table reconciliation migration to this target. Static/PGlite success does not establish compatibility with the hosted catalog.

## Proposed data-preserving migration design (not executable and not approved)

An eventual migration needs a reviewed manifest and a separate isolated rehearsal. A safe design should be additive and staged:

1. **Preflight and freeze:** confirm project ref/environment, backup restore test, source authority, and maintenance window. Snapshot exact table/column/constraint/index/policy/grant/ownership/dependency fingerprints and aggregate counts. Abort on any drift, unexpected object, missing recovery point, active writes, or unapproved mapping.
2. **Preserve original objects:** in a transaction on the isolated rehearsal only, move the observed 12 source tables and their dependent indexes/sequences/constraints intact into a private, non-API-exposed legacy schema. Revoke client access there only as part of the explicitly reviewed rehearsal. Never drop/truncate or overwrite them. If dependency analysis shows a move is unsafe, stop and choose a reviewed copy-and-rename design.
3. **Install canonical schema:** apply the canonical schema to new public names, preserving one school with ID `sch_default_01`; establish server-only access, reviewed RLS and grants, constraints, indexes, and migration-ledger handling. Do not run the current seven-table reconciliation file unchanged.
4. **Map only approved records:** prepare a source-to-target mapping that preserves source user/role/assignment identifiers where types allow; explicitly map `email`, `phone_number`, and `is_active`; require owner-approved canonical role mapping, including `admin`. Do not fabricate password hashes. Leave accounts unable to authenticate until a separate, controlled credential-reset/enrollment process is approved and verified. Do not create Parent links without an authoritative source and reviewed parent-child mapping.
5. **Validate before cutover:** compare aggregate counts and stable key sets; check unique constraints, FK orphans, numeric totals, date/time handling, school scoping, grants/RLS, session behavior, and audit history. Run staff, invalid-login, session-restore/revoke, all eight role boundaries, Parent linked/unlinked/cross-school denial, admissions, Fee Hub, payments, attendance, assessment/results, reports, and dashboards against synthetic data in isolated Preview.
6. **Cutover and rollback gate:** only after owner approval, verified source/target reconciliation, successful restore test, and accepted Preview evidence, switch Preview first. Keep TiDB and the legacy archive unchanged during the rollback window. Production cutover and retirement require a separate explicit approval.

Before cutover, stop writes or capture and reconcile all post-snapshot deltas; otherwise renaming back is not a safe rollback. A transaction rollback is available only before commit. After commit, rollback needs the retained original schema plus a reviewed reverse/delta procedure or verified restore point. No restore point or source export was verified here, so a rollback plan is not yet executable.

## Recovery, Preview, and owner gates

| Gate | Status | Evidence / next action |
|---|---|---|
| Supabase target identity | **PASS (identity only)** | Dashboard displayed ref `douzohkmnuqwbpwcezke` and project name `OSAAH DAYLIGHT SCHOOL`. This does not prove Preview is pointed at it. |
| Current catalog inventory | **PASS (captured public catalog)** | 12 tables, 77 columns, constraints/index counts, RLS, policies, grants, sequences/extensions summarized above. Ownership/schema/sequence/function effective privileges and runtime role remain incomplete. |
| Data source authority | **BLOCKED** | Supabase counts do not establish source of truth. Obtain authorized aggregate inventory/export evidence from TiDB and any other backups without exposing personal records. |
| Restorable recovery point | **BLOCKED** | No backup/PITR inventory or successful restore-to-new-project evidence was available. Owner must identify a point-in-time backup for the exact project and authorized recovery operator; rehearse restore to a separate project if possible. |
| Isolated Supabase Preview DB | **BLOCKED** | Current catalog target is production. Provision or identify a separate non-production Supabase project/database and prove its ref/region and non-production isolation. |
| Vercel Preview configuration | **BLOCKED / not freshly verified** | Historical audit notes say Preview lacked `OSAAH_POSTGRES_URL`; do not treat that as current. In the correct Vercel project/team, inspect variable names/scopes only, confirm a Preview-only URL to the approved isolated database, verified TLS CA, and independent Preview session secret. Never copy production secrets. |
| Runtime database role | **BLOCKED** | `OSAAH_POSTGRES_URL` is the code selector, but do not inspect or print its value. An authorized operator should run a safe session query (`current_database()`, `current_user`, `session_user`, `inet_server_addr()`, and `version()`) through the configured Preview runtime and report only non-secret identity/role data. |
| User credential continuity | **BLOCKED** | Source catalog has no `password_hash`. Owner must approve secure reset/enrollment and account notification process. Do not infer or seed passwords. |
| Role/permission preservation | **BLOCKED** | Owner must map the six source labels and assignments to canonical runtime roles and permission sets; specifically resolve `admin` and account for all eight OSAAH roles. |
| Parent data authorization | **BLOCKED** | Identify authoritative parent-child relationship source and approve mapping. `parent_student_links` is absent and no student rows were reported. |
| Hosted application workflow validation | **BLOCKED** | No authenticated Preview test against an isolated Supabase target was performed. Local tests do not substitute for it. |

### Required read-only checks before design approval

- Refresh catalog and aggregate counts immediately before rehearsal; collect schema/table/sequence ownership and schema/sequence/function grants plus dependency inventory.
- Capture all table grants and all policy definitions for every schema exposed through PostgREST; review effective role memberships and `BYPASSRLS` without revealing secrets.
- Verify the exact runtime role using an authorized non-production Preview connection; no database URL or credential values should be shared.
- Verify a recovery point and perform a restore-to-new-project rehearsal; establish the authorized operator and recovery procedure.
- Inventory TiDB and backups to identify the authoritative school records. Compare aggregate counts and non-sensitive key-set hashes only; do not export personal data into this report.
- Approve role/permission mapping, account recovery, parent-student linkage, school ID handling, archive retention, maintenance window, and rollback ownership.

## Local validation evidence

The audit branch contains the reviewed local validator/reconciliation fixes from commit `02b0c0b`; this update changes documentation only.

- `npm run test:supabase`: **26/26 passed** (local PGlite/CLI only).
- `node --test test/parent-auth-database-diagnostics.test.js test/durable-auth-sessions.test.js test/production-user-auth-migration.test.js test/proprietor-authentication.test.js test/staff-authentication-part3.test.js test/serverless-auth-session.test.js`: **30/30 passed** (local HTTP fixtures; loopback access enabled; no hosted connection).
- `node scripts/validate-supabase-migration.mjs`: passed static validation (159 tables, six views, 55 explicit indexes, 448 foreign-key references, RLS enabled for every table).
- `git diff --check`: passed after the report edit.
- These checks do not connect to the hosted database or prove application login works against the 12-table schema. No hosted migration, Preview login, production setting, or deployment was changed.

## Release decision

**BLOCKED.** The target catalog and schema incompatibilities are now substantially better characterized, but no restorable recovery point, authoritative school-data source, isolated Preview database, actual runtime database role, password recovery mechanism, complete role mapping, or Parent relationship mapping has been verified. Do not execute a hosted migration or cut over. This is not a claim that school data is lost or that authentication has been repaired.

## Fresh read-only source catalog pass — 2026-10-18

The latest pass used the Supabase Dashboard SQL Editor for project `douzohkmnuqwbpwcezke`, displayed as `OSAAH DAYLIGHT SCHOOL`, on the dashboard's `main` branch. The connection returned database `postgres`, `current_user=session_user=postgres`, PostgreSQL `17.11`, and search path `"$user", public, extensions`. This positively identifies the SQL Editor target. It does **not** verify the Vercel Preview target or `OSAAH_POSTGRES_URL` runtime connection.

Read-only queries returned the same 12 base tables and 77 public columns. The current public catalog still has 12 primary keys, 11 unique constraints, 15 foreign keys, eight check constraints, 27 indexes, no views, no public routines, no non-internal public triggers, six sequences, and no `public.schema_migrations` relation. The table constraints and index definitions were queried from PostgreSQL catalogs; the full reproducible query set is in [supabase-captured-source-catalog.sql](supabase-captured-source-catalog.sql). All six sequences and all twelve tables are owned by `postgres`; the tables have RLS enabled and `FORCE ROW LEVEL SECURITY` false. No schema changes were made.

The fresh aggregate counts were `users=6`, `roles=6`, and `user_roles=6`; each of `assessments`, `attendance`, `auth_sessions`, `classes`, `fee_payments`, `permissions`, `role_permissions`, `students`, and `subjects` was zero. These are aggregate counts only, queried under the SQL Editor's `postgres` role; no account, student, parent, session, or other row contents were read. This does not establish that school data is lost or that this Supabase target is the authoritative source.

The refreshed policy inventory contained exactly three public policies, each permissive `SELECT` for role `PUBLIC` with `USING (true)`: `classes`, `students`, and `subjects`. No policy was present for the other nine tables. Thus a role with `SELECT` on those three can read every matching row under these policies; with no policy, RLS denies row access for non-bypass roles on the other tables, subject to role and view/function execution context. `postgres` and `service_role` both have `BYPASSRLS`; `anon` and `authenticated` do not. The SQL Editor was connected as `postgres`, not as the app runtime identity.

The refreshed table privilege summary confirms that each of `anon`, `authenticated`, and `service_role` has all seven table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) on all 12 tables, with no grant option. Column privileges were also returned across the public tables. The public schema grants `USAGE` to `anon`, `authenticated`, and `service_role`; schema `CREATE` is held by `pg_database_owner`. All six sequences grant `USAGE`, `SELECT`, and `UPDATE` to those three API roles. Default ACLs for objects created by both `supabase_admin` and `postgres` grant broad table privileges and sequence privileges to `anon`, `authenticated`, and `service_role`, so future objects may inherit the same exposure. `service_role` bypasses RLS. These are observed database grants, not proof that every API surface exposes arbitrary SQL; nevertheless, this is a **security blocker** that requires a reviewed least-privilege migration and runtime-path analysis before Preview/cutover. No grant, policy, or ACL was changed.

The role catalog reports `anon` and `authenticated` as non-login, non-bypass roles; `service_role` as non-login with `BYPASSRLS`; and `postgres` as login-capable with `BYPASSRLS` (not marked superuser). Role membership metadata was queried, but it does not identify the active Vercel database identity. The five installed extensions remain `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`. Public views, routines, and triggers remain absent. No `public.schema_migrations` relation or columns were found.

### Rehearsal and connection readiness update

- **Supabase SQL Editor connection:** verified to the intended project for read-only catalog queries only. This is not `SUPABASE CONNECTION VERIFIED` for the application runtime.
- **Real PostgreSQL rehearsal:** still blocked. No approved local disposable server or test URL/acknowledgement pair is configured; the previous local `initdb` probe stalled and was cleaned up without touching the existing PostgreSQL data directory. No migration was applied to any database. The harness requires `OSAAH_PG_INTEGRATION_URL` to name a local database with a name beginning `osaah_test_` and `OSAAH_PG_INTEGRATION_DISPOSABLE=I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE`; it rejects remote/Supabase/Production hosts. It currently sets its test client TLS mode to `disable`, which is intended for loopback-only disposable PostgreSQL and must not be used for a hosted target.
- **Backup/recovery:** still unverified. The SQL Editor pass provides no backup/PITR or successful restore evidence. Owner must confirm a recoverable point for the identified project and arrange a restore-to-separate-project rehearsal before migration planning can be approved.
- **Authoritative data source:** still unverified. Supabase has six user rows and six assignments but no student, class, payment, attendance, assessment, or permission rows at this capture time. TiDB and backups have not been accessed or verified, so Supabase emptiness is not evidence of data loss.
- **Runtime/Preview:** still unverified. Obtain an authorized Preview-only configuration aimed at an isolated non-production Supabase project, then validate the actual database identity/role through the application runtime without disclosing the URL. Do not use the SQL Editor's `postgres` role as a substitute.
- **Migration gates:** the 12-table public catalog is not the 159-table canonical OSAAH application schema. Existing auth and role rows do not include the app's required password hashes, complete eight-role model, `school_id`, or parent-student relationship records. No migration is safe until an authoritative source, role/account/parent mapping, credential recovery process, backup/restore, full real-PostgreSQL rehearsal, and isolated Preview end-to-end workflow tests are verified.

### Latest local validation

- Focused PostgreSQL/auth/session set (8 files): **50/50 passed** with loopback access enabled; local tests only.
- `node --test test/captured-12-table-structural-migration.test.js`: **9/9 passed** (PGlite, not real PostgreSQL).
- `npm run test:supabase`: **27/27 passed** (local PGlite/CLI; no hosted application database).
- `node --test test/postgres-integration-harness.test.js`: **2/2 passed** (tests the harness's safety gates only; it does not connect to PostgreSQL).
- `node scripts/validate-supabase-migration.mjs`: **passed** static canonical baseline validation (159 tables, six views, 55 explicit indexes, 448 foreign-key references, RLS declarations present).
- `npm test` with process-scoped `PYTHON_EXECUTABLE=C:\Python314\python.exe` and loopback access enabled: **1,476/1,476 passed**. This exercises local mocks/fixtures and does not connect to Supabase or real PostgreSQL.
- `git diff --check`: **passed** (line-ending warnings only).
- `docs/supabase-captured-source-catalog.sql`: all 18 read-only catalog statements parsed and executed against local PGlite for syntax checking. That is not hosted source evidence; hosted evidence came from the Dashboard SQL Editor queries described above.

### Connection selector and Vercel verification — 2026-10-18

The application runtime reads `OSAAH_POSTGRES_URL`; a `DATABASE_URL` by itself fails closed and does not select the TiDB adapter. The PostgreSQL adapter defaults `OSAAH_PG_SSL_MODE` to `verify` and passes `rejectUnauthorized: true`. Optional CA PEM input is read in precedence order from `SUPABASE_CA_CERT`, `DB_SSL_CA`, then `OSAAH_PG_SSL_CA`. TLS disablement is accepted only for a loopback URL. Session signing reads `OSAAH_SESSION_SECRET`. Pool tuning variables are `OSAAH_PG_POOL_MAX`, `OSAAH_PG_IDLE_TIMEOUT_MS`, `OSAAH_PG_CONNECT_TIMEOUT_MS`, and `OSAAH_PG_APPLICATION_NAME`.

No expected PostgreSQL/session variables were present in the local process environment (names checked only). This says nothing about Vercel scopes. This worktree has no `.vercel/project.json` link. Vercel CLI `whoami` and `env ls` could not reach the CLI update/API endpoints (`fetch failed`), so Preview variable names/scopes and the Preview database target could not be verified. Do not interpret this as proof that the variables are absent. No URL was read or printed, no Preview deployment was created, and no runtime connection attempt was made.

No application compatibility migration was applied or generated against the public schema: the known authentication, role, permission, session, and Parent link mismatches lack verified credential and relationship mappings. The identified Supabase `main` catalog contains live identity/role rows and is not established as an isolated Preview target; do not use it for Preview integration until the owner provisions and verifies a separate non-production project/database.

No hosted schema, record, grant, RLS policy, credential, Vercel variable, alias, deployment, or Production setting was modified during this pass. The query tabs remain unsaved; no SQL was saved as a dashboard query.
