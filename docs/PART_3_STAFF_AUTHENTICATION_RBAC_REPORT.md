# OSAAH Daylight School Complex
## Part 3 Staff Login, RBAC, and Dashboard Routing Report

**Implementation date:** 2026-09-20  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Branch:** `main`  
**Base commit:** `cf1ce5e`  
**Scope:** Part 3 only. Part 4 was not implemented.

## Part 3 status

**Repository implementation: PASS. Live production account verification: BLOCKED.**

The current School Portal authentication service now supports canonical database-backed school staff login when the configured `DATABASE_URL` adapter is present. Existing in-memory fixtures remain available for local development and tests. The existing Proprietor authentication controller and login path remain separate and unchanged, as required by the established architecture; no additional login page or parallel role system was created.

The production database was not connected in this sandbox. Therefore, the four named production accounts were not queried, repaired, or provisioned against live data, and browser QA against those live accounts was not claimed as complete.

## Required role results

The following results are based on the new database-backed authentication fixture, which uses bcrypt hashes and the same canonical School Portal route. They verify role normalization, school resolution, permission resolution, dashboard selection, session persistence, RBAC rejection, and logout behavior.

| Role | Login | Dashboard | RBAC |
|---|---|---|---|
| Proprietor | **PASS** — existing in-memory Proprietor login regression remains green. | **PASS** — `/reports`. | **PASS** — existing `*` oversight preserved. |
| Accountant | **PASS** — database-backed `ACCOUNTANT_BURSAR` fixture. | **PASS** — `/fees`. | **PASS** — Fee Hub/financial permissions resolve; management route rejected. |
| Administrator | **PASS** — database-backed `SCHOOL_ADMIN` fixture. | **PASS** — `/settings`. | **PASS** — administrative permissions resolve through canonical role permissions. |
| Headteacher | **PASS** — database-backed `HEADTEACHER` fixture. | **PASS** — `/academics`. | **PASS** — academic and administrative permissions resolve without Proprietor privileges. |
| Assistant Headteacher | **PASS** — database-backed `ASSISTANT_HEADTEACHER` fixture. | **PASS** — `/academics`. | **PASS** — delegated academic/administrative permissions resolve without Proprietor privileges. |

The exact live credentials specified for Accountant, Administrator, Headteacher, and Assistant Headteacher were not placed in source files, logs, or database migrations. No plaintext password was added to the repository.

## Root cause fixed

Part 1 identified that the normal School Portal login used only the in-memory demo-user collection, while the database contained the canonical `users`, `user_roles`, `roles`, `role_permissions`, and `permissions` architecture. As a result, authorized database staff accounts could not authenticate through the current School Portal.

Part 3 fixes this by extending the existing authentication service with an optional asynchronous database login path. When the application is started with the configured database adapter, `/api/auth/login` resolves school staff from the canonical database tables. When no database adapter is configured, the existing local fixture behavior remains unchanged.

## Authentication files changed

### `src/auth.js`

The canonical `createAuthService` now accepts an optional `database` adapter and exposes `loginFromDatabase`.

The database login path:

1. Looks up the submitted username or email using a parameterized query.
2. Joins `users → user_roles → roles → role_permissions → permissions`.
3. Requires an active account.
4. Verifies the stored password hash using bcrypt for the repository’s database-created hashes, or the existing scrypt format for compatible legacy hashes.
5. Normalizes the database role through the existing canonical role alias map.
6. Builds a server-side session with the existing HMAC/session-token behavior.
7. Returns the existing sanitized user payload and role-specific dashboard redirect.
8. Never returns password material.

Database errors are converted to the safe client response `Authentication service unavailable.` and are not returned as raw SQL errors.

### `src/server.mjs`

The existing `createApp` factory now creates the canonical auth service with the supplied database adapter when no explicit auth service is injected. The production bootstrap already passes the configured `DATABASE_URL` adapter into `createApp`, so database staff login is active through the existing School Portal route.

The existing `/api/auth/login`, `/api/auth/session`, and `/api/auth/logout` endpoints remain the only School Portal session endpoints. The Proprietor route `/api/auth/proprietor/login` remains intact.

### `test/staff-authentication-part3.test.js`

Added automated coverage for database staff login, role and school resolution, dashboard routing, invalid passwords, unknown users, disabled users, cross-role rejection, session refresh, unauthorized route rejection, logout, and Proprietor regression.

## Role mappings

The canonical role identifiers are:

