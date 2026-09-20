# OSAAH Daylight School Complex
## Part 1 Forensic Audit and Database Connection Diagnosis

**Audit date:** 2026-09-20  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Audited commit:** `cf1ce5e` (`main`)  
**Scope:** Part 1 only. No production schema mutation was performed.

## Executive conclusion

The repository contains **two authentication paths** and **two data planes**. The normal School Portal uses an in-memory `createAuthService()` with demo users, scrypt password hashes, and process-local sessions. A separate database-backed controller exists at `/api/auth/proprietor/login`; it queries `portal_users`, verifies bcrypt hashes, and is created only when `DATABASE_URL` is present. The durable controller returns proprietor metadata but does not create the normal `osaah_session` cookie, so it is not a complete replacement for the School Portal session flow.

The Fee Setup page does not obtain its class dropdown from the SQL `classes` table. Its `/api/classes` endpoint derives distinct class IDs from the in-memory student service. Therefore, “No classes available” is a **class-data/API behavior** that is separate from the durable Fee Hub database path. The endpoint returns an empty list whenever the authenticated school has no in-memory student records. The page’s Fee Hub obligation endpoints use the database-backed fee repositories when a database adapter is configured.

The repository clearly expects a server-side `DATABASE_URL`, parsed by `mysql2/promise` through the `uri` option and connected with TLS 1.2 or newer. However, this sandbox had no configured database environment variable and no durable adapter module configured, so the exact production access-denied cause cannot be proven from a live database handshake. The error is therefore **BLOCKED pending deployment configuration and read-only database verification**, not a confirmed repository-only defect. The most likely failure boundary is the deployment’s `DATABASE_URL` secret or its TiDB credentials/connection options, but no credential value is invented or exposed here.

## 1. Database connection

### Current mechanism

`src/ai/tidb-database-adapter.js` creates a `mysql2/promise` pool from `environment.DATABASE_URL` or `process.env.DATABASE_URL`. The pool uses `uri: connectionString`, `waitForConnections: true`, a connection limit of 10, and TLS configuration with `minVersion: 'TLSv1.2'` and `rejectUnauthorized: true`. It exposes `query`, `execute`, `transaction`, and `healthCheck`.

`src/server.mjs` creates this adapter only when `process.env.DATABASE_URL` is truthy. The adapter is passed into the application as `database`. Database-backed fee collections, parent fee obligations, admission enrollment, and proprietor authentication are enabled conditionally from that adapter.

The migration CLI uses a separate `OSAAH_DATABASE_ADAPTER_MODULE` contract. Without that variable, `migration:validate` can validate local migration files only; `migration:status` and `migration:apply` fail closed because a durable adapter is required. The repository’s production workflow supplies `DATABASE_URL` from the GitHub Actions production secret and invokes the production migration script manually through `workflow_dispatch`.

### Access-denied diagnosis

**Status: BLOCKED.** The repository has no database credentials in source control, and this sandbox had no `DATABASE_URL`, `OSAAH_DATABASE_ADAPTER_MODULE`, or related database variable available. Consequently, no `SELECT 1`, `INFORMATION_SCHEMA`, or `SHOW CREATE TABLE` query could be run against production.

The repository evidence narrows the failure boundary as follows:

1. The application expects the deployment secret named `DATABASE_URL`.
2. The secret must be configured in the Vercel/runtime environment that serves the application, and in the protected GitHub Actions production environment for migration execution.
3. The value must be a valid MySQL/TiDB connection URI with the target username, password, host, port, database name, and any provider-required TLS parameters represented in the URI.
4. Verification must be performed server-side with a sanitized health check and a read-only query such as `SELECT 1`; the complete URI and password must never be logged.
5. Until the credential is corrected and the connection succeeds, database-backed Fee Hub obligations, collections, parent fee persistence, enrollment persistence, and durable proprietor authentication remain unavailable or return service errors.

The code does not print the connection string in the adapter. The migration CLI also returns a generic safe message for unexpected migration failures. The only repository-level improvement required before Part 2 is to add a reviewed, sanitized diagnostic/preflight path that reports the variable name and connection phase without revealing credentials. The actual credential value must be corrected in deployment configuration, not committed to the repository.

## 2. Authentication

### Normal School Portal path

The normal path is:

