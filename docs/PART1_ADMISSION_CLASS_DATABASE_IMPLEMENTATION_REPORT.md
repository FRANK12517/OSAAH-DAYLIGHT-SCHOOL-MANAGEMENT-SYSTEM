# Part 1 — Admission, Gender, Permanent Student ID, and Class Database

## 1. Architecture discovered

The repository uses `src/admission-form.js` as the admission-form application service, `src/admission-enrollment.js` as the durable transactional materialization service, `src/students.js` as the in-memory canonical student identity service, and `src/class-database.js` as the read-only class database projection. Permanent Student IDs are allocated through `src/permanent-student-id.js`. Gender values are normalized and validated by `src/student-gender.js`. The HTTP integration is registered in `src/server.mjs`.

The relational path reuses the existing `students`, `student_profiles`, `student_enrollments`, `parent_student_links`, `admission_applications`, `student_id_sequences`, and `audit_logs` tables. No duplicate student identity or independent class-database table was added.

## 2. Admission flow discovered

The existing flow is:

> Admission application → submission → staff review → acceptance → transactional student materialization → permanent Student ID allocation → class enrollment → parent/profile linkage → Class Database read projection.

The acceptance route in `src/server.mjs` invokes the durable enrollment service when a database adapter is configured. Its existing in-memory fallback uses the canonical student service. Both paths are idempotent: an accepted application with an existing student linkage is not materialized a second time.

## 3. Gender implementation

The admission form already contained a required Male/Female selector. The existing canonical normalization contract was retained, including equivalent `M`/`F` values and explicit rejection of missing gender during enrollment. Gender is persisted on the canonical student and student profile records. Class Database reads `student.gender` and displays `Not Recorded` for historical records with no gender; it does not invent values.

## 4. Tables and services reused

The implementation reuses the existing canonical tables and services listed above. Class Database membership continues to derive from the current canonical student class/enrollment state. Parent name and phone continue to resolve from canonical parent links and family/contact data.

## 5. Migrations

No migration was added. Existing migrations already provide the permanent-ID sequence, admission-to-student linkage, student enrollment table, and canonical schema upgrade required by this Part 1 behavior.

## 6. Files modified

| File | Change |
| --- | --- |
| `src/student-classes.js` | Added shared class alias resolution without creating duplicate class IDs. |
| `src/admission-enrollment.js` | Normalized known admission class aliases during durable enrollment and merged application-level fallback fields with applicant data. |
| `src/admission-form.js` | Added canonical class options and retained legacy labels for compatibility; expanded fee-division recognition to canonical and legacy class labels. |
| `src/server.mjs` | Canonicalized fallback enrollment class IDs and preserved academic-year/term enrollment history. |
| `public/admission-application.html` | Updated the user-facing class selector to canonical Nursery, KG, Primary, and JHS labels. |
| `test/admission-class-database-part1.test.js` | Added regression coverage for class aliases, gender, Permanent Student ID, parent data, and automatic Class Database visibility. |

## 7. APIs modified

No new public API was introduced. The existing admission review endpoint and Class Database endpoints were hardened to use the shared canonical class resolver and existing canonical student projection.

## 8. Admission transaction behavior

Durable acceptance remains transactional. Student master, profile, enrollment, parent link, admission linkage, and audit record are created within the existing transaction. A midway failure rolls back all materialized records. Retrying an accepted application returns the existing student and does not allocate another Permanent Student ID or create a duplicate enrollment.

## 9. Tests executed

The focused Part 1 suite passed with 24 tests. The full deterministic repository suite, excluding `test/live-ai-provider.test.js` because it is an external live-provider test that stalled the original unfiltered run, passed with **687 tests passed and 0 failed**.

The initial unfiltered `npm test` run was stopped after it remained silent for more than ten minutes. Before stopping, it had already shown the Part 1 tests passing; the only failures observed were compatibility failures caused by temporarily removing legacy `Basic`/`Crèche` labels, which were restored while retaining the new canonical labels.

## 10. Results

Part 1 is implemented. Accepted admissions preserve canonical gender, use the existing Permanent Student ID, create the canonical class enrollment, preserve parent linkage, and become visible automatically in the selected Class Database. Class aliases resolve to existing canonical class identities, so no duplicate class IDs or manual synchronization step is required.

## 11. Unresolved issues

The external live-provider test was not used as a release gate because it did not terminate in the sandbox. No Part 1 functional tests remain unresolved. Production deployment still depends on the repository’s existing Vercel configuration and its documented production persistence gates; no database migration was run.
