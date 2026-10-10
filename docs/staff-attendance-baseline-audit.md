# Staff Attendance Baseline Audit

**Audit date:** 2026-10-10  
**Repository:** `/home/ubuntu/osaah-school`  
**Baseline:** `main` at `456c2ce89f316611cf09e3042aafba487b67e0eb`  
**Worktree:** clean (`## main...origin/main`)  
**Audit mode:** read-only source, test, schema, workflow, and branch-protection inspection

> This is a **baseline description of the checked-in repository**, not an implementation contract. It records observed code paths, tests, workflows, and risks at the stated SHA. It does not approve, require, or define future behavior.

## Executive summary

The repository contains two related Staff Attendance experiences:

- A dedicated register at `/staff-attendance.html`, used through the registered aliases `/attendance/staff` and `/staff/attendance`.
- A separate attendance overview at `/attendance`, backed by `/attendance-overview.html`, with staff filters, summaries, and tables alongside student reporting and analytics.

The dedicated register loads academic year, term, and date-scoped staff data; supports per-row status, time, and remarks; protects approved leave rows from manual editing; and writes one staff-attendance record per eligible row. The server requires `staff.attendance.read` for register/report/overview reads and `staff.attendance.write` for writes, scopes data to the authenticated school, forces manual writes to `source=MANUAL`, records actor metadata, and preserves an existing record ID on update.

Focused tests cover important authorization, academic-scope, navigation, provenance, leave-reconciliation, overview, and school-isolation behavior. However, browser interaction, several HTTP error paths, durable staff-repository behavior, staff report/export authorization, exact overview period filtering, and production migration/data state are not established by the inspected baseline.

The current main branch rule, as verified separately, is strict status-check protection with **only `Verify protected login assets` required**; required approving reviews are `0`, and CODEOWNERS review is `false`. The attendance/protected-components workflow is **not** a required status check and must not be represented as one.

No real student or staff records, credentials, production services, or live production database state were accessed. No tests, migrations, or workflows were executed for this read-only audit.

## Scope, evidence conventions, and data handling

This report synthesizes the supplied read-only audit outputs. File references use absolute repository paths and line ranges or named symbols where available. “Verified” means supported by checked-in source, tests, or configuration at the baseline SHA; it does not mean that a live deployment was probed.

No real student/staff records are reproduced. Test fixtures and example values are discussed only by behavior, status, field, or source semantics. The audit did not query production data or expose personal information.

### Failed audit areas

The audit result supplied no failed audit areas. Verbatim failure payload:

```json
{"failures":[]}
```

This means no audit area was reported as a formal failure; it does **not** mean that all risks, unknowns, or recommended follow-up work were absent.

## 1. Staff Attendance UI, navigation, and dashboard access

### Checked-in implementation and actual paths

- Dedicated register: `/home/ubuntu/osaah-school/public/staff-attendance.html`.
  - Markup and controls are at lines 32–73.
  - Inline client functions include `getJson`, `populateTerms`, `clearRegister`, `recordForStaff`, `renderRegister`, `renderReport`, `loadOptions`, `loadRegister`, and `saveAttendance` (lines 76–305).
  - This behavior is implemented in the page’s inline script rather than an external JavaScript module.
- Separate overview: `/home/ubuntu/osaah-school/public/attendance-overview.html`.
  - Staff filters/table controls are at lines 15–28 and inline loading/rendering at lines 57–63.
  - The same page also contains student reporting and combined analytics (lines 29–55 and 64–81).
- Navigation and route aliases:
  - `/home/ubuntu/osaah-school/src/proprietor-sidebar-routes.js:24,37,56,61` maps `/attendance/staff` and `/staff/attendance` to the register page; `/attendance` maps to the overview.
  - `/home/ubuntu/osaah-school/src/sidebar-route-contract.js:19–26,35–40,54–63` maps the staff-attendance entries to `/staff-attendance.html` and `/api/attendance/staff`.
  - `/home/ubuntu/osaah-school/public/app.js:68,84–93` obtains `/api/sidebar`, renders navigation, and presents a route component in the app-shell iframe.
- Role/module declarations:
  - `/home/ubuntu/osaah-school/src/module-registry.js:14` registers the attendance-management module for `PROPRIETOR` and `SCHOOL_ADMIN`.
  - `:37` registers the staff-management/HR entry for `PROPRIETOR`, `SCHOOL_ADMIN`, `HEADTEACHER`, `ASSISTANT_HEADTEACHER`, and `HR_OFFICER`.
  - `/home/ubuntu/osaah-school/src/proprietor-sidebar-routes.js:24,37,56,61` shows two distinct sidebar modules targeting the same register page for overlapping proprietor/admin roles.
  - `/home/ubuntu/osaah-school/src/sidebar-registry.js:125–150` applies role, portal, permission, entitlement, feature, and enabled-state filtering.
  - `/home/ubuntu/osaah-school/src/auth.js:18,23,33` contains staff-attendance grants for Headteacher/Assistant Headteacher and both grants for the configured HR demo account.

