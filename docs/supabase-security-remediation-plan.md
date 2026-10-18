# OSAAH Supabase security remediation proposal

- **Status:** Proposal only — not applied, not approved for execution
- **Project:** `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`)
- **Evidence baseline:** `docs/supabase-12-table-reconciliation-audit.md`, commit `7761914b32f5b7c011e38f5db58f18860cc7d030`

This document proposes review and acceptance steps for a future isolated Supabase migration. It contains no production-ready SQL. No hosted grants, policies, schemas, records, credentials, Vercel settings, or deployments were changed.

## 1. Executive security assessment

The captured catalog reports RLS enabled and not forced on all 12 public tables. It reports direct table grants of `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` to each of `anon`, `authenticated`, and `service_role` on all 12 tables. It reports three `PUBLIC SELECT` policies named `Allow anon read access` on `classes`, `students`, and `subjects`; the previously captured policy definitions use unrestricted `USING (true)`. No policies were reported on the other nine tables.

None of the three reported live read policies enforces `school_id = 'sch_default_01'`; because the predicate is unrestricted, each exposes every row visible to the grantee rather than the single-school boundary. The captured live schema has no `schools` table or school scope column on `users`. The canonical migration’s `schools_public_read` predicate is separate design evidence and is not installed on this observed live schema.

These observations establish a material exposure risk, but do not alone prove which endpoint is reachable, which role the OSAAH connection uses, or whether an attacker has exercised it. `anon` and `authenticated` table grants plus the unrestricted public read policies permit reads of rows from those three tables through a path using those PostgreSQL roles. RLS normally filters row operations; it does not prevent `TRUNCATE`. The reported `TRUNCATE` grants therefore require urgent verification of API exposure and effective privileges, especially because a truncate operation is not narrowed by a row policy. For the other tables, RLS with no applicable policy normally denies row-level operations for non-bypass roles, but does not remove the truncate grant. A role that owns a table, has `BYPASSRLS`, or is superuser can bypass ordinary RLS behavior.

Potential consequences include disclosure of student/class/subject records; unauthorized destructive operations; access to staff, session, financial, admissions, attendance, or assessment data if the effective role bypasses RLS or owns objects; and loss of login/session integrity if such access can change or truncate authentication tables. The captured counts reported zero students and several other empty school tables at that time. Empty counts do not lower the need to fix the exposure before production records are loaded.

The current application uses a server-side PostgreSQL adapter selected by `OSAAH_POSTGRES_URL`, not Supabase Auth as the school-account authority. The actual database target and role behind that URL are unknown. Code review shows server routes call authorization checks such as `canAccess` and the auth service derives role permissions, so authorization is not intended to depend only on sidebar visibility. That code review does not prove every hosted workflow or endpoint passes its checks, and it does not make broad database grants safe. The canonical baseline enables RLS and removes direct table privileges from browser API roles while granting broad access to `service_role`; prior audit material reported `service_role` with `BYPASSRLS`. Its current role attributes and whether OSAAH uses it must be verified before relying on RLS as a barrier.

## 2. Evidence inventory and unresolved facts

| Area | Captured evidence | Still unverified |
|---|---|---|
| Relations | 12 public base tables; 77 columns; 12 primary keys, 11 unique constraints, 15 foreign keys, eight checks, 27 indexes, six sequences | Full schema ownership/dependencies, schema and sequence grants, function privileges, all non-public schemas used by the app |
| RLS | Enabled and not forced on all 12 public tables | Effective behavior under actual runtime role, owner/BYPASSRLS attributes, and current live policy definitions rechecked against every relation |
| Policies | Three unrestricted `PUBLIC SELECT` policies on `classes`, `students`, and `subjects`; no policies reported for nine other public tables | API reachability, grants inherited from memberships, policies in other exposed schemas |
| Table grants | Each of `anon`, `authenticated`, and `service_role` has the seven listed table privileges on all 12 tables | Exact schema/sequence/function grants, role membership, configured runtime login role, and whether these roles are reachable via each deployed API |
| Runtime | Code reads `OSAAH_POSTGRES_URL`; school authorization is implemented server-side | Actual Preview/Production target and role; current Vercel scopes; whether the role has superuser, owner, or `BYPASSRLS` capability |
| Auth/session contract | Login/session SQL needs columns and relations absent from the observed catalog; signing secret is `OSAAH_SESSION_SECRET`; session TTL is 30 minutes | Compatible hosted schema, session secret isolation/rotation, successful hosted session lifecycle |
| School scope | App uses the canonical single-school identifier `sch_default_01`; canonical migration includes that school row | Existing live catalog has no `schools` table or `users.school_id`; complete row-level school scoping cannot be claimed until the new schema and policies are rehearsed |
| Migration history | No `public.schema_migrations` was reported | Any alternate ledger, baseline history, exact operator-applied DDL, and current schema fingerprint |