`POST /api/auth/login` → `login()` in `src/server.mjs` → `auth.login()` → in-memory user lookup → scrypt password verification → canonical role resolution → process-local session creation or HMAC-signed session → `osaah_session` HttpOnly cookie → `auth.authenticate()` on protected requests → sidebar permission filtering and dashboard routing.

The normal `createAuthService()` is instantiated by the default argument of `createApp()`. It is not connected to the SQL `users`, `staff`, `roles`, or `permissions` tables. The service accepts aliases including `SCHOOL_ADMINISTRATOR`, `ACCOUNTANT`, `CLASSROOM_TEACHER`, `PROPRIETOR`, and `PROPRIETRESS`, and maps them to canonical keys. It supports session expiry, lockout after five failed attempts, logout, password reset, account status checks, and optional HMAC-signed tokens when `OSAAH_SESSION_SECRET` is at least 32 characters.

The default dashboard routes are `/reports` for Proprietor, `/settings` for School Admin, `/academics` for Headteacher and Assistant Headteacher, `/fees` for Accountant/Bursar, and `/academics` for Teacher. Authorization is permission-based through `canAccess()` and role-specific permission sets.

### Separate database proprietor path

`POST /api/auth/proprietor/login` exists only when a database adapter is available. It queries:

```sql
SELECT id, portal_name, email, password_hash, role, is_active
FROM portal_users
WHERE email = ?
LIMIT 1
```

It requires an active row whose role is exactly `PROPRIETOR`, and verifies `password_hash` with bcrypt. It returns safe user metadata and does not return the password or connection details. It does not establish the normal `osaah_session` cookie. This is a separate controller, not a durable implementation of the complete School Portal authentication architecture.

### Why Proprietor works and other staff roles fail

The repository does not support the conclusion that the listed staff users are present in the production database, because the database could not be queried. It does establish the following code-level cause for inconsistent behavior:

- The normal login service recognizes only the users present in its in-memory `DEMO_USERS` collection or users supplied to `createAuthService()` by the caller. The collection contains a Proprietor, Teacher, HR Officer, Examination Officer, Admissions Officer, Bursar, and other demo roles. It does **not** contain demo users for `Administrator`, `Headteacher`, or `Assistant Headteacher`.
- The canonical role is `SCHOOL_ADMIN`, not the display/legacy name `Administrator`; `ACCOUNTANT` is normalized to `ACCOUNTANT_BURSAR`.
- Headteacher and Assistant Headteacher are defined as canonical roles and have dashboard/permission definitions, but no corresponding default demo accounts exist in `DEMO_USERS`.
- The database-backed path recognizes only `PROPRIETOR` and queries `portal_users`; it cannot authenticate the other roles by design.

Therefore, the repository-level explanation is **missing/default-user coverage plus split authentication architecture**, while the production explanation may additionally include missing records, inactive status, obsolete role values, password-hash format, school scope, or migration drift. Those production possibilities require read-only database evidence before Part 2.

## 3. Current user schema

The SQL foundation schema defines these identity and authorization tables:

| Table | Key fields and relationships |
|---|---|
| `schools` | `id` primary key; school name and branding fields. |
| `users` | `id` primary key; `school_id` references `schools`; user identity, portal, status, and role linkage fields. |
| `staff` | `id` primary key; `school_id` references `schools`; staff identity and employment fields. |
| `roles` | `id` primary key; `school_id` references `schools`; `role_key`, display name, and oversight rank. |
| `permissions` | `id` primary key; permission key and display name. |
| `role_permissions` | role-to-permission mapping through foreign keys to `roles` and `permissions`. |
| `user_roles` | user-to-role mapping through foreign keys to `users` and `roles`. |
| `sessions` | durable session identity and user linkage in the SQL foundation schema. |
| `audit_logs` | school-scoped audit record with optional `user_id`, `role_id`, `session_id`, and entity metadata. |

The staff HR schema separately defines `staff_profiles` and `staff_assignments`. `staff_profiles.role_key` is a text role field and is not the same shape as the normalized in-memory `roleKey`/permission set. This is a material integration point for Part 2.

The database-backed proprietor controller instead queries `portal_users`, a table that is not declared in the inspected foundation migration set. That is direct evidence of schema/authentication drift: the controller’s durable identity contract is not the same as the canonical `users`/`roles`/`user_roles` contract.

## 4. Current RBAC

