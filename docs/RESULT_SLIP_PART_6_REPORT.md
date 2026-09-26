# Result Slip Repair — Part 6 Investigation Report

## Outcome

**BLOCKED before production integration.** The current Result Slip has two verified gaps: the durable result returns `attendance: null`, and it resolves signatures through a process-local Map. The repository does not contain the exact production metadata output needed to safely query either production `student_attendance` or `result_signatures`; the local environment also has no `DATABASE_URL`. Only one attendance schema difference is recorded from the previous protected inventory (`date` in production versus `attendance_date` in the repository). No runtime query, migration, or speculative schema assumption is safe from that evidence.

No application code, database schema, migration, score/GES architecture, or production data was changed in Part 6. Migration 055 and 056 remain prepared and unapplied. Migration 057 was not created: whether the production signature table already has the required identity/owner fields is not established by the available inventory evidence.

## A. Attendance architecture before Part 6

The Attendance API in `src/server.mjs` reads student attendance from `attendanceRepository.listStudentRecords` when a database adapter exists, otherwise from the in-memory attendance service. The database repository in `src/attendance-repository.js` expects `attendance_date`, academic year, term, class, student, subject key, status, method, and provenance fields. Attendance is also written and audited by that module; Result Slip currently does not invoke it.

The durable real-result loader is `createDurableAcademicService` in `src/durable-academic.js`. Its `result()` method returns `attendance: null`. The existing browser and PDF renderers preserve Times Present, Times Absent, and Total School Days, and display “Not recorded” when values are absent.

## B. Verified attendance contract

The protected production metadata inventory run `36208849852` is documented in the Part 4 report. That report establishes that production `student_attendance` has a `date` column rather than the repository’s `attendance_date`, and lacks `method`, `arrival_time`, and `departure_time`. It does not reproduce the exact column definitions, keys, indexes, or foreign keys needed here. The inventory query file asks for metadata on `student_attendance` and `attendance_sessions`, but no result payload is checked into this worktree.

The local schema files are not proof of the live production contract. The local historical table uses `attendance_date`; later local migrations introduce school/year/term/subject scope and provenance. This differs materially from the production fact above. `attendance_sessions` has no active attendance aggregation consumer in the inspected runtime, and no verified school-calendar/session rule is recorded.

## C. Attendance aggregation rules

`src/result-slip.js:termAttendance` counts raw matching rows: `PRESENT`, `LATE`, and `EXCUSED` as present, and `ABSENT` as absent, then defines school days as present plus absent. That helper is not suitable evidence for production aggregation: the active system also supports other attendance statuses, attendance rows may be subject-specific, and the production row identity/`subject_key` values have not been verified. No replacement aggregation was implemented. Missing attendance therefore remains “Not recorded”; unknown days were not converted to absences.

## D. Historical attendance isolation

The real result has canonical school, student, class, year, and term identifiers available after resolving its score context. However, the production attendance columns and key relationships needed to join those identifiers are not available in the checked-in inventory result. No current class, latest enrollment, or alternate period was used, and no historical attendance claim is made.

## E. Signature architecture before Part 6

The signature-management endpoints in `src/server.mjs` call `createSignatureService` in `src/signatures.js`. That service validates roles, secure storage references, file MIME/size, name, and Ghana phone number, but stores records in a process-local `Map`. It resolves class teachers through in-memory staff assignments and signatures and resolves a headteacher through the in-memory staff collection. The durable Result Slip currently invokes that resolver and includes only signatures with an ID.

## F. Verified `result_signatures` contract

The local migration `schema/017_academic_results_migration.sql` defines `result_signatures` with `id`, `school_id`, `signatory_role`, `storage_key`, `mime_type`, `document_size`, `active`, `uploaded_by`, `uploaded_at`, and `updated_at`; it has no persisted name, phone, staff owner, class, year, or term. Local `staff_profiles`/`staff_assignments` define staff name/phone/role and class/year/term assignment relationships.

Production presence of `result_signatures` and `staff_assignments` was included in the prior metadata query, but the Part 4 report does not record their exact columns, constraints, or indexes. Consequently the live signature contract, including whether a compatibility migration is required, is **not verified**. The available evidence does not justify migration 057 SQL.

## G. Class teacher resolution

The existing Map resolver finds an assigned in-memory teacher using class plus optional academic year and term. The durable result passes display labels (`period.yearName`, `period.termName`) rather than canonical year/term IDs and does not establish that this teacher assignment is the production assignment for the selected historical result. Part 6 did not connect this resolver to SQL or claim historical ownership correctness.