### Verified UI behavior

- The register exposes academic year, term, date, **Load Register**, **Save attendance**, per-staff status/time/remarks, and a report table with status counts and audit/source columns (`staff-attendance.html:32–73,76–87`).
- On page load, the browser calls `/api/attendance/options`; it populates year/term choices and sets the date to local today (`staff-attendance.html:90–91,108–138,199–215,296–300`). Changing year repopulates terms. Changing year, term, or date clears the loaded register. Loading requires all three selections.
- Register loading calls `GET /api/attendance/staff` with `academicYear`, `term`, and `date`; the response supplies staff, records, and `attendanceOptions` (`staff-attendance.html:217–246`; server response path `src/server.mjs:943–956`). Missing options clear the register and show an error.
- Saving calls `POST /api/attendance/staff` once per eligible staff row through `Promise.allSettled`, carrying `staffId`, academic scope, type/status, optional time/note, and an existing record ID when present (`staff-attendance.html:249–294`). Partial failures are reported; successful rows are reloaded; full success dispatches `attendance:save-confirmed`.
- Staff identity is based on `member.id` for row keys and POST `staffId`; display ID prefers `employeeId`, then `staffNumber`, then `id` (`staff-attendance.html:168–179,269–282`).
- Remarks have `maxlength=500`; reporting time uses `type=time`; the client submits academic year, term, calendar date, status/type, optional time, and note (`staff-attendance.html:41–49,176–179,271–282`).
- Approved leave rows with `source=LEAVE_RECONCILIATION` and `status=ON_LEAVE` disable status/time/remarks controls and label the row as managed by Staff Leave (`staff-attendance.html:168–179`). The server independently blocks manual changes with HTTP 409 (`src/server.mjs:925–935`).
- The register report presents date, staff ID, status, source, leave reference, note, recorded-by/time, and updated-by/time (`staff-attendance.html:64–72,184–197`). Counts are based on returned records and offered statuses.
- The overview is separate from the register: it has week/month/role/status filters and staff summary/table output (`attendance-overview.html:15–28,57–63`). The standalone register has no export control in its markup (`staff-attendance.html:40–72,217–246`).
- Responsive styling uses horizontally scrollable tables with minimum widths of 760px and 800px; shared rules are at `/home/ubuntu/osaah-school/public/styles.css:39`, with reduced padding/font sizing at narrow widths (`staff-attendance.html:12–15,21–28,56–72`). At widths up to 759px, the sidebar becomes a drawer and the workspace becomes full-width (`styles.css:29–30,46–48`).

### Access and routing evidence

- The two Headteacher roles are expected to receive one Staff Attendance link and not student-attendance access through that grant (`test/staff-attendance-access.test.js:55–70`).
- The server checks registered module routes against authenticated user-visible sidebar modules (`src/server.mjs:1247–1258`). Unauthorized registered routes receive redirect/401/403 behavior.
- The literal `/staff-attendance.html` asset is resolved by static routing outside the registered-route guard (`src/server.mjs:1238–1277`, especially `1247–1266`). The page’s API calls remain guarded, but no focused test was found for unauthenticated direct access to that literal asset path. This is a source-control-flow finding, not a live HTTP probe.

### UI limitations and unknowns

- No identified browser-level test exercises register loading, status/time/remarks editing, partial-save failures, protected leave controls, reload/report rendering, or table scrolling at mobile widths.
- The two sidebar modules can map to the same page for overlapping `PROPRIETOR`/`SCHOOL_ADMIN` roles. The focused one-link assertion covers only `HEADTEACHER` and `ASSISTANT_HEADTEACHER`; intended proprietor/admin presentation is not locked by that test (`module-registry.js:14,37`; `test/staff-attendance-access.test.js:55–70`).
- No direct unauthenticated/unauthorized asset-path test exists for `/staff-attendance.html`.
- The report is selected by academic year/term/date, while the overview supplies week/month/role/status filters. The baseline does not establish a unified filter/export contract between these pages.
- No live browser or deployed-page state was checked. The observations above describe checked-in source only.

### Recommended follow-up

Add browser-level regressions for the existing inline flow, direct asset-route tests for registered aliases and the literal asset URL, role-by-role navigation assertions for proprietor/admin, and narrow-width checks preserving the current scroll-container behavior. Keep those tests aligned with the current page/API behavior unless a separately approved implementation contract changes it.