The application’s active request authorization is in-memory. `createAuthService()` returns sanitized user data containing `roleKey`, `schoolId`, `permissions`, assignment scopes, and a dashboard. `canAccess()` allows `*` or an exact permission. Protected page routing uses `visibleSidebar()` and module metadata. Data services additionally enforce school scope and, for teachers, assigned class/student scope.

The SQL schema has a more normalized RBAC architecture consisting of users, roles, permissions, and mapping tables. The normal login service does not load that architecture. This is the principal RBAC gap: the source repository contains a canonical relational RBAC design and a functioning application-level RBAC design, but no verified bridge between them.

## 5. Class architecture

### Canonical source in the application

`src/students.js` exports `CORE_LEVELS`, which is used as the default class list by `createClassDatabaseService()` and related academic services. The class database service validates requested classes against this list, scopes records by school, and limits teachers to assigned classes.

The SQL foundation schema defines `class_levels`, `classes`, `academic_years`, `terms`, `streams`, and student class relationships. Student-related schema uses `student_profiles.class_id`, `student_class_history.class_id`, and enrollment/class references. Later migrations introduce a `students` master table, `student_enrollments`, permanent student IDs, and additional admission relationships. This means the repository has both an older `student_profiles` path and a newer master-student/enrollment path that must be reconciled before production mutation.

The requested display sequence is:

`Nursery 1`, `Nursery 2`, `KG 1`, `KG 2`, `Basic 1` through `Basic 6`, `JHS 1`, `JHS 2`, and `JHS 3`.

The audited code and tests also use legacy labels such as `Primary 1`, `Primary 2`, and `Primary 4` in sample records. No duplicate class rows should be created until the canonical ID-to-display-label mapping is confirmed from production data.

### Why “No classes available” occurs

`GET /api/classes` requires an authenticated user with `students.read` or `fees.read`, then executes the equivalent of:

```js
students.listStudents({ requestedSchoolId: user.schoolId })
  .map((student) => student.classId)
  .filter(Boolean)
```

It does not query the SQL `classes` table and does not use `CORE_LEVELS` as a fallback. If the in-memory student service has no records for the authenticated school, the result is an empty array and `public/fee-setup.html` renders `No classes available`.

This is separate from the database access-denied error. A failed durable database connection affects database-backed Fee Hub operations, but the class dropdown is independently empty when the in-memory student source has no class-bearing records. The correct Part 2 fix is a canonical class repository/service backed by the existing schema, with a compatibility mapping for legacy labels, not a frontend-only hard-coded dropdown.

## 6. Fee Hub

The Fee Setup page is `public/fee-setup.html`, routed from `/fees/setup`. It calls `/api/classes` for the class selector and `/api/fees/obligations` to load published obligations. Publishing calls `/api/fees/obligations/publish` with scope, fee structure, academic year, term, amount, and optional class ID.

The SQL fee architecture includes legacy tables such as `fee_structures`, `invoices`, `payments`, `payment_gateway_configs`, and `financial_adjustments`. Later migrations add `admission_fee_structures`, `fee_obligations`, `fee_collection_records`, `fee_collection_corrections`, and related indexes. The server conditionally creates `createFeeCollectionsRepository()` and `createParentFeeObligationsRepository()` from the durable adapter. This is a layered Fee Hub rather than a single isolated fee table.

Existing in-memory `createFeeService()` still handles invoices, payments, receipts, statements, and gateway configuration in the normal application wiring. The database repositories handle newer obligation/collection flows when `DATABASE_URL` is configured. This split must be made explicit and unified in Part 2 without deleting existing fee records or replacing the working receipt/payment behavior.

## 7. Schema drift

The material incompatibilities found in source are:

