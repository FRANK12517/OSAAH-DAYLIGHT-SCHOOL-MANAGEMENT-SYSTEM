# Result Slip repair — Part 2 completion report

## A. Student data source and inspection

The selector now reads the canonical durable `students` and `student_enrollments` records through `createDurableAcademicService().resultStudents()` in `src/durable-academic.js`.

- Student identity: `students.id` is the internal identifier; `students.permanent_student_id` is the actual established Permanent Student ID.
- Name: `students.first_name`, `middle_name`, and `last_name`.
- Membership: `student_enrollments.student_id -> students.id`, with `class_id` and `academic_year_id`.
- Class ownership: reuse Part 1's `optionClasses(actor)` against existing canonical `classes` rows, including its legacy compatibility and teacher assignment filtering.
- Academic year/term: reuse `resolvePeriod()` against school-scoped `academic_years` and their `terms`. The existing name-valued form inputs and canonical year/term IDs are accepted by this resolver.

Inspected existing implementations:

| Implementation | Finding |
|---|---|
| `src/students.js` | `createStudentService()` stores students in a process-local Map. Its `getStudent(id)` uses the internal ID. It is not used by the new lookup. |
| `src/class-database.js`, existing `/api/class-database` | Reads the injected student service and its history. Current server wiring uses the in-memory student service, so this endpoint is not a suitable durable selector source. |
| `src/durable-academic.js` | Durable score-entry roster requires a subject and references enrollment fields absent from the recorded production layout; it is not reused for this selector. |
| `src/admission-enrollment.js` | Existing admission finalization writes the durable student master and an enrollment with the four production membership fields. Allocation belongs to admissions and is never called by the lookup. |
| `schema/003_students_admissions.sql`, `schema/028_admission_student_master_fk.sql`, admission service/tests | Existing admission application/master linkage reviewed. No admission payload is queried or exposed by this repair. |
| `src/platform/repositories.js` | Generic repositories do not supply a ready school/class/year membership lookup. |
| `src/academic-results.js`, `src/sample-result-workflow.js` | Existing handlers receive `studentId`; normal result lookup resolves internal ID, while sample resolution accepts internal or Permanent Student ID. These interfaces are retained. |
| `src/permanent-student-id.js` | Established pattern remains `OSAAH/{YEAR}/{SEQUENCE}`. No allocator, sequence, historical ID, or validation format was modified. |

Request trace:

`Result Slip -> academic year + term + canonical class ID -> GET /api/academic/result-students -> session authentication -> existing academic-options permissions -> authenticated/configured school check -> canonical class/assignment check -> school-scoped year and term resolution -> durable enrollment/student join -> minimal DTO -> single Student select`.

## B. Implementation

Added `GET /api/academic/result-students?classId=...&academicYear=...&term=...` using the existing durable academic service. There is no fallback to in-memory students. Without a durable database, the endpoint returns a safe 503.

The new membership query:

```sql
SELECT e.*, s.id AS canonicalStudentId,
       s.permanent_student_id AS permanentStudentId,
       s.first_name AS firstName, s.middle_name AS middleName,
       s.last_name AS lastName, s.is_test_record AS isTestRecord
FROM student_enrollments e
JOIN students s ON s.id=e.student_id
JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=?
ORDER BY s.last_name,s.first_name,s.id
```

The authenticated school supplies the school parameter. Class ownership and teacher assignment are checked before the membership query. Historical enrollment determines membership; `current_class_id`, student names, and present-year flags do not override it. Duplicate enrollment matches return one selector entry per canonical student, without changing database records.

DTO fields: `id`, `permanentStudentId`, `name`, `classId`, `academicYearId`, `isTestRecord`. The test marker preserves the existing sample interface. No parent, financial, authentication, or admission payload is returned.

The visible label is `Student Name — Permanent Student ID`. The existing `studentId` field submits `students.id`, as required by the current internal handler contract. A separate hidden `permanentStudentId` field carries the actual stored value unchanged. The two identities are not substituted for each other. Missing Permanent Student IDs remain missing and are labelled as not recorded; no ID is invented.

Frontend behavior:

- Choosing a class triggers a fresh durable lookup. Any embedded legacy students from academic options are ignored.
- Year, term, or class changes immediately clear Student selection/options, hidden identity, rendered result/GES fields, sample-mode selection, and previous messages; generation is disabled until an explicit new student selection.
- Year input edits clear context before blur as well as on change.
- An AbortController and monotonically increasing request version prevent late success or failure from replacing newer options.
- A context version also prevents pending generate/save/publish responses from restoring a cleared old result. These are regression guards only; their business behavior and request interfaces were not rebuilt.
- Loading: `Loading students...`
- Empty: `No students found for the selected class.`
- Error: `Unable to load students. Please try again.`
- A 15-second timeout ends loading; a dedicated retry button retries the current context.
- Saved historical assessments in browser storage are not erased. The old rendered assessment controls are cleared so they cannot remain attached to a new selection.

Files changed in Part 2:

1. `src/durable-academic.js` — durable membership lookup and DTO.
2. `src/server.mjs` — authenticated lookup route and safe error handling.
3. `public/result-view.js` — dependent durable lookup, identity binding, resets, cancellation/version checks and retry.
4. `public/results.html` — hidden Permanent Student ID and student retry control; existing required single selector retained.
5. `test/result-slip-students.test.js` — 24 new focused regressions.
6. `test/result-slip-options.test.js` — preserve all 13 Part 1 cases; update browser fixtures to supply students through the separate endpoint and explicitly select a student.
7. `docs/RESULT_SLIP_PART_2_REPORT.md` — this report.