## 2. Staff Attendance HTTP APIs, domain services, and authorization

### Actual endpoints and symbols

- `/home/ubuntu/osaah-school/src/server.mjs`:
  - `createApp` and dependency wiring: lines 111, 174–179.
  - Authentication dispatch: lines 374–390.
  - Academic/staff validation helpers: lines 127–145.
  - Options endpoint: lines 771–788.
  - Report/print/export handlers: approximately lines 780–795.
  - Staff POST/GET/report handlers: lines 910–956.
  - Staff overview handler: lines 982–990.
- `/home/ubuntu/osaah-school/src/auth.js`:
  - `ROLE_PERMISSIONS`, `addStaffAttendanceRoleGrants`, `createAuthService`, and `canAccess` (lines 18–23, 49–51, 210–247, 249–277, 369).
- `/home/ubuntu/osaah-school/src/attendance.js:19–37` provides the in-memory attendance service, including staff save/upsert/find/list operations.
- `/home/ubuntu/osaah-school/src/attendance-repository.js:6–29` provides the durable repository, SQL projections, staff save/upsert/find/list operations, audit writing, and audit-history reads.
- `/home/ubuntu/osaah-school/src/staff-attendance-overview.js:38–62,65–87,91–138` implements overview deduplication, summarization, filters, and date-range logic.
- `/home/ubuntu/osaah-school/src/attendance-analytics.js:70–115` implements analytics composition and `staffCanRead` gating.
- `/home/ubuntu/osaah-school/src/attendance-reports.js:114–141` loads staff rows and builds staff reports/exports.
- `/home/ubuntu/osaah-school/src/staff-leave-reconciliation.js:1–36` defines staff statuses, type/status mappings, and leave decisions.

### Verified API behavior

- All `/api/attendance/*` requests pass through `authenticateAsync` using the `osaah_session` cookie or Bearer token; unauthenticated requests receive `401 ATTENDANCE_AUTH_REQUIRED` before route handling (`src/server.mjs:374–383`).
- `GET /api/attendance/options` accepts `attendance.read` or `staff.attendance.read`, returns school-scoped academic years/terms/classes plus today and `canCorrect`, and uses a generic service-failure response (`src/server.mjs:771–788`).
- `POST /api/attendance/staff` requires `staff.attendance.write` (`src/server.mjs:910–912`). It requires `staffId`, `academicYear`, `term`, `date`, and `type` or `status`; validates calendar date, staff membership in the authenticated school, and configured school year/term (`:910–925`, helpers `:127–145`).
- The server forces `source=MANUAL` and `leaveRequestId=null`, ignoring browser-supplied provenance. It blocks manual changes to approved generated `ON_LEAVE` rows and rejects duplicate/stale/mismatched IDs with 409 (`src/server.mjs:925–932`).
- A create returns 201; an update returns 200 and preserves the record ID. Successful writes emit a `StaffAttendance` CREATE/UPDATE audit event with actor-role metadata. Validation is 400, missing registration is 404, conflict is 409, lookup outage is 503, and other save errors are normalized to 400 (`src/server.mjs:933–940`).
- `GET /api/attendance/staff` and `/api/attendance/staff/report` are aliases requiring `staff.attendance.read`; supported filters are academic year, term, and date. The response is `{staff, records, total, counts, statuses, attendanceOptions}` (`src/server.mjs:943–956`). Reads use authenticated `user.schoolId`, active staff, optional scope/date/staff filters, and date/staff ordering (`src/server.mjs:125–133,948–953`; `src/attendance-repository.js:24–26`).
- `GET /api/attendance/staff/overview` requires `staff.attendance.read`, accepts academicYear, term, week, month, startDate, endDate, role, status, and asOfDate, and returns the overview service result or an error (`src/server.mjs:982–990`; `src/staff-attendance-overview.js:112–137`).
- Staff overview rejects an actor from a different school and uses school-filtered staff, leave, calendar, and attendance sources (`src/staff-attendance-overview.js:91–105,119–124`).
- Repository writes require actor school to equal requested school; staff registration and academic scope checks are school-scoped (`src/server.mjs:127–145`; `src/attendance-repository.js:6–7,23–26`).
- The application uses the durable repository only when database query/execute dependencies are supplied; otherwise it uses the in-memory service (`src/server.mjs:174–179`).

### Domain and authorization invariants

