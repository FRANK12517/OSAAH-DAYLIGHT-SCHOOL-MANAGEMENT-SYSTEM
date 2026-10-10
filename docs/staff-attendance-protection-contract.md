# Staff Attendance Protection Contract

**Contract version:** 1.0  
**Baseline audit:** [`staff-attendance-baseline-audit.md`](./staff-attendance-baseline-audit.md)  
**Baseline `main` SHA:** `456c2ce89f316611cf09e3042aafba487b67e0eb`  
**Scope:** Existing Staff Attendance register, overview, report/export integration, server APIs, persistence, authorization, and Staff Leave reconciliation. This contract protects the audited system; it does not authorize a redesign or change to unrelated student-attendance behavior.

## 1. Existing workflows to preserve

1. **Daily register:** authorized users reach `/staff-attendance.html` via `/attendance/staff` or `/staff/attendance`; choose academic year, term and date; load active school staff and scoped records; set supported status, reporting time and remarks; save; and view status counts and audit/source columns.
2. **Staff overview:** `/attendance` and `/api/attendance/staff/overview` provide role/status and week/month/date filters, staff summaries, eligible/missing days, and leave-aware calculations. Do not silently redefine its period or absence semantics.
3. **Staff reporting:** the existing canonical report service supports STAFF reports, print, PDF and XLSX alongside student and other report types. Staff data must be returned only to a user who has `staff.attendance.read`; other report types retain their existing authorization.
4. **Staff Leave reconciliation:** generated `LEAVE_RECONCILIATION`/`ON_LEAVE` records are controlled by approved Staff Leave and cannot be manually overwritten in the register. Reconciliation history and record identity remain intact.
5. **Dependent views:** preserve staff attendance data consumed by attendance analytics, the single-school overview, workforce intelligence, and reports. No staff-specific notification consumer was found in the audited repository; do not invent one.

The baseline audit records exact pages, routes, services, schema, and tests. Actual deployment role grants and live production schema/data were not inspected.

## 2. Access and scope invariants

- Server-side authorization is authoritative. Register and staff overview access require `staff.attendance.read`; register writes require `staff.attendance.write`. STAFF canonical report/print/export access additionally retains the existing Attendance Reports module gate (`attendance.read`) and requires `staff.attendance.read` as a data-scope gate. A student `attendance.read` grant alone must never disclose STAFF report rows or staff contact fields, and staff-register access alone must not silently grant the general reports module.
- Keep existing role grants: source defines staff-specific read/write for Headteacher and Assistant Headteacher, a configured HR test account, and wildcard access for the configured proprietor. Module visibility also declares proprietor, school-admin, headteacher, assistant-headteacher and HR roles as observed in `src/module-registry.js`; actual deployed `role_permissions` data is outside this source-only contract.
- Every query and write remains scoped to the authenticated `schoolId`. Staff identity uses the canonical `staff.id`, not a display employee number.
- Preserve registered sidebar destinations `/attendance/staff` and `/staff/attendance` and their current app-shell behavior. Direct HTML access does not grant API access; every data endpoint continues to require its server permission check.
- The server, not the browser, sets manual provenance. Never permit a browser request to impersonate leave reconciliation.

## 3. Data and write invariants

- Canonical identity: `staff_attendance.id`; required school/staff relationships; scope tuple protected by the unique index `(school_id, academic_year, term, attendance_date, staff_id, attendance_type)`.
- Preserve existing statuses/type mappings, date/year/term validation, record IDs on updates, staff identifiers, audit actor/time metadata, notes, time, source, leave linkage, and historical retrieval.
- The register must not overwrite approved leave. A repeated same-scope submission must not create a duplicate; the database unique constraint remains the final concurrent-insert safeguard.
- A durable Staff Attendance write and its attendance audit-history row must commit or roll back together. Staff note/time changes must not disappear from audit history merely because the status stayed the same.
- Preserve fields omitted by an update; an explicitly supplied `null` may clear an optional note/time. Every user-driven update must include the row's last-seen `updatedAt`; the API rejects missing, invalid, or stale versions with HTTP 409. Durable updates read the row `FOR UPDATE`, compare the version inside the transaction, and update conditionally against the persisted timestamp. Internal leave reconciliation continues through the transactional repository path and remains governed by its reconciliation rules.
- No routine code, CI job, or deploy may delete, reset, truncate, or silently transform attendance records.
- Keep test/demo/sample records out of production-facing staff summaries and reports. Do not infer that a manual/leave `source` is itself a test-data marker; this baseline schema has no dedicated staff sample-provenance column.
- No production records may be used in tests. No destructive or live production migration is part of this task.

## 4. Schema and migration controls