1. **Authentication source drift.** Normal login reads an in-memory user list; the durable proprietor controller reads `portal_users`; the SQL foundation defines `users`, `roles`, `permissions`, `user_roles`, and `sessions`.
2. **Role naming drift.** Application keys include `SCHOOL_ADMIN` and `ACCOUNTANT_BURSAR`, while requested/legacy labels include Administrator and Accountant. Alias normalization exists only in the in-memory service.
3. **Role storage drift.** `staff_profiles.role_key` is a text field, while the foundation RBAC model uses role and mapping tables.
4. **Session drift.** Normal login creates `osaah_session`; the proprietor controller returns metadata without creating that cookie, while the SQL schema includes a sessions concept.
5. **Class source drift.** Fee Setup uses distinct class IDs from in-memory students instead of the SQL `classes`/`class_levels` source.
6. **Student identity drift.** The repository contains `student_profiles` with a profile-centered identity and later `students`, `student_enrollments`, permanent student ID, and master-student foreign-key migrations. The enrollment service uses the newer master identity while other services still consume in-memory student records.
7. **Fee architecture drift.** Legacy fee structures/invoices/payments coexist with newer obligations/collections/corrections repositories. The coexistence is additive in migrations but not yet a single verified production data flow.
8. **Migration adapter contract drift.** The application’s bundled TiDB adapter exposes query/execute/transaction/healthCheck, whereas the production migration runner requires additional metadata and lock methods through `OSAAH_DATABASE_ADAPTER_MODULE`. The bundled adapter is not itself a complete migration-runner adapter.
9. **Production migration evidence gap.** The repository contains 30 numbered SQL files (`001` through `030`, with one missing number in the directory sequence), while local validation reports 29 discovered migration files. No production applied-migration inventory was available.

No type mismatch involving actual production rows, foreign-key definitions, or indexes can be confirmed without the requested read-only `INFORMATION_SCHEMA` and `SHOW CREATE TABLE` queries.

## 8. Proposed Part 2 migration strategy

Part 2 should remain additive and reversible at the application level:

1. Configure and verify the production database secret using a server-side, sanitized preflight. Do not print `DATABASE_URL` or any password.
2. Run a read-only inventory of tables, columns, types, indexes, unique constraints, foreign keys, row counts, and applied migration metadata. Capture the result as a redacted artifact before any DDL.
3. Select one canonical identity contract. The likely target is `users` plus `roles`, `permissions`, `user_roles`, `schools`, and `sessions`, with a reviewed compatibility view or adapter for any existing `portal_users` records. Do not create a second user table.
4. Build a role alias mapping for Administrator → `SCHOOL_ADMIN`, Accountant → `ACCOUNTANT_BURSAR`, Headteacher → `HEADTEACHER`, and Assistant Headteacher → `ASSISTANT_HEADTEACHER`. Preserve unknown legacy values for review rather than coercing them silently.
5. Implement one durable authentication service that preserves the existing proprietor behavior, supports bcrypt and any verified legacy hash format, creates the same signed session contract, and resolves permissions from the canonical RBAC tables. Restore missing staff accounts only from verified production records or an explicitly approved seed/migration input; never guess passwords.
6. Select the existing canonical class tables and create only missing class-level/class rows after comparing normalized names and school/year scope. Add a display-label mapping so legacy `Primary` names can be presented as the approved `Basic` labels only when the mapping is verified.
7. Replace `/api/classes`’s in-memory derivation with the canonical class repository, while retaining a controlled compatibility fallback only for test fixtures. Do not hard-code production class records in the frontend.
8. Unify Fee Setup around the existing fee structure and obligation repositories. Preserve invoices, payments, receipts, and corrections. Use idempotent, school-scoped backfills only after backup and approval.
9. Add read-only smoke tests for durable login, role routing, class options, fee setup, school isolation, and parent fee visibility. Then run a dry-run migration and a production status check before applying any forward migration.

## 9. Risks

The highest risks are duplicate identities, duplicate class rows, loss of role assignments, incorrect school scoping, incompatible password hashes, and joining fees to the wrong student identity. The older profile-centered student tables and newer master-student tables create a particular risk of duplicate student financial records if they are joined by a non-canonical ID.

A second risk is assuming that a database connection failure and an empty class list are the same failure. They are not the same code path in this repository. A third risk is treating the database-backed proprietor controller as a complete authentication solution when it does not issue the normal session cookie or resolve the full RBAC model.

No destructive operation was performed. No `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, delete, production insert, or migration apply command was run.

## 10. Tests and diagnostics

| Command or check | Result |
|---|---|
| `npm run migration:validate` | **PASS** — 29 migration files discovered and validated locally. |
| `npm run assets:verify` | **PASS** — 12 protected login assets verified. |
| Focused Node test set covering proprietor auth, serverless sessions, class database, fee collections API, TiDB adapter, and migration runner | **PASS** — 43 tests passed, 0 failed. |
| `curl -I https://www.osaahdaylightschool.online/` | **PASS** — live Vercel response observed. |
| Live `GET /api/classes` without credentials | **EXPECTED 401** — endpoint is protected. |
| Live `GET /api/fees/obligations` without credentials | **EXPECTED 401** — endpoint is protected. |
| Production `INFORMATION_SCHEMA` / `SHOW CREATE TABLE` inventory | **BLOCKED** — no database credentials/adapter configured in this sandbox. |
| Production migration status | **NOT RUN** — no durable migration adapter configured; no mutation attempted. |