- Valid staff status vocabulary is `PRESENT`, `ABSENT`, `LATE`, `CHECKED_IN`, `CHECKED_OUT`, `ON_LEAVE`, and `EXCUSED`; `CHECK_IN`/`CHECK_OUT` map to checked-in/checked-out forms (`src/staff-leave-reconciliation.js:1–21`).
- The in-memory service generates UUIDs, defaults missing academic scope to `UNSPECIFIED`, validates date/status/source/time, and uses school/year/term/date/staff/type as map identity (`src/attendance.js:21,26–31`).
- The durable repository validates status/date/source/time, updates by existing ID scoped to school, and translates unique collisions to `Staff attendance already recorded` (`src/attendance-repository.js:8–11,23,26–27`).
- Successful manual writes call `createAuditLog` with actor and role metadata (`src/server.mjs:936`; `src/audit.js:1–3`). Durable persistence also writes `attendance_audit_history` (`src/attendance-repository.js:20,23`).
- `canAccess` returns true for `*` or the named permission (`src/auth.js:369`). Headteacher/Assistant Headteacher receive staff read/write grants through role augmentation (`src/auth.js:23,244,272`); dynamic database accounts may derive permissions from `role_permissions`, whose deployment values are not determined by source alone (`src/auth.js:210–216,244–245`).

### Authorization/reporting risk

The generic canonical report, print, and export routes accept `reportType=STAFF` but are guarded by `attendance.read`, not `staff.attendance.read` (`src/server.mjs:790–792`). Analytics separately applies `staffCanRead` (`src/attendance-analytics.js:85–90,104–109`), but `attendance-reports.js:116–129,134` can independently load staff records and assemble STAFF rows without that separate staff permission check. This is a concrete least-privilege mismatch risk and is not a claim that production is exploitable; it is a checked-in source finding requiring endpoint tests and an explicit authorization decision.

### API limitations and unknowns

- No focused test was found for rejected write roles, unknown/cross-school staff IDs, approved-leave 409, stale/mismatched IDs, duplicate HTTP submissions, database outages, or the detailed response-error contract (`test/staff-attendance-access.test.js:73–204` covers only a subset).
- No endpoint test was found for `/api/attendance/staff/overview` or the `/report` alias, nor for staff reportType=STAFF canonical/export/print permission boundaries.
- POST error mapping hides most underlying causes behind 400; GET failures are generic 503 (`src/server.mjs:938–955`).
- Durable audit-history comparison skips writes when prior status/reason/arrival/departure values equal new values, but staff uses note/time fields that are not compared there (`src/attendance-repository.js:20,23`). A same-status staff note/time edit may therefore emit the server audit event while not adding an `attendance_audit_history` row.
- No dedicated staff-attendance delete endpoint or HTTP audit-history retrieval endpoint was found. Repository/domain listing exists at `attendance-repository.js:28–29` and `attendance.js:36–37`, but is not exposed in the inspected attendance routes.

### Recommended follow-up

Add endpoint-level tests for every staff route/alias and least-privilege boundary, including cross-school IDs, leave conflicts, duplicate/stale writes, database failure behavior, and response shapes. Decide and enforce the staff permission required for STAFF reports/exports. Test and document audit-history behavior for note/time/source/leave-link changes. Record deployed `role_permissions` separately; module visibility is not proof of API authorization.

## 3. Persistence, schema, migrations, and migration validators

### Actual schema and repository paths

- Canonical staff identity: `/home/ubuntu/osaah-school/schema/001_foundation.sql:12–14,23–26`.
- Initial attendance tables: `/home/ubuntu/osaah-school/schema/006_attendance.sql:1–6`.
- Academic scope and unique identity: `/home/ubuntu/osaah-school/schema/034_attendance_academic_scope.sql:1–12`.
- Leave/status/provenance/reconciliation columns and table: `/home/ubuntu/osaah-school/schema/035_staff_leave_attendance_reconciliation.sql:1–32`.
- Recorded/updated metadata and shared audit history: `/home/ubuntu/osaah-school/schema/036_attendance_provenance_audit.sql:1–35`.
- Forward-only current-state reconciliation: `/home/ubuntu/osaah-school/schema/049_production_schema_reconciliation.sql:1–71`.
- Durable repository: `/home/ubuntu/osaah-school/src/attendance-repository.js:6–29`.
- SQL/TiDB adapter: `/home/ubuntu/osaah-school/src/ai/tidb-database-adapter.js:1–25,110–160`.
- Generic migration runner: `/home/ubuntu/osaah-school/src/platform/migration-runner.js:5–16,36–59,60–106,108–128`.
- Migration CLI: `/home/ubuntu/osaah-school/scripts/migrate.mjs:6–23`.

### Verified data model and invariants

