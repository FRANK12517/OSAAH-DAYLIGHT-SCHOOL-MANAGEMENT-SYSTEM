# Attendance Register Integrity

This document defines the compatibility contract and release safeguards for the “Today's Attendance” register. It uses synthetic data only; do not place real student or attendance data in tests, fixtures, screenshots, or repository files.

## Root cause and scope

The baseline browser client called `response.json()` for every response without first checking the HTTP status or `Content-Type`. Its error path then cleared the current register. A backend/query/authentication failure that returned HTML, text, an empty body, or malformed JSON therefore surfaced as a JSON parse exception instead of a controlled attendance error.

The register handler also had incomplete data-source boundaries: it accepted the `sampleMode` flag but its normal roster came from the in-memory student service rather than the canonical period-scoped durable enrollment relation, and sample saves could be routed through the official attendance repository. Uncaught failures from database-backed option/register work were not consistently converted into JSON. These are confirmed code-level defects. No authenticated browser Network capture of the original incident was available, so the exact body returned during that reported click (HTML, text, or another invalid payload) is **not independently verified**.

## Attendance API contract

The register UI uses authenticated, school-scoped endpoints:

- `GET /api/attendance/options` — returns configured academic years, terms, classes, and the school-local `today` value.
- `GET /api/attendance/register?classId=…&academicYear=…&term=…&date=YYYY-MM-DD&sampleMode=true|false` — returns one authoritative register for exactly the requested class, period, date, and mode.
- `POST /api/attendance/students/sync` — accepts a non-empty, single-scope batch of at most 500 records; each row must belong to that same class, academic year, term, and date.

Success keeps legacy top-level properties for existing consumers and also supplies the documented envelope:

```json
{
  "success": true,
  "data": { "classId": "…", "academicYear": "…", "term": "…", "date": "YYYY-MM-DD", "sampleMode": false, "register": [] },
  "message": "Register loaded successfully.",
  "register": []
}
```

Errors use an HTTP error status and a safe JSON envelope; internal SQL diagnostics are logged with endpoint, safe error code/type, school ID, and role, and are not returned to the browser:

```json
{
  "success": false,
  "data": null,
  "message": "The attendance service is temporarily unavailable. Please retry.",
  "error": "The attendance service is temporarily unavailable. Please retry.",
  "code": "ATTENDANCE_SERVICE_UNAVAILABLE"
}
```

A successfully loaded empty class is `200` with `register: []`; it is not an API failure. Existing export/print endpoints retain their established PDF/HTML response types. Uncaught errors and unknown `/api/attendance/*` routes are serialized as JSON.

## Domain and data-source invariants

1. **Normal mode:** Read active, school-scoped enrollment rows joined to the selected academic year and term. Use stable `student_profiles.id` and canonical `classes.id`; do not infer membership from browser data or the in-memory sample roster.
2. **Period/date:** Resolve the selected year/term within the actor's school; reject impossible dates and dates outside the selected academic year or term. `today` is computed from the configured school timezone (`OSAAH_SCHOOL_TIMEZONE`, then `schoolInformation.timezone`, then the documented `Africa/Accra` default), without a UTC ISO date truncation.
3. **Teacher scope:** Educators can load or save only a class in their authorized assignments. All query and write scopes include the authenticated school ID.
4. **Sample / Test mode:** The checkbox is sent explicitly. The normal register queries only real active enrollments; sample mode returns only configured sample students. With durable storage, sample attendance is stored as the `attendance` type in `sample_data_fixtures`; it never inserts, updates, or deletes `student_attendance`. Without durable fixture persistence, it uses only the in-memory test-record path. Test rows do not trigger official notifications or analytics events.
5. **Uniqueness:** The existing schema's school/year/term/date/class/student/subject identity constraint (migration `034_attendance_academic_scope.sql`) remains the database-level duplicate guard. Do not remove or weaken it.
6. **Updates:** New marks do not require a version. Changing an existing official mark requires `attendance.correct` and the current optimistic `version`; saved marks are read-only in the UI for other educators. The UI submits only changed rows, and the SQL update is additionally guarded by `WHERE … version=?`. A stale, missing, or disappeared row is a conflict, not a last-write-wins overwrite or silent recreation.
7. **Audit/atomicity:** Durable attendance batches require a database transaction. If the adapter cannot provide one, a multi-record batch fails closed. Existing audit-history writes remain part of the transaction. No attendance record deletion or history rewrite is part of this implementation.
8. **UI state:** Load/save requests are single-flight. A recoverable request error preserves selected scope and displayed marks; changing mode or scope with unsaved marks requires confirmation. Save is enabled only for a loaded register and is accepted only after the server confirms each row.