## 11. Git

The audited branch is `main` at commit `cf1ce5e`. The repository was clean before the audit. This report is the only file added by this Part 1 implementation:

- `docs/PART_1_FORENSIC_AUDIT_REPORT.md`

No destructive production operation occurred. No production migration was applied. Parts 2–5 were not implemented.

## Part 1 status

| Area | Status | Finding |
|---|---|---|
| Database connection | **BLOCKED** | Repository contract is identified; production credential/handshake evidence is unavailable. |
| Authentication | **PASS for code tracing; BLOCKED for production cause** | Split in-memory/durable paths explain the role inconsistency; production rows remain unverified. |
| Current user schema | **PASS for repository inventory; BLOCKED for live schema** | Canonical SQL tables and the separate `portal_users` contract are identified. |
| Current RBAC | **PASS** | Application-level RBAC is traced; no verified bridge to SQL RBAC exists. |
| Class architecture | **PASS** | In-memory student-derived class source and SQL class source are distinguished. |
| Fee Hub | **PASS for code tracing; BLOCKED for live data** | Repository/API flow is identified; database-backed operation awaits connection verification. |
| Schema drift | **PASS for repository findings; BLOCKED for row-level confirmation** | Material code/schema contracts are documented without production mutation. |
| Proposed migration | **PASS** | Additive, canonicalization-first Part 2 strategy is specified. |
| Risks | **PASS** | Identity, role, class, fee, and school-scope risks are recorded. |
| Tests | **PASS** | 43 focused tests plus migration and asset checks passed. |
| Git | **PASS** | Report-only change; no destructive operation or production migration. |

## References

[1]: `src/server.mjs` "Server bootstrap, routes, conditional database wiring, and Fee Hub endpoints"

[2]: `src/auth.js` "In-memory School Portal authentication, role aliases, sessions, and permissions"

[3]: `src/proprietor-authentication-controller.js` "Database-backed proprietor authentication controller"

[4]: `src/ai/tidb-database-adapter.js` "TiDB/MySQL connection pool and TLS configuration"

[5]: `src/class-database.js` "Canonical application class database service and school/teacher authorization"

[6]: `public/fee-setup.html` "Fee Setup class loading and obligation publishing client"

[7]: `schema/001_foundation.sql` "Foundation identity, RBAC, school, class, academic-period, and session schema"

[8]: `schema/003_students_admissions.sql` "Student profile, class history, parent link, and admissions schema"

[9]: `schema/008_fees_finance.sql` "Legacy Fee Hub structures, invoices, payments, and gateway configuration"

[10]: `schema/009_staff_hr.sql` "Staff profiles, assignments, and HR schema"

[11]: `schema/023_permanent_student_ids.sql` "Permanent student identifier migration"

[12]: `schema/028_admission_student_master_fk.sql` "Admission-to-master-student foreign-key alignment"

[13]: `schema/029_fee_obligations_collections.sql` "Fee obligations and collection records migration"

[14]: `docs/PRODUCTION_MIGRATIONS.md` "Production migration runbook and safety requirements"

[15]: `test/proprietor-authentication.test.js` "Proprietor controller and API route tests"

[16]: `test/migration-runner.test.js` "Migration runner safety and idempotency tests"

[17]: `test/tidb-database-adapter.test.js` "Database adapter contract tests"

[18]: `test/class-database.test.js` "Canonical class service and authorization tests"

[19]: `test/fee-collections-api.test.js` "Fee collection API scoping and correction tests"

[20]: `schema/002_foundation_seed.sql` "Foundation seed roles, permissions, and school records"

[21]: `schema/030_fee_collection_corrections.sql` "Fee correction audit schema"

[22]: `scripts/migrate.mjs` "Migration validation, status, and apply CLI"

[23]: `.github/workflows/production-db-migration.yml` "Protected production migration workflow"

[24]: `https://www.osaahdaylightschool.online/` "Live OSAAH Daylight School application"

[25]: `https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM` "Audited GitHub repository"
