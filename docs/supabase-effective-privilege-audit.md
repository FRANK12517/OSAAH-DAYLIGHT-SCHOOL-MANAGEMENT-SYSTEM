# OSAAH Supabase Effective-Privilege Audit

- **Audit date:** 2026-10-18
- **Repository baseline:** `codex/schema-reconciliation` at `c48f9c3aa1d30d2275122053b347f01f497858be`
- **Working tree at start:** clean
- **Upstream:** none configured; `origin` points to the repository GitHub URL
- **Hosted target:** Supabase project `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`)
- **Scope:** read-only catalog, role, membership, and privilege inspection. No hosted object or data was modified.
- **Decision:** **BLOCKED**; do not change live grants or policies until the owner confirms recovery, data source, and runtime-role details.

## Evidence classification

### Confirmed by read-only evidence

The Supabase Dashboard was open on the project identified above. A read-only SQL Editor query returned `current_database() = postgres`, `current_user = postgres`, `session_user = postgres`, and search path `"$user", public, extensions`. Existing captured catalog evidence reports PostgreSQL 17.11 and 12 public base tables. This is the dashboard SQL Editor session, **not** the deployed OSAAH connection.

Role catalog checks returned:

| Role | Superuser | `BYPASSRLS` | `public` USAGE | `public` CREATE |
|---|---:|---:|---:|---:|
| `anon` | false | false | true | false |
| `authenticated` | false | false | true | false |
| `service_role` | false | true | true | false |
| `postgres` (SQL Editor session) | false | true | true | true |

Membership rows showed `authenticator` is a member of `anon`, `authenticated`, and `service_role`; `postgres` is a member of those roles and `authenticator`, among other platform roles. This means the roles available through Supabase's API role-switching path include a bypass-capable `service_role`. It does **not** prove OSAAH connects through PostgREST or uses that role. The SQL Editor's current role was `postgres`, whose `BYPASSRLS` setting makes it unsuitable as evidence of row filtering for application requests.

The live catalog inventory previously captured 12 public base tables, all with RLS enabled and none forced. The direct ACL and effective `has_table_privilege` checks establish that `anon`, `authenticated`, and `service_role` each have all seven table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) on all 12 public tables. Aggregate effective checks returned 12/12 for every checked operation; focused checks returned the same 12/12 for all seven privileges on `service_role`. `anon` and `authenticated` also returned 12/12 for `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`; earlier table ACL inventory records `REFERENCES` and `TRIGGER` for all 12 as well.

The public schema privilege check returned USAGE and no CREATE for `anon`, `authenticated`, and `service_role`. The dashboard `postgres` role has CREATE. The broad table ACLs therefore are not explained by `public` schema CREATE access, and they are still significant. Role membership and role switching determine which identities can exercise the underlying grants.

Existing read-only policy inventory records three permissive `SELECT` policies applying to `PUBLIC`, each with `USING (true)`, on `classes`, `students`, and `subjects`; there are no policies on the other nine tables. With RLS enabled and not forced, ordinary roles without bypass/ownership are filtered by policies for row-level operations. The unrestricted policies permit all rows to be selected from those three tables by roles with SELECT. **Student rows are therefore not protected from public reads by the observed policies.** No policy condition limits those reads to `sch_default_01`.

The previous inventory counted six rows in each of `users`, `roles`, and `user_roles`; zero rows in `students`, `classes`, `subjects`, `permissions`, `role_permissions`, `auth_sessions`, `assessments`, `attendance`, and `fee_payments`. These are aggregate counts only, not proof that school data does not exist in TiDB or backups. No personal fields were queried in this audit.

### Inferred risk requiring verification