The checked-in migration chain defines the base table in `schema/006_attendance.sql`, the scoped unique index in `schema/034_attendance_academic_scope.sql`, status/source/note/leave fields in `schema/035_staff_leave_attendance_reconciliation.sql`, and actor/audit-history metadata in `schema/036_attendance_provenance_audit.sql`. Generic migration validation checks names, versions, checksums, baseline/order and migration ledger; it does not by itself prove the currently applied production schema.

For every future migration affecting staff attendance or a dependency:

1. State the purpose and affected API/report/identity/audit workflows in the PR.
2. Prefer additive, backward-compatible changes; preserve existing rows, keys, staff identity, and history.
3. Add or update isolated schema/behavior tests and run the Staff Attendance suite plus `npm run migration:validate`.
4. Use expand-and-contract for incompatible changes, with explicit forward recovery. Never automatically apply a destructive production migration.
5. Review the exact migration diff for `DROP`, `TRUNCATE`, unscoped `DELETE`, lossy backfills, and removed constraints/indexes.
6. Run non-destructive release acceptance after migration; live production schema confirmation requires the existing authorized release process.

## 5. Regression and CI policy

Local focused command: `npm run test:staff-attendance`. It must include the dedicated `staff-attendance-*.test.js` tests and the Staff Leave reconciliation tests that mutate/reconcile staff attendance. The protected-components workflow must run this command on pull requests, pushes to `main`, and the authorized release/migration path, alongside (not instead of) existing student attendance tests, protected-component verification, and migration validation.

Behavioral tests must cover:

- authorized and unauthorized access, role grants, navigation aliases, school scoping, and protected STAFF report/export access;
- staff roster, academic/date validation, create/update identity, supported statuses, time/note/source/audit metadata, leave-protected rows, duplicate/conflict responses, stale concurrent edits, omitted-field preservation/explicit clearing, and historical reads;
- overview filters, deduplication, missing-day semantics, leave reconciliation, STAFF report/print/PDF/XLSX behavior and data isolation;
- SQL-backed staff create/update/read, duplicate-key race, stale-version conflict, audit failure rollback, and migration/schema invariants using isolated fakes or test fixtures;
- exact required CI command and migration validation, so omitted tests or weakened gates fail reviewable checks.

Tests that do not run or are inconclusive are not passes. Full-suite failures must be reported with the failing test names and compared with the unmodified baseline when they are outside Staff Attendance.

## 6. Pre-release acceptance (read-only/non-destructive)

Before release, on the exact candidate SHA:

- build the application and run `npm run test:staff-attendance`, existing attendance regressions, `npm test`, `npm run protection:verify`, and `npm run migration:validate`;
- verify CI has actually executed and passed the Staff Attendance job, and confirm the job is a **required** branch/release check rather than merely a green optional workflow;
- verify the deployed SHA and deployment readiness;
- use authorized read-only checks to confirm the expected route/assets are present and that authorized/unauthorized API behavior matches the tests;
- exercise a synthetic/mock-data browser session at narrow mobile, tablet, and desktop widths; confirm no page-level horizontal overflow, wide tables scroll inside their wrappers, and register load/save controls remain usable;
- do not create, update, or delete real attendance records to smoke-test production.

A green Vercel deployment alone is not evidence that the attendance workflow, permissions, reports, or data integrity are correct.

## 7. Intentional changes and existing findings

Any deliberate change to a protected workflow, role grant, response, schema, report definition, or data invariant requires an explicit PR rationale, impact analysis, tests, contract update, and the repository's required approval. Do not weaken a failing test merely to pass CI.

The baseline audit identified overview academic-year/term filtering and labels, staff trend deduplication identity, staff note/time audit coverage, staff SQL transaction behavior, staff report authorization, direct unregistered-asset behavior, and gaps in report/export/browser integration coverage. This implementation adds regression coverage and fixes the staff transaction/audit behavior and report data-scope authorization; the overview/filtering, direct-asset, and remaining integration-coverage findings remain separate follow-ups. This contract is not a claim that external production data, applied schema, or role grants were verified.

The final full `npm test` run reproduces seven known, out-of-scope Migration 078 failures in `test/admissions-078-sanitized-diagnostics.test.js`: complete-preflight summary, failed-preflight summary, sensitive-field allow-list, engine/prerequisite checks, duplicate/orphan/index/sequence findings, approved schema-column definitions, and `NOT_CHECKED` handling. The focused Staff Attendance suite, protected-component verifier, and migration inventory validator pass; the full repository test suite must not be reported as green until the Migration 078 failures are separately resolved.

## 8. Gate status limitation

At the audited baseline, `main` has strict checks but requires only `Verify protected login assets`; it has zero required approving reviews and CODEOWNERS review is disabled. The attendance workflow can produce a passing GitHub check, but that fact alone does not make it a merge/deployment gate. Repository administration permission is required to add the exact attendance check as required. Until GitHub confirms that status context is required, report the gate as **configured to run but not enforced**, and do not claim that attendance failures block merges or releases.
