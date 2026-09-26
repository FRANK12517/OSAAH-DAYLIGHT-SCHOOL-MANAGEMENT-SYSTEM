# Result Slip Repair — Part 6 Report

## Part 6A — production metadata

**COMPLETE.** Protected metadata inventory run **36276551209**, job **108500306509**, checked release `25181033f7b442804143a0d29e6af87c44ea691a` against `osaahdaylightschool`; database identity matched and there were no production mutations.

## Part 6B — durable historical attendance and signatures

The real `durableAcademic.result()` path now loads attendance from production `student_attendance` using its verified `date` column and exact school, master student/profile bridge, class, academic-year name, term name, and term ID. The student bridge uses `student_profiles.student_master_id -> students.id` and matches the profile's permanent identifier. The previous process-local signature resolver is no longer used for real results.

Daily attendance collapses duplicate subject rows by distinct date. A `subject_key='daily'` row is canonical and takes precedence. If there is no canonical daily row, the day is counted only when all subject statuses agree; conflicts are surfaced separately. Only recognized present/absent statuses contribute to those totals; early departure and unsupported statuses are reported separately. Missing attendance yields “Not recorded” counts, never an inferred absence.

`totalSchoolDays` remains **Not recorded** (`null`): verified `attendance_sessions` records do not prove an official academic-period calendar, and no date range is used to invent a total.

Class teachers resolve through unique active `staff_assignments` for the selected class, year, and term, then `staff_profiles -> users`, with an active TEACHER role. Their durable signature must be active and match school, staff, class, and academic year. Ambiguous assignment/signature matches do not select an arbitrary record.

The verified schema has no historical headteacher assignment. The explicit policy is **current active official Headteacher by product design**, school scoped and resolved through active user-role relationships. Only a unique active headteacher is shown; no proprietor/actor fallback is used. Durable `signature_url` is shared by the screen and PDF DTO. The browser only renders safe same-origin `signatures/` references; the PDF embeds local PNG/JPEG assets within the public signatures directory and safely omits unavailable/non-local assets.

Sample Mode continues to use its isolated synthetic workflow and does not query real attendance, staff assignments, or persisted signatures. Migrations 055 and 056 remain prepared/unapplied; migration 057 was not created because the verified schema supports the required reads. No production writes, migrations, merges, or deployment occurred.

## Verification

Part 6B adds coverage for production date/query scope, the student-profile identity bridge, daily subject-row collapse, conflicts, unknown statuses, missing attendance, historical staff assignment, durable identity/signature resolution, inactive/wrong-school signature exclusion, ambiguity handling, current-headteacher policy, PDF/browser resolver parity, Sample Mode isolation, and no real-result Map fallback.

- Focused Part 6 / PDF / Sample Mode tests: **43 passed, 0 failed**.
- Full `npm test`: **893 passed, 0 failed**.
- `npm run migration:validate`: **passed**, 55 migrations valid.
- JavaScript syntax checks and `git diff --check`: **passed**.
- Migrations 055/056: prepared, not applied. Migration 057: not required, not created.
- Production changes, deployment, and merge: none.
- Commit: local Part 6B commit on `fix/result-slip-options-part1`.
- Push: failed; normal Git could not connect to `github.com:443` (`Failed to connect to server`). No alternate or forced push was attempted.

## Part 6C — durable signature management writer

### Before repair

`GET /api/result-signatures` listed an in-memory Map, `POST /api/result-signatures` validated a metadata-only secure reference and added the record to that Map, and `DELETE /api/result-signatures/:id` deactivated only the Map item. There was no separate PATCH/update route. Replacing a profile was another POST. The app initialized `createSignatureService` without its database adapter, so signature changes disappeared on process restart and could not be read by the Part 6B database-backed Result Slip.

The existing form does not transfer signature bytes. It accepts a caller-supplied `signatures/...` reference plus MIME and declared size. No binary file upload or durable asset-storage provider/path is implemented in this repository. Part 6C preserves that existing reference mechanism: validates safe path syntax, allowed MIME, matching extension, and declared size; then writes the reference to `signature_url`. It does not store image bytes or treat client input as a filesystem path. The referenced image must already exist in the deployment's secure signature asset store for the browser/PDF renderer to display it.

### After repair

Database-backed signature management now lists and writes the verified `result_signatures` table. Uploads persist the canonical type (`CLASS_TEACHER` or `HEADTEACHER`), staff profile ID, tenant, applicable class/year, signature URL, active state, uploader, and timestamps. Names and phones come from `staff_profiles -> users`, not from client values or duplicate signature columns.

Class teacher uploads require a school-owned class, matching academic year and term, active TEACHER user-role, and the class-wide historical assignment consumed by Part 6B. Since the production signature table has no term column, the persisted/replacement signature scope is class plus academic-year and staff identity; the submitted term is validated against the assignment. Headteacher uploads resolve only the unique current active official Headteacher in the school, matching Part 6B's current-by-design policy.

POST replacement keeps the prior record and marks it inactive with `deactivated_by` and `deactivated_at`, then inserts the new active row inside a database transaction. TiDB transactions lock the stable school row to serialize concurrent signature writes. Repeating an active upload with the same secure reference is idempotent; if legacy active duplicates exist in that scope, retries deactivate extras. DELETE deactivates a record in the actor's school; it never physically deletes history. Existing `signatures.manage` route authorization remains required. The authenticated server school is used throughout; client `school_id`, name, and phone are ignored.

When a database adapter is configured, management GET/POST/DELETE and the Part 6B real Result Slip/PDF use durable rows. The process-local signature Map is restricted to the non-database deterministic/sample service path; database-backed sample resolution does not read it or the production table. Tests upload both roles, recreate the app service, regenerate the real result and PDF, replace/deactivate records, and assert the table-backed signature is returned after restart.

### Part 6C verification and release state

Focused verification passed: 18 tests covering durable signature management, signature profiles, Result Slip/PDF resolution, and the TiDB adapter contract. The complete `npm test` suite passed: 897 tests, 0 failures. `npm run migration:validate` passed with 55 migrations validated; this only validates and does not apply migrations. Syntax checks and `git diff --check` passed. Part 6C was committed locally on `fix/result-slip-options-part1` (`fix(results): persist signature management durably`). One normal `git push origin fix/result-slip-options-part1` was attempted and failed: `fatal: unable to access 'https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM.git/': Failed to connect to github.com port 443 after 101 ms: Could not connect to server`. No retry or alternate authentication path was used; nothing was merged or deployed.