- Grants are permissions to perform operations, not proof that an API route exposes arbitrary SQL. However, if an `anon` or `authenticated` SQL identity can reach the database, the table privileges include write and `TRUNCATE` capabilities. **RLS does not filter `TRUNCATE`**; RLS policy coverage is not a defense against that object privilege.
- The unrestricted public `SELECT` policies on `students`, `classes`, and `subjects` allow broad row visibility to roles with SELECT. The student policy is a sensitive-data exposure even though the current observed `students` count was zero.
- `service_role` and the SQL Editor `postgres` role both have `BYPASSRLS`. If OSAAH's direct PostgreSQL URL uses a service-role credential or another bypass/owner role, live RLS policies do not constrain that connection. Application-side authentication and RBAC remain necessary, but they do not remove the database compromise blast radius.
- Membership of `authenticator` in `service_role` makes service-role reachability relevant for the API role-switching model; verify the exact platform grant options and actual request role before describing effective API behavior. Do not infer that the app's direct PostgreSQL URL uses this path.
- A permissive `PUBLIC` policy is applicable to all database roles subject to RLS, while a `BYPASSRLS` role bypasses the policy entirely. Table grants plus policy text must be considered together.

## Application connection path

The server-side PostgreSQL adapter reads `OSAAH_POSTGRES_URL` in `src/ai/postgres-database-adapter.js`, and `src/ai/durable-stores.js` selects/loads that adapter. The adapter uses node-postgres directly and enforces certificate verification by default; no URL or secret value was read. OSAAH school login and server database access are application-managed and do not establish that Supabase Auth roles are the runtime identity.

The actual deployed role, target database, ownership, role memberships, and `BYPASSRLS` status for `OSAAH_POSTGRES_URL` remain **not verified**. The Dashboard Editor session and SQL role observations above are not a substitute. An authorized owner should privately verify the configured Preview target and have the application report only non-secret `current_database()`, `current_user`, `session_user`, role attributes, and host/project identity. Do not share the connection URL or credentials.

The `schema_migrations` ledger is absent from the captured public catalog. No public views, routines, or triggers were found in the captured inventory. Default privileges, all sequence ACLs, function ACLs, ownership/dependencies, and effective privileges of the actual OSAAH runtime role were not captured; they remain open audit items.

## Table-family policy matrix

All 12 currently observed public base tables have RLS enabled and not forced. Unless noted, `anon`, `authenticated`, and `service_role` have all seven table-level privileges on each observed table. Rows in this column are governed by RLS only for roles subject to RLS; `TRUNCATE`, ownership, and bypass roles are not protected by row policies.

| Family / observed relations | Current RLS and policy evidence | Access risk / current effective evidence | Required access and unresolved points | Isolated acceptance tests |
|---|---|---|---|---|
| Users, roles, permissions, sessions: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `auth_sessions` | RLS on, not forced. No policy on these six. | ACLs grant all seven operations to the three API roles. Ordinary `anon`/`authenticated` row queries have no matching policy; `service_role` bypasses RLS. Six users, roles, and role assignments were counted; permissions/session tables were empty. | Server login/session adapter needs narrowly scoped reads and lifecycle writes. Confirm runtime role, owner/bypass status, role schema mapping, and account recovery; do not expose hashes/tokens. | Login and invalid-login paths; session create/restore/revoke/expiry; deny browser enumeration and cross-user session access; verify all eight role boundaries. |
| Students and Parent relationships: `students`; `parent_student_links` absent | `students` RLS on, not forced; permissive `PUBLIC SELECT USING (true)`. No Parent-link relation exists. | Public SELECT is permitted for every row through the observed policy. Broad table grants also include writes and TRUNCATE; zero student rows at audit time does not establish source-data absence. | Student records must not be public. Parent-child link source and active-link semantics are unknown. Preserve permanent IDs and school `sch_default_01`. | Anonymous read denied; staff role scope; Parent linked child allowed; unlinked/inactive/other child denied; cross-school/sentinel denial. |
| Classes and subjects: `classes`, `subjects` | RLS on, not forced; each has permissive `PUBLIC SELECT USING (true)`. | All rows are public-readable under the policy; all seven table privileges are granted. Both tables had zero rows in the observed count. | Owner must decide whether any minimal catalogue fields need public access. Do not remove reads before inspecting UI/API dependencies; never expose student-linked data through class joins. | Public minimal catalogue only if approved; deny writes/TRUNCATE; test authenticated workflow access and dashboard dependencies. |
| Fees and payments: `fee_payments` | RLS on, not forced; no policy. | All seven grants; ordinary API roles have no matching row policy, but bypass role is unrestricted. Table had zero rows. Fee Hub canonical tables are not part of the observed 12-table catalog. | Need reviewed staff authorization for publishing, payment entry, accounting and parent-scoped summaries. Confirm canonical schema target and runtime role. | Publish/unpublish, payment create/reversal, reconciliation, parent-only linked-child view, unauthorized-role denial, audit integrity. |
| Admissions: no admissions relation in observed 12-table catalog | No current policy possible because canonical admission relations are absent. | Current observed catalog cannot support the application's full admissions schema contract. | Establish source data and mapping; preserve admission/student IDs and relationships. | Admission create/review/enroll; duplicate/idempotency behavior; authorization boundaries; row/FK reconciliation. |
| Attendance: `attendance` | RLS on, not forced; no policy. | All seven table grants; no ordinary role has a matching row policy. Count was zero. Canonical `student_attendance` is absent. | Confirm assignments/roles and actor scoping; public direct access must be denied. | Allowed staff attendance; unassigned staff and Parent write denied; Parent reads only linked child where permitted. |
| Assessments/results: `assessments` | RLS on, not forced; no policy. | All seven table grants; no ordinary role has a matching row policy. Count was zero. Canonical results/gradebook relations are absent. | Preserve draft/published state, result history and school scope; confirm parent release semantics. | Entry, moderation/publication, report aggregation; deny unauthorized draft/result access and cross-child Parent reads. |

