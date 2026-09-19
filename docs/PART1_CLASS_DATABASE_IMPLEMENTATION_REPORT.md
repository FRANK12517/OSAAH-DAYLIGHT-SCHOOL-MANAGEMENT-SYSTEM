# Part 1 — Class Database + Automatic Admission Integration

## Architecture discovered

OSAAH already contains the canonical student and admission architecture required by this feature. The in-memory student service maintains the student master record, Permanent Student ID, current class assignment, class history, parent links, admission applications, and school scope. The database admission-enrollment service (`src/admission-enrollment.js`) performs the accepted-admission materialization transaction across `admission_applications`, `students`, `student_profiles`, `student_enrollments`, `parent_student_links`, and `users`, with a row lock, annual Permanent Student ID sequence, idempotent retry behavior, and rollback on failure.

The resulting source-of-truth flow is:

> Admission application → accepted decision → atomic student/profile/enrollment/parent-link materialization → current class assignment → Class Database projection.

No second admission architecture, independent Class Database row, duplicate student master, or new identifier was introduced.

## Tables and services reused

The implementation reuses the existing `students`, `student_profiles`, `student_enrollments`, `parent_student_links`, `users`, `admission_applications`, and `student_id_sequences` database contracts. The Class Database projection reads the canonical student service’s current `classId`, Permanent Student ID, name, and parent-link/family data. In the database-backed admission path, the existing atomic enrollment transaction automatically makes the new student visible because the Class Database does not maintain a separate insertable table.

Parent selection is deterministic: a primary link/contact is preferred, followed by the first canonical active link/contact. Missing phone numbers display `Not Registered`; no phone number is fabricated. Parent phone search accepts both the stored normalized Ghana format and local input format.

## Files created

- `src/class-database.js` — protected, read-only projection service with class filtering, search, current membership, primary-contact selection, school scoping, and role authorization.
- `public/class-database.html` — responsive staff-facing Class Database page.
- `public/class-database.js` — safe client rendering, class selection, academic-year selection, search, and empty state.
- `test/class-database.test.js` — Part 1 acceptance coverage.
- `docs/PART1_CLASS_DATABASE_IMPLEMENTATION_REPORT.md` — this report.

## Files modified

- `src/server.mjs` — registers the Class Database service and exposes protected `/api/class-database/options` and `/api/class-database` routes.
- `src/students.js` — preserves optional canonical parent name and primary-contact metadata on existing parent links without changing the student identity model.
- `src/sidebar-registry.js` — registers the protected Class Database navigation entry under Students Management.

## APIs

- `GET /api/class-database/options` returns the current academic-year option and canonical class IDs/names available to the authorized staff actor.
- `GET /api/class-database?academicYear=...&classId=...&search=...` returns current students in the selected class with Permanent Student ID, student name, parent/guardian name, and registered parent phone.

Both APIs enforce authentication through the existing request pipeline, server-side role/permission checks, school scoping, teacher assigned-class scoping, and parent/student portal exclusion.

## Acceptance tests executed

The focused Part 1 suite passed **16/16** tests, including:

1. Automatic appearance of a newly created canonical student in the assigned class.
2. Permanent Student ID preservation.
3. Parent/guardian name and normalized phone display.
4. Search by Permanent Student ID.
5. Search by student name.
6. Search by parent name.
7. Search by local phone input against normalized stored phone.
8. Automatic movement after canonical class reassignment.
9. Exclusion from the previous class.
10. Empty class state.
11. Missing phone handling.
12. Teacher assigned-class scoping.
13. Unauthorized access rejection.
14. Cross-school isolation.
15. Existing atomic accepted-admission creation and retry idempotency.
16. Existing admission transaction rollback and parent authorization regressions.

The complete repository suite passed **543/543** tests. Protected login asset verification passed for all **12** assets. JavaScript syntax checks and `git diff --check` passed.

## Migrations

No migration was required. The requested module is a projection over existing authoritative records and therefore does not duplicate enrollment or parent data.

## Unresolved issues

The existing in-memory development service represents the current class using the canonical student `classId`; the production database path already persists `student_enrollments` and current class assignment in the existing admission transaction. A future database-native read repository could optimize the projection query, but it is not required for the current architecture and was intentionally not introduced in Part 1.

Per the requirements, implementation stops after Part 1. No Part 2 work was started.
