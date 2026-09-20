# OSAAH Part 8 — Production Schema Reconciliation Report

**Verification date:** 2026-09-20  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Production domain:** https://www.osaahdaylightschool.online  
**Part 8 release baseline:** `4f3c547cc4b6a90f118a1d3c2dd0a920277214c8`  
**Part 8 tooling commit:** `1628019`  
**Production deployment:** `dpl_HDu6LHRdEXuM8ryQiEcRJCujvNin`

## Final verdict

**PRODUCTION DATABASE SCHEMA RECONCILIATION BLOCKED BY CREDENTIAL-SOURCE MISMATCH.**

The Vercel runtime evidence shows the application reaches TiDB and receives `ER_NO_SUCH_TABLE` (errno `1146`, SQL state `42S02`) while executing the school authentication query. The new read-only GitHub Actions inventory, using the protected GitHub Actions `DATABASE_URL`, fails earlier with `ER_ACCESS_DENIED_ERROR` (errno `1045`, SQL state `28000`). Therefore the GitHub Actions secret does not currently authenticate to the same production database credential source used by Vercel, and production table inventory cannot yet be safely established.

No production table was created, altered, dropped, migrated, truncated, or deleted. No users, password hashes, students, fees, payments, or relationships were modified.

## A. Verified error

| Evidence source | Result |
|---|---|
| Vercel runtime logs | `ER_NO_SUCH_TABLE`, errno `1146`, SQL state `42S02` on `POST /api/auth/login`. |
| GitHub Actions read-only inventory | `ER_ACCESS_DENIED_ERROR`, errno `1045`, SQL state `28000` before schema queries could execute. |
| Browser response | Safe `Authentication service unavailable.` response. |

The previous 1045 credential failure is not the current Vercel runtime failure; it is still present in the GitHub Actions protected secret used by the inventory workflow.

## B. Exact authentication query contract

**Query source:** `src/auth.js`  
**Function:** `createAuthService().loginFromDatabase`  
**Route path:** `POST /api/auth/login` → server authentication route → `auth.loginFromDatabase`

The application query selects:

- `users u`: `id`, `school_id`, `username`, `email`, `password_hash`, `status`;
- `user_roles ur`: user-to-role relationship through `user_id`;
- `roles r`: canonical `role_key` through `role_id`;
- `role_permissions rp`: role-to-permission relationship through `role_id`;
- `permissions p`: permission key through `permission_id`.

The SQL source is the canonical query in `src/auth.js`, which begins with `FROM users u` and joins `user_roles`, `roles`, `role_permissions`, and `permissions`.

**Missing table named by the sanitized runtime log:** **Not yet available.** The existing runtime diagnostic logged only error code, errno, and SQL state. This release adds a safe parser that will log only the final table name from an `ER_NO_SUCH_TABLE` message on the next reachable login attempt, without logging the database name, host, credentials, SQL, or password data.

The first expected table is `users`, created by the canonical foundation migration, but this report does not claim that `users` is the physical missing object until the sanitized table identifier or read-only production inventory confirms it.

## C. Canonical migration evidence

Migration `schema/001_foundation.sql` creates the authentication foundation tables:

- `schools`;
- `users`;
- `staff`;
- `roles`;
- `permissions`;
- `user_roles`;
- `role_permissions`.

Migration `schema/031_controlled_schema_upgrade.sql` assumes those foundation tables already exist and only adds canonical role upserts, indexes, enrollment support, class-label metadata, and Fee Hub indexes. It intentionally does not create duplicate authentication tables.

The repository contains 30 numerically ordered SQL migrations according to `npm run migration:validate`. That validates repository migration files only; it does not prove that those migrations were applied to production TiDB.

## D. Production database target and inventory

| Check | Result |
|---|---|
| Expected database | `osaahdaylightschool` |
| Vercel `DATABASE_URL` variable | Present; value not exposed. |
| GitHub Actions `DATABASE_URL` variable | Present; value not exposed. |
| Vercel runtime database authentication | Reached SQL execution and returned 1146. |
| GitHub Actions read-only database authentication | Failed with 1045. |
| `SELECT DATABASE()` via GitHub inventory | **NOT EXECUTED** because authentication failed first. |
| `SHOW TABLES` / information-schema inventory | **NOT EXECUTED** because authentication failed first. |
| Production migration history | **NOT VERIFIED**. |
| Legacy-table comparison | **NOT VERIFIED**. |