## H. Headteacher resolution

The current in-memory resolver chooses the first active Headteacher, then first Proprietor, then the actor fallback. This is not proof of the school’s authorized production Headteacher identity. Durable staff role/ownership columns and the school’s authorized-headteacher selection contract were not captured by the available production inventory output. No production query or fallback was added.

## I. Name, phone, and signature

The signature UI already requires full name, phone, and a secure signature reference. The local Map service validates these values, while the local `result_signatures` table definition cannot persist name, phone, or owner/context. Production parity is unverified. No Map-to-database write or read path was changed.

## J. Result Slip integration

The canonical durable result remains unchanged. It still returns attendance as null and signatures from the configured in-memory resolver; no parallel DTO was introduced.

## K. PDF parity

The existing PDF renderer accepts the same result DTO and renders attendance and signature sections. Since the DTO was not extended, browser/PDF continue to share their existing “Not recorded” attendance behavior and current signature payload. No parity change is claimed.

## L. Sample Mode isolation

No sample workflow or sample storage was changed. The real durable result continues to reject sample requests before it reads canonical result data.

## M–O. Score, GES, and Lower Primary regression

No Part 4C canonical score source, Part 5 canonical GES source, grading calculation, or Lower Primary mapping was changed.

## P. Migrations and production changes

- `055_canonical_academic_scores.sql`: PREPARED, NOT APPLIED.
- `056_canonical_ges_assessments.sql`: PREPARED, NOT APPLIED.
- Migration 057: NOT CREATED; production contract evidence is insufficient to determine whether required or safely define additive SQL.
- Production data mutations: NONE.
- Production migration applications: NONE.

## Q. Tests

No Part 6 integration tests were added because there is no verified production query contract to exercise. The available test baseline at the start of this Part was 882 passed, 0 failed, 0 skipped (Part 5 report). Final full-suite results are recorded in the completion response after running the suite against this report-only change.

## R. Git and remaining work

No Part 6 implementation commit exists. The working branch remains `fix/result-slip-options-part1`; this report is the only Part 6 file. It remains unmerged and undeployed. To resume safely, capture and retain the actual metadata-only production inventory result for the attendance, signature, staff, assignment, and session tables; then verify active production writers and identity semantics before implementing scoped queries or deciding on migration 057.

## Part 6A — Production contract discovery

**Status: BLOCKED pending protected workflow dispatch.** The existing protected workflow is `.github/workflows/production-schema-inventory.yml`; it runs `scripts/production-schema-inventory.mjs` with the protected `DATABASE_URL` secret and does not echo the connection string. The local GitHub CLI token remains invalid. Publication is being performed through the authenticated GitHub connector, which exposes Git operations but no workflow-dispatch action. No new workflow run was dispatched, no production connection was attempted, and no new database metadata was returned. The requested exact result must not be inferred from the previous report’s abbreviated summary.

The metadata inventory tooling captures full columns, primary/unique constraint columns, indexes, FK targets and referential rules for the required tables and their directly FK-related tables. It fails closed before collection if the connected database is not `osaahdaylightschool`. Two focused tests validate metadata-only behavior and the mismatch guard. The metadata-only update is being published to the existing branch through the authenticated GitHub connector because normal `git push` cannot connect to `github.com:443`. The available connector has no workflow-dispatch action, so no production contract decision can be drawn until the protected workflow runs and its sanitized output is captured.

- Protected workflow run ID: **NONE — DISPATCH ACTION NOT AVAILABLE IN THE CONNECTOR**.
- Database identity verification: **NOT RUN** (expected name is `osaahdaylightschool`).
- Attendance columns, keys, indexes, foreign keys and date resolution: **NOT VERIFIED** beyond the previous report’s `date` versus `attendance_date` summary.
- Daily versus subject attendance and total school days: **NOT VERIFIED**.
- Production `result_signatures` columns, keys, indexes, foreign keys and storage: **NOT VERIFIED**.
- Staff/user identity bridge and class/headteacher assignment paths: **NOT VERIFIED**.
- Historical assignment safety: **BLOCKED**.
- Migration 057: **UNDETERMINED**.
- Production application data read: **NONE**; no query was dispatched.
- Production data mutations: **NONE**.
- Git transport limitation: `git push` cannot connect to `github.com:443`; the authenticated GitHub connector is being used to publish the metadata-only update. No workflow dispatch action is available through that connector.