- `staff` has primary key `id`, required school foreign key, optional unique user foreign key, required staff number, unique `(school_id, staff_number)`, and a school index (`schema/001_foundation.sql:12–14,23–26`).
- Initial `staff_attendance` includes `id`, `school_id`, `staff_id`, `attendance_date`, `attendance_type`, `attendance_time`, `entered_by`, and `created_at` (`schema/006_attendance.sql:1–2`).
- Migration 034 adds non-null academic year and term with legacy defaults and creates unique identity `(school_id, academic_year, term, attendance_date, staff_id, attendance_type)` (`schema/034_attendance_academic_scope.sql:6–12`; corresponding current-state definition `schema/049_production_schema_reconciliation.sql:32–38`).
- Migration 035 adds `attendance_status`, `attendance_source`, `leave_request_id`, `note`, `previous_status`, and update fields, with status default `PRESENT` and source default `MANUAL`; it also adds scoped staff/date and leave-link indexes (`schema/035_staff_leave_attendance_reconciliation.sql:8–17`).
- Migration 036 adds/backfills `recorded_by`, `recorded_at`, `updated_by`, `updated_at`, and source, and creates shared attendance audit history (`schema/036_attendance_provenance_audit.sql:6–17,19–35`).
- `leave_request_id` is nullable text on staff attendance without an inline FK in migration 035; reconciliation audit rows reference school, leave request, attendance, and actor (`schema/035_staff_leave_attendance_reconciliation.sql:10,19–32`). The 049 definition reproduces the audit table without inline FK clauses (`:58–71`).
- Dates/times are text fields. Repository validation accepts time-only `HH:mm[:ss]` or a parseable date-time and stores supplied values (`schema/006_attendance.sql:2`; `schema/035...:13`; `schema/036...:6–9`; `src/attendance-repository.js:8,11`).
- SQL DDL does not declare a CHECK constraint for staff status/type; status/type vocabulary is enforced in application code (`src/staff-leave-reconciliation.js:1–21`; `src/attendance-repository.js:23`).
- Staff attendance rows reference `staff(id)` and `schools(id)` independently; the initial DDL does not declare a composite FK tying attendance school to the staff member’s school (`schema/006_attendance.sql:2`; staff school ownership `schema/001_foundation.sql:14`). Application checks currently enforce school scope.
- `saveStaffAttendance` performs persistence, post-save read, and audit-history insertion as separate adapter operations; it does not call `adapter.transaction` (`src/attendance-repository.js:20–23`; transaction capability `src/ai/tidb-database-adapter.js:127–137`).
- The unique key protects exact tuple collisions but permits different attendance types for the same staff/date/scope (`schema/034_attendance_academic_scope.sql:12`).

### Migration and persistence dependencies

The durable adapter imports `mysql2/promise`, reads `DATABASE_URL`, and configures TLS; the source labels it a TiDB adapter (`src/ai/tidb-database-adapter.js:1,110–120`). No live connection was attempted.

Staff leave reconciliation can create/update staff attendance and emit reconciliation audit records (`src/staff-leave-reconciler.js:9–46`). The generic production data guard excludes `TEST`, `DEMO`, `SEED`, `DEVELOPMENT`, and `MIGRATION_VALIDATION` provenance values, but the inspected `staff_attendance` schema/projection has no explicit generic provenance column; `source`/`attendance_source` represent manual versus leave reconciliation, not a defined test-versus-production marker (`src/ai/production-data-guard.js:4–18`; `schema/035...:8–13`; `src/attendance-repository.js:14,16`).

The generic migration runner discovers numbered SQL files, rejects invalid names and duplicate versions, checks applied names/checksums, enforces baseline/predecessor/order rules, acquires a lock, and applies/records migrations transactionally (`src/platform/migration-runner.js:5–16,36–59,60–106,108–128`). It has no staff-attendance-specific required-column/index validator.

### Persistence limitations and unknowns

- No direct SQL-like adapter test covers `createAttendanceRepository.saveStaffAttendance`, duplicate-key handling, concurrency, or audit-write failure (`src/attendance-repository.js:20–23`; `test/attendance-repository-integrity.test.js:14–40,54–95` covers student operations).
- Source does not establish atomicity between attendance and audit rows; the adapter supports transactions, but staff saves do not use them.
- No staff-specific sample/provenance isolation assertion was found. Generic provenance tests do not prove staff SQL read/report isolation (`test/production-data-guard.test.js:14–27`).
- Generic migration validation cannot certify that production currently has the DDL shown in the repository. No live schema state was inspected.
- No production database, records, credentials, or external production service was accessed.

### Recommended follow-up

Add isolated repository tests for staff create/update/read, school isolation, duplicate/concurrent writes, and audit failure/rollback. Decide whether attendance plus audit history must be atomic; if so, use and test the existing adapter transaction capability. Add a dedicated non-production schema validator for required columns, FKs, indexes, uniqueness, and ordering. Define explicit staff sample-versus-production classification and test the actual staff read/report paths. Decide whether school ownership remains an application invariant or gains a compatible composite database relationship.