## C. Schema compatibility

Recorded production evidence was read before implementing SQL: [successful read-only schema inventory run 36139568009](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36139568009), September 25, 2026 at 13:13 UTC.

| Table | Recorded columns relevant to the implementation |
|---|---|
| `students` | `id`, `school_id`, `permanent_student_id`, `first_name`, `middle_name`, `last_name`, `is_test_record`; also contains `current_class_id`, which is deliberately not used for historical membership. |
| `student_enrollments` | Exactly `id`, `student_id`, `class_id`, `academic_year_id`. No production term, school, current-status or enrollment-status column is assumed. |
| `classes` | `id`, `school_id`, `name`, `level`, `department_id`, `created_at`. |
| `academic_years` | `id`, `school_id`, `name`, `starts_on`, `ends_on`, `is_current`, `created_at`. |
| `terms` | `id`, `school_id`, `academic_year_id`, `name`, `term_number`, `starts_on`, `ends_on`, `is_current`, `created_at`. |
| `admission_applications` | Table presence confirmed in the recorded inventory; column-level evidence was not included by that inventory. Existing application/schema contracts were inspected, and no new SQL depends on admission columns. |

Production membership is year-based. Term is validated as belonging to the chosen year; changing between valid terms does not remove year-wide members.

The repository's legacy `schema/031_controlled_schema_upgrade.sql` includes optional `student_enrollments.term_id`. Reading `e.*` allows the service to honor that actual field when present without referencing a nonexistent column in production SQL. A non-null term must match the resolved term ID; null/absent term remains year-wide. If an extended enrollment has `school_id`, a conflicting value is rejected as well. The existing Part 1 class schema fallback is reused unchanged.

**No migration was required or performed. No production rows or ID sequences were changed.**

## D. Security

- Existing session/bearer authentication returns 401 before lookup for an unauthenticated request.
- Route and service both enforce the same permission alternatives as academic options: `academics.read`, `results.read`, or `examinations.read` (plus existing wildcard/proprietor semantics). No role permission definitions were changed.
- Tests exercise Proprietor, Headteacher, Assistant Headteacher, and Teacher access, unauthorized 403, foreign-school actor 403, foreign-class 403, and school spoofing in query parameters.
- School context comes from the authenticated actor and must match the service school. Client `schoolId` and `studentId` parameters cannot change the roster scope.
- Ownership is checked for the class, year, and students. Invalid cross-school enrollment links cannot bring foreign students or years into the response.
- Teachers with configured `assignedClassIds` can retrieve only those classes. Part 1's existing behavior for an absent/empty assignment list is preserved; this repair does not redefine assignment policy.
- Queries are parameterized and read-only. Unexpected database failures return a generic error without raw SQL or private details.

## E. Tests and limits

Final exact focused command:

```text
node --test test/result-slip-students.test.js test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js test/admission-enrollment.test.js test/class-database.test.js test/class-database-part2.test.js test/class-database-financial-identity.test.js test/permanent-student-id.test.js test/student-identity.test.js
```

**78 tests: 78 passed, 0 failed, 0 skipped**, on Node 25.6.1. This includes 24 new Part 2 tests, the full Part 1 focused coverage, and relevant admissions/student identity/Class Database checks.

Additional completed commands:

```text
node --test test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js
```

Before Part 2 edits: 32 passed, 0 failed, 0 skipped. Part 1 was then committed separately.

```text
node --test test/result-slip-students.test.js test/result-slip-options.test.js
```

During development: 35 passed, 0 failed, 0 skipped, before two additional stale save/publish regressions were added and included in the final 78-test run.

`git diff --check` passed.

SQL tests use temporary in-memory SQLite with recorded production column layouts and the known legacy term/class layout. HTTP tests use the real application handler with fixture authentication. Frontend tests execute the existing script using DOM/fetch doubles and deliberately reordered deferred responses. SQL cases require Node 22+ `node:sqlite` and are marked to skip on Node 20; none skipped in this run. This is local regression evidence, **not production verification**. No authenticated live Result Slip or live student roster was accessed.

## F. Git

- Continued in the existing `.worktrees/result-slip-options-part1` checkout.
- Branch: `fix/result-slip-options-part1`.
- Preserved Part 1 as its own local commit: `5f5e661` (`fix(results): repair academic options and canonical class selection`), after its 32 tests passed.
- Part 2 is committed separately after the final tests; its commit identifier is supplied in the completion message and available through `git log -1` in this checkout.
- **NOT MERGED**.
- **NOT DEPLOYED**.
- No push or production migration was performed.

## G. Remaining for Part 3 — Sample Result/Test Mode only

The existing sample workflow uses its own in-memory test roster and legacy class values. The selected durable canonical class/student IDs must be resolved safely into that existing workflow, with explicit school and test-record checks. Confirm how an existing marked sample student is selected when the chosen durable class contains real students; preserve actual Permanent Student IDs and the existing sample identifier rules. Add focused tests that sample generation receives the newly selected context, never uses a stale student, and does not modify real production student records. This connection was not implemented in Part 2.