The evidence establishes a credential-source mismatch between the Vercel Production environment and the GitHub Actions Production environment. It does not establish whether the Vercel-connected database is the expected `osaahdaylightschool` database, nor whether its canonical migrations or legacy tables are present.

## E. Root cause classification

**Verified cause:** deployment environment credential mismatch between Vercel and GitHub Actions, preventing the controlled read-only inventory from connecting.

**Not yet verified:**

- unapplied migration;
- legacy/canonical schema drift;
- obsolete query;
- renamed table;
- wrong database;
- exact physical table missing in the Vercel-connected database.

No schema correction can be selected responsibly until the inventory runs against the same valid production connection used by Vercel.

## F. Data preservation

| Preservation check | Result |
|---|---|
| Existing users preserved | **PASS — no mutation performed.** |
| Password hashes preserved | **PASS — no mutation performed and no hashes read.** |
| Students preserved | **PASS — no mutation performed.** |
| Permanent Student IDs preserved | **PASS — no mutation performed.** |
| Fees preserved | **PASS — no mutation performed.** |
| Production migration applied | **NO** |
| Duplicate users created | **NO** |

## G. Repository changes

| File | Purpose |
|---|---|
| `scripts/production-schema-inventory.mjs` | Read-only TiDB inventory: `SELECT DATABASE()`, table list, migration candidates, and expected-table columns. |
| `.github/workflows/production-schema-inventory.yml` | Manual read-only workflow using the protected GitHub Actions Production secret. |
| `test/part8-schema-reconciliation.test.js` | Locks the exact auth query/table contract and prevents destructive inventory behavior. |
| `src/auth.js` | Adds sanitized missing-table extraction to runtime diagnostics; does not change the client response or authentication behavior. |
| `docs/PART_8_PRODUCTION_SCHEMA_RECONCILIATION_REPORT.md` | This report. |

No migration was applied or created because production schema state remains unverified.

## H. Live authentication and Fee Setup

| Area | Result |
|---|---|
| Accountant | **NOT VERIFIED** |
| Administrator | **NOT VERIFIED** |
| Headteacher | **NOT VERIFIED** |
| Assistant Headteacher | **NOT VERIFIED** |
| HTTP 503 resolved | **FAIL / NOT RESOLVED** |
| Fee Setup | **NOT TESTED** — authentication remains broken. |
| Class dropdown | **NOT TESTED** |
| Fee publication | **NOT TESTED** |
| Parent visibility | **NOT TESTED** |

Per the specification, Fee Setup testing was not started while authentication remained broken.

## I. Automated validation

- `node --test test/part8-schema-reconciliation.test.js`: **PASS**;
- `npm test`: **635 passed, 0 failed**;
- `npm run migration:validate`: **PASS — 30 repository migrations valid**;
- `npm run assets:verify`: **PASS — 12 protected assets verified**;
- `git diff --check`: **PASS**.

## J. Required next action

Correct or synchronize the protected GitHub Actions Production `DATABASE_URL` so the read-only inventory uses the same valid production credential/endpoint as Vercel. Do not change the Vercel `DATABASE_URL` again unless the database owner explicitly confirms the target.

Then dispatch `Production schema inventory` against the tested `main` commit and review:

1. `SELECT DATABASE()` target;
2. complete table inventory;
3. authentication-table metadata and `SHOW CREATE TABLE` equivalents;
4. migration-history records;
5. legacy-table candidates;
6. exact missing table identifier.

Only after that evidence is available may the minimum forward migration or legacy-data reconciliation be selected. Do not reset TiDB, create guessed tables, recreate users, change passwords, delete data, or bypass authentication.

## K. Git and deployment

| Item | Value |
|---|---|
| Pull request | [#77](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/77) |
| Merged main commit | `2449adbdc770c2dcee4eed8f9638889183d18370` |
| Production deployment | https://osaah-daylight-school-management-system-8sjxs0zri.vercel.app |
| Deployment status | **READY** |
| Public domain | https://www.osaahdaylightschool.online |

**Critical stop condition:** production schema reconciliation remains blocked until the credential-source mismatch is corrected and the read-only inventory succeeds.