## 4. Reporting, exports, notifications/events, dashboard metrics, and dependent modules

### Actual reporting and dependent paths

- Unified reports: `/home/ubuntu/osaah-school/src/attendance-reports.js:5–6,37–65,89–112,114–141`.
  - Supports `STAFF` alongside `STUDENT`, `CLASS`, `GENDER`, `WEEKLY`, `MONTHLY`, `TERM`, and `ACADEMIC_YEAR`.
  - STAFF rows include staff ID/name/role, optional phone, present/absent/excused counts, and percentage.
  - Report JSON, print HTML, and PDF/XLSX export handlers are in `/home/ubuntu/osaah-school/src/server.mjs:780–795`.
- Report UI: `/home/ubuntu/osaah-school/public/attendance-report.html:12–43`, with generate, PDF, XLSX, and print actions.
- Staff overview service: `/home/ubuntu/osaah-school/src/staff-attendance-overview.js:52–62,65–87,112–140`.
- Combined analytics: `/home/ubuntu/osaah-school/src/attendance-analytics.js:45–61,80–90,92–97,104–115`.
- School overview: `/home/ubuntu/osaah-school/src/single-school-overview.js:32–46,61–80`.
- Workforce intelligence: `/home/ubuntu/osaah-school/src/ai/admissions-workforce-intelligence.js:21–25`.
- Academic attendance intelligence: `/home/ubuntu/osaah-school/src/ai/academic-attendance-intelligence.js:19`.
- Notifications route observed in `/home/ubuntu/osaah-school/src/server.mjs:992`; the student-register save event is at `/home/ubuntu/osaah-school/public/attendance-register.js:217`.

### Verified reporting behavior

- Staff overview returns per-staff week/month/base-period present and absent counts, approved leave, attendance percentage, eligible days, missing days, and totals (`src/server.mjs:982–990`; `src/staff-attendance-overview.js:119–136`). The page sends academicYear, term, week, month, role, and status (`public/attendance-overview.html:63`).
- Overview deduplicates by staff/date using status priority and timestamps, excludes test records, treats weekends/holidays/outside employment dates as ineligible, excludes approved leave from absent counts, and emits missing days rather than treating unmarked weekdays as absences (`staff-attendance-overview.js:52–87,106–110,127–136`).
- The combined analytics service publishes staff KPI summary, distribution, present/absent/leave comparisons, monthly comparison, and trends (`attendance-analytics.js:104–113`).
- The school overview reads same-day staff attendance and conditionally returns staff metrics based on permission (`single-school-overview.js:32–46,61–80`). Workforce intelligence reads and sanitizes staff attendance for check-in/late/absent metrics (`admissions-workforce-intelligence.js:21–25`).
- Report JSON/print/export routes generate report and export audit events (`server.mjs:780–795`; `attendance-reports.js:137–141`).
- The dedicated register itself has no export button/download flow (`public/staff-attendance.html:35–70,203–229,282`).
- No staff-specific attendance notification integration or staff attendance change-event consumer was found in the searched tracked source. The observed `attendance:save-confirmed` event belongs to the student register, not evidence of a staff notification system.

### Consistency and authorization risks

- Staff overview loads attendance records by school and then filters only school ID; requested academic year/term are not directly applied to the records. Academic year can affect range lookup, but term is not applied to records, and the same base counts are labelled both `totalPresentInTerm` and `totalPresentInAcademicYear` (`staff-attendance-overview.js:112–132`).
- Overview, analytics, and report deduplication differ. Overview chooses status priority per staff/date (`staff-attendance-overview.js:52–62`), while analytics/report effective-record helpers use latest version/timestamps (`attendance-analytics.js:45–56,92–97`; `attendance-reports.js:37–47`). Analytics’ identity fallback uses profile/student IDs and not `staffId`, creating a concrete risk that staff-only records are omitted from staff trends (`attendance-analytics.js:45–56,92–97,108–113`).
- Staff report rows are created only for staff IDs with effective attendance records; `recordCounts.unmarked` initializes to zero and the report does not calculate staff eligibility/missing days (`attendance-reports.js:49–65,125–129`).
- Report routes use `attendance.read`, and STAFF rows are assembled without the separate `staffCanRead` gate noted in Section 2 (`server.mjs:780–795`; `attendance-reports.js:116–129`). This should be reviewed before relying on report confidentiality.
- No unified test enforces consistency of status priority, leave treatment, eligible days, missing marks, sample exclusion, and filters across overview, analytics, report, and export paths.

### Reporting limitations and unknowns