The live catalog shown in the prior report is significantly different from the 159-table canonical baseline. The current reconciliation migration has preconditions for a different seven-table empty schema and must not be run against this 12-table catalog.

## 3. Proposed least-privilege permission model

The matrix below is a target design to validate against actual query dependencies. It is not a grant script. The application must retain every existing workflow and enforce its current role permissions; reducing database access must be staged only after the approved query inventory and recovery plan exist.

| Database principal | Public/browser access | Proposed access and constraints | Operations explicitly excluded |
|---|---|---|---|
| `anon` | No direct access to private school tables. If public school identity/branding is a requirement, allow read of only the minimal approved fields for the one row `sch_default_01`. | No access to student, Parent, user, role, session, fee, payment, admissions, attendance, assessment, result, staff, or audit tables. | No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, DDL, sequence access, role changes, or security-definer functions that expose records. |
| `authenticated` | OSAAH staff and Parent login is application-managed; do not assume Supabase Auth JWTs represent OSAAH roles. No direct business-table access unless a separately reviewed browser feature requires it. | Default to no business-table privileges. Any approved public configuration read must be minimal and explicitly tested. | No student/Parent/finance/auth/session access by default; no writes, `TRUNCATE`, DDL, sequence access, or role changes. |
| Dedicated `osaah_runtime` (proposed) | Never exposed to browser code or client bundles. Used only by the trusted server-side adapter. | Non-owner, non-superuser, `NOBYPASSRLS`, no role creation/database creation. Grant only the required `SELECT`/`INSERT`/`UPDATE`/`DELETE` privileges on the table/view/function set proven by application query inventory; grant only required sequence `USAGE`/`SELECT`. Enforce `sch_default_01` in database policy where applicable and keep application RBAC checks. | No `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema ownership, DDL, policy management, migration ledger writes, or access to unused relations. Avoid default privileges that silently broaden access. |
| Existing `service_role` | Server-only; never place key or connection secret in browser-visible variables or client code. Do not use it for ordinary app requests if a restricted role can meet the adapter needs. | If a reviewed technical limitation requires it temporarily, keep it server-only, audit every use, and treat database RLS as bypassed. Replace with a dedicated non-bypass runtime login before relying on RLS for defense in depth. | No browser access; no assumption that RLS protects a bypass role; no production credential copied to Preview. |
| Migration owner/operator | No browser access; separate from application runtime. | Short-lived/controlled DDL authority only for a reviewed migration, with MFA/approval, exact target verification, audit trail, and recovery point. | No use for application requests, no standing application secret, no ad-hoc DDL in Production. |

Table-level CRUD cannot express staff role permissions by itself. Server routes must continue to authenticate a signed session, derive the role and school from trusted server-side state, call authorization checks for each operation, and scope data access. The database role model should provide a narrow damage boundary; it must not replace the application’s eight role-specific authorization boundaries.

The canonical migration currently enables RLS but only defines a public read policy for the `schools` row with ID `sch_default_01`; it revokes browser table/sequence grants and grants broad table/sequence rights to `service_role`. That is not evidence of per-table server-role RLS coverage, nor proof that the deployed runtime uses a restricted role. Any target migration must explicitly resolve how non-bypass server access can satisfy the application’s data needs while applying the correct policies.

## 4. Migration and maintenance execution review

- `scripts/supabase-migrate.mjs` validates/status-checks only local loopback PostgreSQL hosts and refuses a remote host. Its local `apply` command also requires an explicit disposable-database acknowledgement and refuses application when unexpected public tables exist. This is a guard in that script, not authorization to run it against Supabase.
- `scripts/run-postgres-integration.mjs` requires an explicit disposable-local acknowledgement, accepts loopback hosts only, restricts the database name to the `osaah_test_` pattern, refuses Production/Supabase-shaped names, and verifies the expected schema before tests. It creates local test objects/fixtures; do not direct it at a hosted database or bypass its guard.
- `supabase/migrations/202610150002_reconcile_existing_supabase.sql` runs in a transaction and is specifically pinned to a seven-table empty starter catalog. It creates a private archive schema, moves the seven source tables intact, drops the three public-read policies from those archived tables, revokes access to archived objects, and installs the canonical schema. It does not drop/truncate the original tables, but it is still a significant schema and access change. The current observed 12-table catalog with populated auth/role rows does not satisfy its stated preconditions; do not apply or adapt it by bypassing checks.
- The baseline and reconciliation SQL contain RLS/grant DDL. The production SQL editor path is separate from the local guarded CLI, so CLI refusal must not be mistaken for protection against a human pasting SQL into the wrong project.
- The reviewed local scripts contain no `DROP DATABASE`, `DROP SCHEMA`, `DROP TABLE`, or `TRUNCATE` statements in the inspected runner files; the reconciliation migration does contain `DROP POLICY` statements only after moving those policies with the tables into its archive schema. Reconfirm exact SQL and target preconditions in the change review before any future execution.

No hosted command or migration was executed for this task.

## 5. Single-school and Parent authorization design

Keep the existing single-school architecture. Do not add multi-tenant behavior as a shortcut. Canonical school ID remains exactly `sch_default_01`.

- Every school-owned row must have a non-null `school_id` with an FK to the one canonical school row where that relation is part of the schema contract.
- Staff and administrative server operations must be scoped to the authenticated actor’s validated `schoolId`, which must equal `sch_default_01`; reject missing or mismatched scope rather than silently substituting it.
- A simple school-boundary RLS condition can restrict rows to the canonical ID, but it does not implement role permissions or Parent-child privacy. Parent data requires an active `parent_student_links` relationship and a validated parent identity. The database/app design must deny unlinked, inactive, duplicate-ambiguous, and mismatched relationships.
- If the design uses a transaction-local actor/school setting for RLS, set it only after session verification and for every transaction using the pooled connection; never trust a client-supplied arbitrary setting. Prove connection pool reset behavior and fail closed when scope is absent. Do not claim this defense exists until code and negative tests implement it.
- Keep sensitive data such as credentials, tokens, student/Parent records, and financial details out of logs. Parameterized queries and safe diagnostic logs remain required.

## 6. Table-family policy acceptance tests

Run these only against an isolated, approved non-Production database. Use synthetic records and a disposable test account. Each negative write probe must be rolled back or run in a disposable database; never use Production rows as a test fixture.

| Data family | Required positive behavior | Required denial behavior |
|---|---|---|
| Public school identity / configuration | If approved, `anon` may read only minimal fields from the single `sch_default_01` row. | No role can enumerate other school rows; no client write or truncate. If the school row is not intended public, deny all browser access. |
| Staff users, roles, permissions, sessions | Runtime login resolves only eligible accounts; a user can restore/revoke only the appropriate session; administrative role management follows explicit permissions. | Browser roles cannot enumerate users/roles, read password hashes, create sessions, change role assignments, or revoke another account’s sessions. Invalid/expired/revoked sessions fail. |
| Students and admissions | Approved staff roles can use admission/student workflows in `sch_default_01`; Parent can see only students linked to that Parent. | Anon/authenticated direct reads and writes denied; unauthorized staff roles denied; unlinked/inactive Parent, wrong actor, absent school scope, and sentinel non-canonical school denied. |
| Parent portal | Parent sees only active linked children and only permitted profile, attendance, results, notices, and fee information. | Parent cannot enumerate students, alter links, access another Parent’s child, or read staff/private records. Cross-school/sentinel access denied. |
| Fee Hub, payments, accounting | Accountant/approved owner routes can publish fees and record/reconcile payments with audit history. Parent sees only their linked child’s allowed fee summary. | Teacher/Parent/anon cannot publish, edit fees, create payments, see another account’s transactions, or change audit history. Direct browser table access denied. |
| Attendance | Approved staff can read/write only assigned or permitted attendance operations under current RBAC. | Unassigned staff, Parent, anon, or wrong school cannot alter attendance; Parent can read only allowed linked-child records. |
| Assessments and results | Approved academic roles can enter, publish, and report results under current permission checks; Parents only access released records for linked children. | Unauthorized roles cannot view drafts, change results, publish, or access another child’s results. Direct browser access denied. |
| Classes and subjects | Authenticated staff access only through authorized app workflows. Public access only if an owner-approved minimal catalogue requirement exists. | Anonymous rows cannot expose student-linked class data; no browser role can write or truncate these tables. |
| Truncation and schema operations | Migration operator can perform reviewed DDL only in approved migration window. | `anon`, `authenticated`, and runtime role all fail `has_table_privilege(...,'TRUNCATE')`; runtime cannot own tables or manage RLS/grants. |

Acceptance evidence must include `has_table_privilege`/role-attribute checks and actual allowed/denied requests, not only policy text. Test RLS as the exact runtime and API roles, including behavior for table owner and bypass roles. Confirm `FORCE ROW LEVEL SECURITY` status or document why it is not applicable; remember superuser and `BYPASSRLS` roles still bypass RLS.

## 7. Safe remediation order

1. **Freeze evidence:** identify the verified project and environment; export an access-controlled catalog snapshot including owners, role attributes/memberships, schema/table/sequence/function ACLs, RLS/policies, dependencies, and row counts. Obtain backup/PITR inventory and prove a restore-to-new-project. Name the authoritative school data source.
2. **Map the runtime:** privately identify the deployed adapter target and role. Confirm whether the role is the table owner, superuser, or `BYPASSRLS`; record TLS verification, Vercel Preview/Production variable names/scopes, and session-secret separation without exposing values.
3. **Inventory dependencies:** trace every application query and migration/maintenance path to the tables, sequences, views, and operations actually required. Review authentication, session lifecycle, Parent linking, fees, admissions, attendance, results, reports, and role gates. Confirm no browser feature requires direct PostgREST access before changing grants.
4. **Approve target policy:** review the role matrix and table-family acceptance tests with application, database, school, and security owners. Decide whether to create a dedicated non-bypass runtime role and what RLS actor/school context is needed. Keep `anon`/`authenticated` private-data access denied. Document the impact on every feature.
5. **Design an exact-catalog migration:** current baseline/reconciliation files do not match the observed 12-table catalog. Author a new, reviewed migration only after catalog fingerprint, backup, source mapping, account recovery, role mapping, and parent-link design are approved. Use preflight assertions that abort on catalog drift, unexpected rows/objects, missing recovery point, wrong role/target, or incomplete mapping. Do not use blanket revokes as a substitute for dependency analysis.
6. **Rehearse in isolation:** restore/clone only as owner-approved into a separate non-Production project or start with synthetic data. Apply the candidate migration once; verify privilege changes, RLS, counts, keys, FKs, indexes, audit behavior, and all positive/negative workflow tests. Review logs for secrets and personal data. Do not mark a PGlite-only test as hosted evidence.
7. **Stage Preview:** use Preview-only database URL, TLS CA, and session secret. Verify target identity from the app connection without displaying URL values. Run login, invalid login, session restore/expiry/logout, eight-role authorization, Parent link denial, and all listed school workflows.
8. **Request Production approval:** attach exact migration checksum, catalog fingerprint, backup/restore evidence, Preview results, data reconciliation, owner decisions, downtime and delta plan, rollback owner, and go/no-go approval. Do not alter Production before this separate approval.

### Rollback considerations

- Do not start without a recovery point and named operator capable of restoring it to a separate project.
- Before commit, a transactional migration may be rolled back; confirm every DDL operation’s transactional behavior on the actual PostgreSQL version.
- After commit, do not assume reversing grants/policies restores data or session state. Preserve original tables/data and audit evidence until the owner approves retirement. Quiesce writes or reconcile every post-snapshot delta before switching back.
- A failed preflight must abort before changes. A partial failure must stop for catalog inspection; do not blindly rerun or disable checks.
- A policy/grant rollback must restore the exact prior grants/policies from a verified snapshot, not a guessed blanket grant.

## 8. Migration acceptance gates

### Gate A — before authoring an executable migration

- [ ] Verified project ref/environment and complete, timestamped current catalog fingerprint.
- [ ] Verified recovery point and restore-to-new-project rehearsal.
- [ ] Authoritative data source and aggregate/key reconciliation plan approved.
- [ ] Existing six user/role/assignment records preserved by stable IDs; approved mapping covers all eight roles and resolves `admin`.
- [ ] Secure credential-reset/enrollment process approved; no password hashes invented.
- [ ] Parent-to-student source and active-link semantics approved.
- [ ] Runtime database role and privileges identified; no unreviewed owner/superuser/BYPASSRLS dependency.
- [ ] Complete table/sequence/function dependency inventory and server-side RBAC review.
- [ ] Migration preconditions, no-change aborts, archive/data preservation, log controls, rollback, and versioned approval documented.

**Gate A passes only when all items are evidenced.** Current state: **BLOCKED**.

### Gate B — before an isolated rehearsal

- [ ] A separate non-Production Supabase target is confirmed; it cannot route to Production.
- [ ] Preview/non-production URL, TLS verification, and independent session secret are privately verified.
- [ ] Candidate migration checksum and target catalog preflight reviewed by a second operator.
- [ ] Synthetic fixtures are isolated; any restored data is masked and separately approved.
- [ ] Tests cover existing user/role preservation, all eight role boundaries, `admin`, Parent-linked/unlinked access, session create/restore/expire/logout, student/admissions, Fee Hub/publication/payment, attendance, assessment/results, reports/dashboards, RLS, direct grants, truncate denial, referential integrity, indexes, counts, and safe logs.
- [ ] Restore/rollback rehearsal is completed and signed by the recovery operator.

**Gate B passes only after the application and database tests run against the isolated hosted target.** Local PGlite tests alone do not pass it. Current state: **BLOCKED**.

### Gate C — before requesting Production migration approval

- [ ] Gate A and Gate B are signed off with evidence and no unresolved severity-one access finding.
- [ ] Source and target user/role/permission, Parent-link, and school-record counts/key sets reconcile; every difference has owner disposition.
- [ ] Staff credentials are restored through the approved process and successful/failed login behavior is verified in Preview.
- [ ] Session and all workflow/RBAC acceptance tests pass in Preview.
- [ ] Current Production catalog is freshly checked and matches exact migration preconditions; wrong project, role, or drift aborts.
- [ ] Production backup/recovery point predates the window and the named operator confirms restore ability.
- [ ] Change owner approves exact migration checksum, project, execution window, validation queries, monitoring, data freeze/delta plan, and rollback decision point.
- [ ] No secrets or personal records appear in test output, logs, or reports.

**Gate C is an approval request, not authorization by this document.** Production execution still requires separate explicit approval. Current state: **BLOCKED**.

## 9. Open owner decisions

1. Is `douzohkmnuqwbpwcezke` the target for future Production after the schema change, or should an isolated replacement project become the target?
2. Which source holds authoritative OSAAH school records, and who owns its backup/restore and reconciliation?
3. Does the source `admin` account map to `SCHOOL_ADMIN`? What approved source accounts/records map to Parent and Admission Officer roles?
4. Which secure credential-reset and Parent relationship process will restore access without invented credentials or links?
5. Will production runtime use a dedicated non-bypass PostgreSQL role, and what verified policy/context mechanism will enforce the one-school and Parent boundaries?
6. Who signs the exact rehearsal and Production change, owns the recovery point, and can authorize rollback?

Until these facts and approvals are recorded, do not run an executable migration, revoke live grants, change RLS, alter accounts, switch Preview/Production database settings, or claim OSAAH database security/readiness.