## Regression suite and CI

Run locally:

```sh
node --test test/attendance-*.test.js test/staff-attendance-*.test.js test/student-attendance-*.test.js test/part1-mobile-attendance-result-slip.test.js
npm run protection:verify
npm run migration:validate
```

The suite covers safe single-parse response handling, HTML/blank/malformed JSON, status and network/timeout errors, API authentication, an empty authoritative roster, normal and sample register loads/saves, sample-store isolation, academic date validation, duplicate/stale corrections, transaction rollback, and responsive breakpoint contracts. The existing `Verify protected components` workflow now runs these tests and migration validation on pull requests and pushes to `main`; attendance invariants are also represented in `config/protected-components.json`.

Real Chromium viewport validation was performed with synthetic long-name rows at widths **320, 360, 375, 390, 414, 768, 1024, and 1440 px**. The measured document/body widths matched the viewport at all eight widths; controls fit, mobile/tablet cards were visible through 1023 px, and the desktop table was visible from 1024 px.

## Migration and recovery procedure

No schema migration was added for this fix. It uses the existing period/enrollment relationships, the established attendance identity index, audit history, and the existing sample-fixture table. Before any future schema migration:

1. Review the numbered SQL migration and migration-ledger/status output; do not edit an already-applied migration to alter production state.
2. Run `npm run migration:validate` and exercise the migration against a representative non-production database.
3. Take a provider/database-native recoverable backup or snapshot and confirm that the recovery owner can restore it. This repository task did **not** create or verify a production backup.
4. Prefer forward-only, additive, reversible changes. Never truncate, replace, or rewrite saved attendance to make a migration pass.
5. Record scoped pre-change attendance row counts and duplicate/integrity checks; compare the same scopes after migration, then verify historical periods and audit rows remain readable.
6. If checks fail, stop writes/deployment, preserve diagnostics, and use the verified database restore procedure; do not improvise a destructive rollback.

## Release checklist

- [ ] Protected-component verification passes.
- [ ] Attendance regression suite passes, including normal and sample mode.
- [ ] `npm run migration:validate` passes; no unreviewed destructive migration is present.
- [ ] Review changes to attendance endpoints, permissions, schema, and sample fixture boundaries.
- [ ] Confirm main-branch CI and the production deployment reference the same merged commit.
- [ ] Smoke-check options/register responses as JSON, a legitimate empty roster, and an authorized sample-only load.
- [ ] Verify an official row and its audit history remain intact; do not include real identifiers in reports/logs.
- [ ] Confirm stable production alias serves the merged deployment before calling the release complete.

At implementation time, `main` requires the `Verify protected login assets` check, but has zero required approving reviews and does not require CODEOWNERS review. The new `Verify attendance integrity and protected components` workflow check succeeds on PRs and pushes to `main`; adding it as a required branch check was attempted but GitHub returned HTTP 404 because this session has read-only administration permission. Therefore, the test workflow is present and runs, but is **not yet a branch-rule merge/deploy gate**. A repository administrator must add that exact status context alongside the existing login-assets check before claiming attendance failures block deployment. No branch-protection setting was changed by this task.