- No dedicated regression test verifies nonempty STAFF report rows, exact report filters, totals against overview totals, print contents, PDF/XLSX contents, or export permissions. Existing report tests use student-only records (`test/attendance-reports-part5.test.js:5–32,35–61`).
- No proof was found that staff trends include canonical `staffId`-only records.
- No staff-specific notification or event consumer was found; any integration outside the tracked repository remains unknown.
- Academic-year/term semantics and period labels require fixture-based verification.
- No deployed dashboard or report output was opened.

### Recommended follow-up

Add end-to-end STAFF report JSON/print/PDF/XLSX tests with nonempty fixtures, exact filters, totals, sample exclusion, audit events, and same-snapshot assertions. Enforce and test the intended staff permission on STAFF reports/exports. Align overview filtering and period labels, make staff identity explicit in trend deduplication, and either calculate missing eligible staff days consistently or mark that metric unsupported. Document the verified absence of staff notifications/events until an external integration is identified.

## 5. Tests, CI, release workflows, and protection controls

### Existing tests and test boundaries

The main focused suites and evidence are:

- `/home/ubuntu/osaah-school/test/staff-attendance-access.test.js:55–70,73–182,184–204` — leadership sidebar visibility; page/API access; options; invalid dates/periods; teacher denial; create/update/provenance/audit semantics; stable IDs; school-scoped canonical staff IDs using an in-memory service and a database query stub.
- `/home/ubuntu/osaah-school/test/staff-attendance-overview.test.js:29–56` — corrected-mark deduplication, sample exclusion, approved leave, missing-day behavior, role/status/week filtering, and invalid filters.
- `/home/ubuntu/osaah-school/test/staff-leave-reconciliation-part3.test.js:26–102` — pending/rejected/approved leave, generated/reclassified/restored attendance, conflict behavior, changed date ranges, and year/term-separated summaries.
- `/home/ubuntu/osaah-school/test/attendance-academic-scope.test.js:67–85` — staff academic scope, duplicate prevention, and logical identity preservation on status changes.
- `/home/ubuntu/osaah-school/test/attendance-provenance-part4.test.js:27–50,50–54` — actor provenance, cross-school/audit-read rejection, leave reconciliation, and status retention.
- `/home/ubuntu/osaah-school/test/attendance-analytics-part4.test.js:36–76` — analytics composition, deduplication, sample exclusion, and filter validation; not comprehensive staff-trend coverage.
- `/home/ubuntu/osaah-school/test/attendance-navigation-part1.test.js:9–35`, `/home/ubuntu/osaah-school/test/school-route-contract.test.js:5–6`, `/home/ubuntu/osaah-school/test/all-role-routing.test.js:56–98,118–152`, and `/home/ubuntu/osaah-school/test/part29-sidebar-release-gate.test.js:20–38` — route and navigation integrity.
- `/home/ubuntu/osaah-school/test/attendance-repository-integrity.test.js:54–95` — transaction/rollback/duplicate/version behavior for student attendance SQL assertions, not staff-specific saves.
- `/home/ubuntu/osaah-school/test/migration-runner.test.js:12–33` — generic migration ordering/checksum/baseline/lock/rollback/validation behavior.
- `/home/ubuntu/osaah-school/test/production-data-guard.test.js:14–53` — generic provenance/sample guard behavior, not staff repository integration.
- `/home/ubuntu/osaah-school/test/attendance-reports-part5.test.js:5–32,35–61` — student report and PDF/XLSX behavior; no nonempty STAFF report fixture.

**Tests were inspected but not run. No pass/fail result is claimed.**

### Actual checked-in workflows and commands

- `/home/ubuntu/osaah-school/.github/workflows/protected-components.yml:1–21` (`Verify protected components`):
  - PR and push workflow for main.
  - Uses `actions/checkout@v4`, `actions/setup-node@v4`, Node 22, and `npm ci` (`:11–16`).
  - Runs the marker checker and then the explicit Node test glob `test/attendance-*.test.js test/staff-attendance-*.test.js test/student-attendance-*.test.js test/part1-mobile-attendance-result-slip.test.js` (`:18–19`).
  - Runs `npm run migration:validate` (`:20–21`/workflow step configuration).
  - The filename glob includes the two `staff-attendance-*.test.js` files but omits `test/staff-leave-reconciliation-part3.test.js`, despite that suite exercising Staff Attendance behavior.