| Portal label | Canonical role key | Dashboard |
|---|---|---|
| Proprietor | `PROPRIETOR` | `/reports` |
| Accountant | `ACCOUNTANT_BURSAR` | `/fees` |
| Administrator | `SCHOOL_ADMIN` | `/settings` |
| Headteacher | `HEADTEACHER` | `/academics` |
| Assistant Headteacher | `ASSISTANT_HEADTEACHER` | `/academics` |
| Teacher | `TEACHER` | `/academics` |

The role alias map now accepts `ADMINISTRATOR` as `SCHOOL_ADMIN` and `ACCOUNTANT` as `ACCOUNTANT_BURSAR`, while preserving existing aliases such as `SCHOOL_ADMINISTRATOR` and `CLASSROOM_TEACHER`. Dashboard selection is based on the authenticated canonical role, never on email address.

## Password verification mechanism

No plaintext password was stored or logged. The database path verifies bcrypt hashes produced by the existing database enrollment/user architecture and also supports the repository’s existing `salt:scrypt-derived-key` format for compatible legacy records. The current password algorithm is not replaced, and valid existing hashes are not rewritten.

The named account passwords were not embedded in SQL, source, reports, or logs. Since the live database was unavailable, no account was created or modified in production.

## Session, refresh, and logout behavior

The existing HMAC-signed session architecture remains in use when `OSAAH_SESSION_SECRET` is configured. The new database users receive the same session token shape and expiry behavior as existing School Portal users.

Automated coverage confirms:

- successful login establishes a session cookie;
- `/api/auth/session` resolves the authenticated user after refresh;
- role-specific permissions remain server-side;
- an Accountant cannot access the management route requiring administrative authorization;
- logout clears the session cookie;
- a subsequent session request is rejected with HTTP 401.

The client already sends logout through `/api/auth/logout` and returns to the public login/home view. No blank authentication-required page was introduced.

## RBAC verification

Authentication and authorization remain separate. The database login path only establishes identity, school, role, and permissions. Existing route guards continue to enforce permissions through `canAccess` and the sidebar registry.

The tests verify that:

- Accountant access resolves Fee Hub/financial permissions but not Proprietor management access.
- Administrator access resolves administrative permissions without wildcard Proprietor access.
- Headteacher and Assistant Headteacher access resolves academic/administrative permissions without wildcard Proprietor access.
- Cross-role login selection is rejected.
- Disabled accounts are rejected with the generic login error.
- Unknown users and invalid passwords receive the same generic authentication failure.
- School scope is resolved from the database user row and retained in the authenticated session.

## Tests executed

| Test or check | Result |
|---|---|
| Part 3 staff authentication tests | **PASS** — 4 tests passed. |
| Existing Proprietor authentication tests | **PASS**. |
| Foundation/server routing tests | **PASS**. |
| Full `npm test` | **PASS** — 626 tests passed, 0 failed. |
| `npm run migration:validate` | **PASS** — 30 migrations discovered. |
| `git diff --check` | **PASS**. |
| Live production account login | **NOT RUN** — no configured production database in sandbox. |
| Browser QA using named live accounts | **NOT RUN** — no authorized live session/database available. |

## Branch

`main`

## Commit

No commit was created. The working tree is based on commit `cf1ce5e`.

## Files changed

- `src/auth.js`
- `src/server.mjs`
- `test/staff-authentication-part3.test.js`
- `docs/PART_3_STAFF_AUTHENTICATION_RBAC_REPORT.md`

Part 1 and Part 2 files were preserved. No Part 4 Fee Setup enhancement was implemented.

## Safety confirmations

- No plaintext staff password was stored in production schema, source code, logs, or reports.
- No duplicate authentication architecture was created.
- No separate staff login pages were created.
- The current School Portal endpoint remains the staff login endpoint.
- Existing Proprietor authentication compatibility was preserved and regression-tested.
- No production user record was deleted, duplicated, repaired, or provisioned because the live database was not available.
- No production data or migration was modified in this sandbox.

## Stop condition

Part 3 is complete and locally validated. Stop here. Do not implement Part 4 automatically.

## References

[1]: `src/auth.js` "Canonical authentication service, role aliases, password verification, sessions, and dashboards"

[2]: `src/server.mjs` "Existing School Portal authentication routes and configured database bootstrap"

[3]: `src/proprietor-authentication-controller.js` "Preserved Proprietor database authentication controller"

[4]: `test/staff-authentication-part3.test.js` "Part 3 database staff-login and RBAC regression tests"

[5]: `test/proprietor-authentication.test.js` "Existing Proprietor authentication regression tests"

[6]: `docs/PART_2_CONTROLLED_SCHEMA_UPGRADE_REPORT.md` "Part 2 canonical schema and migration report"