`sch_default_01` remains the required single-school identity. The observed schema lacks the canonical `schools` relation and observed `users` has no `school_id`; school-boundary enforcement is not established. The canonical migration is not evidence of live policy coverage. It currently enables RLS but its broad server grant is to `service_role`, which bypasses RLS; any future non-bypass design must specify and test a trustworthy school/actor context while retaining application RBAC.

## Proposed least-privilege direction (NOT APPLIED)

1. Keep all database credentials server-side. Do not grant business-table access to browser `anon`/`authenticated` roles unless a documented browser feature requires a specific minimal read.
2. Inventory every query and required sequence/function before changing ACLs. Use a dedicated non-owner, non-superuser, `NOBYPASSRLS` server runtime role with only required SELECT/INSERT/UPDATE/DELETE on required relations and minimal sequence privileges. Deny `TRUNCATE`, DDL, policy, trigger, and role-management access.
3. Decide whether the app sets a transaction-local actor/school context after verifying a signed session, and prove pooled-connection reset/fail-closed behavior. Keep `sch_default_01` and Parent-child constraints explicit. Do not rely on school scope alone for staff RBAC or Parent privacy.
4. Remove or narrow public SELECT on `students` only in a reviewed, tested migration after confirming dependencies. Review `classes` and `subjects` for a justified minimal public catalogue before altering their policies.
5. Do not apply a blanket revoke or the current baseline/reconciliation migrations to this live catalog. The seven-table reconciliation migration's preconditions do not match the observed 12-table catalog with user/role records.

## Owner evidence required next

- Actual Preview `OSAAH_POSTGRES_URL` target and runtime identity, checked privately without disclosing secret values.
- Full owner-level inventory of effective grants, role membership/SET privileges, table/view/sequence/function ACLs, defaults, owners, and dependency chains. The SQL Editor `postgres` session can inspect catalogs but is not the OSAAH runtime.
- Verified backup/PITR and restore-to-new-project evidence; authoritative data source (TiDB, export, or other source); separate non-Production Supabase target.
- Complete role map for all eight OSAAH roles, decision for source `admin`, recovery process for six observed accounts, Parent-to-student relationship source, and assurance that `sch_default_01` remains the only school.

No RLS, grants, schemas, credentials, accounts, rows, Vercel settings, or deployment targets were changed. This audit does not establish that authentication works or that Supabase is ready for production.