- `/home/ubuntu/osaah-school/config/protected-components.json:58–162` defines a protected `student-attendance-register` component but no Staff Attendance component.
- `/home/ubuntu/osaah-school/scripts/verify-protected-components.mjs:5–17` checks listed file existence and marker strings; it does not execute behavioral tests or compare API/schema snapshots. Staff-specific source/API/schema/permission markers consequently have no analogous manifest protection check.
- `/home/ubuntu/osaah-school/package.json:7–20` defines `npm test` as `node --test`, `migration:validate` as `node scripts/migrate.mjs validate`, `protection:verify` as the marker checker, and `assets:verify` as the login-asset checker. No build, lint, or typecheck script is declared there.
- `/home/ubuntu/osaah-school/.github/workflows/login-assets-integrity.yml:3–16,21–36` runs the login-asset integrity check for path-filtered PR/push events using Node 20 and `npm ci`.
- `/home/ubuntu/osaah-school/.github/workflows/production-db-migration.yml:3–55` is manually dispatched, uses a production environment/database secret, applies an admission migration, then runs repository tests with `DATABASE_URL` cleared. It is not an attendance-specific release acceptance workflow.
- `/home/ubuntu/osaah-school/vercel.json:3–19` configures `src/server.mjs` as the Vercel Node build and catch-all route. No checked-in GitHub Actions deploy/release workflow providing Staff Attendance acceptance was identified.

### Branch protection baseline (explicit)

The current main branch rule, verified by the parent audit, is:

- strict required status checks;
- exactly one required check: **`Verify protected login assets`**;
- required approving reviews: **0**;
- CODEOWNERS review: **false**.

**The protected-components/attendance workflow is not a required status check.** A green or failing attendance workflow therefore is not, by itself, evidence of a required merge blocker under the current main branch rule.

### CI/release limitations and unknowns

- The repository has no Staff Attendance entry in the protected-components manifest, so marker-only protection does not cover staff behavior.
- The PR/push protected-components workflow does not invoke full `npm test`; the full command appears in the manually dispatched production migration workflow rather than as a verified required attendance check.
- No workflow proves database-backed staff writes, migration compatibility/data preservation, concurrency behavior, or staff report/export acceptance.
- No actual CI run, migration, deployment, production database query, or live branch-settings mutation occurred during this audit.
- The login-asset workflow is unrelated to Staff Attendance; its path-filtered trigger must not be described as an attendance release gate (`login-assets-integrity.yml:5–16`).

### Recommended follow-up

Add Staff Attendance as an explicit protected component with source/API/schema/permission markers, add a dedicated attendance CI job that includes leave reconciliation, and only describe it as a merge gate if branch protection actually requires its check context. Add non-destructive staff schema/data-preservation checks and authorized release acceptance. Document the focused glob, full `npm test`, omitted leave-test filename, and required versus non-required checks.

## Checked-in code versus unverified production state

### Established from the checked-in baseline

- The repository was at the supplied SHA on `main` with a clean worktree.
- The files, symbols, route aliases, API handlers, authorization checks, schema migrations, tests, workflows, and source-level risks cited above exist as described at that SHA.
- The current branch rule requires only `Verify protected login assets`, with zero approving reviews and no CODEOWNERS review requirement.

### Not established by this audit

- Whether the deployed production application serves exactly this commit or has matching routing, permissions, feature flags, or static assets.
- Whether production has applied migrations 034, 035, 036, 049, or any other exact schema state; generic migration source cannot certify live state.
- Which database `role_permissions` rows, staff records, leave rows, audit rows, sample rows, or report outputs exist in production.
- Whether production has any external notification, event-consumer, deployment, or integration not present in tracked source.
- Whether live HTTP behavior matches source, including direct access to `/staff-attendance.html`, report permission boundaries, API failure mappings, or responsive browser behavior.
- Whether any tests/workflows pass in CI, whether the database is healthy, or whether a release is safe.

No real records or production state should be inferred from this baseline. Any implementation, remediation, or release decision requires a separately authorized change and verification plan.

## Baseline recommendations in priority order

1. **Authorization:** test and enforce the intended `staff.attendance.read` boundary for STAFF report JSON/print/PDF/XLSX routes; add all dedicated staff endpoint error and cross-school tests.
2. **UI:** add browser-level register and responsive tests, including partial saves, protected leave, direct asset access, and report rendering.
3. **Reporting semantics:** align academic-year/term filtering and labels, staff trend identity, deduplication/status policies, and missing-day calculations across overview, analytics, reports, and exports.
4. **Persistence:** add staff-specific adapter tests for duplicate/concurrent writes, rollback/audit atomicity, school isolation, and audit-history behavior for note/time changes.
5. **Schema/data protection:** add staff-specific schema validation and explicit test/sample classification; do not treat `source=MANUAL` or `LEAVE_RECONCILIATION` as generic production provenance without a defined contract.
6. **CI/release:** add Staff Attendance protection and focused CI coverage, include leave reconciliation, and distinguish clearly between configured workflows and the current required branch check.
7. **Production verification:** separately inspect authorized live migration ledger/schema, deployed permissions, routing, and representative synthetic/non-sensitive behavior; do not use real student/staff records in this baseline report.
