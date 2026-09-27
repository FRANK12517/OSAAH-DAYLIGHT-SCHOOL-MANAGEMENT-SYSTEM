# Result Slip Repair — Part 5: Durable GES Assessment

## A. Previous GES architecture

The End-of-Term Result Slip already had the five GES selectors and Positive/Negative libraries. Before Part 5, changing a selector wrote values to browser `localStorage`, keyed by school, student, year, term, class, and examination. The legacy `academic-results.js` Save Result service separately stored assessment values in the process-local `savedResults` Map. The Part 4C durable real-result repository returned `assessment: null`, so its Generate Result and PDF paths did not read either store. Neither browser storage nor the Map survives a new process as the authoritative production source.

The established browser and server comment libraries are `public/ges-assessment-libraries.js` and `src/ges-assessment-libraries.js`, respectively; their shared source is `test/fixtures/edutrack-ges-assessment-libraries.json`.

## B. Root cause

No verified durable source stored all five GES values under the exact school, canonical student, class, academic-year, and term scope used by Part 4C. Part 4C had intentionally left real GES retrieval disconnected because production metadata did not prove a safe existing source. The Result Slip was displaying local-only selections for real records, while the durable score-backed result returned no assessment.

## C. Verified production schema

Protected metadata-only production inventory run `36208849852` established that `report_cards` stores school, profile student, class, string academic year/term, attendance, and general remarks, but lacks the Attitude and Interest fields and does not use the same canonical master-student/year-ID/term-ID scope. `student_assessments` stores CA, exam, total, grade, and general remarks; it has no class or academic-year columns, no unique result-context key, and no verified GES writer. The other inspected assessment and examination tables represent marks/score concepts with different scope or identity. None is a safe five-field canonical GES store, so Part 5 does not reuse them. No assessment rows or other student data were read to reach this decision.

## D. Durable GES contract

Migration `056_canonical_ges_assessments.sql` adds one `canonical_ges_assessments` table. Its relational keys reference `schools.id`, canonical `students.id`, `classes.id`, `academic_years.id`, and `terms.id`. A unique constraint covers school, student, class, year, and term. It is additive, repeat-safe, and non-destructive; there is no legacy backfill. The table is the single durable source for the browser Result Slip, Generate Result response, and PDF input.

## E. Five GES fields

The table persists `conduct`, `attitude`, `interest`, `class_teacher_remarks`, and `headteacher_remarks`. Service/API names remain `conduct`, `attitude`, `interest`, `classTeacherRemarks`, and `headteacherRemarks`. These values are independent of academic score columns.

## F. Positive/Negative library status

The existing approved libraries are unchanged. Each of the five categories retains 30 Positive and 30 Negative comments. The server validates each non-empty selection against the matching approved library. Positive/Negative remain no-print selection controls; they are not printed as assessment values. A previously selected negative comment is reloaded in the negative picker.

## G. Save/update workflow

`POST /api/academic/ges-assessment` accepts the selected student, class, year, term, and assessment fields; it never accepts a trusted school scope from the client. The service derives school from the authenticated actor, resolves the year and term within that school, checks that the canonical student has the selected historical class/year enrollment, rejects sample identities, and validates every selected comment. Repeated saves update the unique context row. The real Result Slip Save control now invokes this endpoint and does not require attendance values, keeping the separate attendance repair out of Part 5. A new repository instance can reload the saved row from the database.

## H. Result Slip integration

The Part 4C durable result reader now loads the GES row using the same student, school, class, year, and term. The existing full browser renderer receives that assessment object. Real durable results ignore browser `localStorage`; missing rows return five null values and render as “Not recorded”. Existing context invalidation and response-version guards continue clearing previous student results and rejecting stale responses.

## I. PDF integration

The existing `/api/academic/result/pdf` route regenerates the result through the same durable repository and passes that result directly to the existing PDF renderer. Tests compare the PDF service input with the browser Result Slip API’s five saved values; no separate PDF assessment store or renderer was added.

## J. School isolation

Repository reads and writes use the authenticated service school ID. Student, year, term, and class are validated against that school, and request-supplied school IDs cannot redirect the operation. Tests cover a foreign-school actor, a foreign-school student, and a spoofed body school ID.

## K. RBAC

The Part 5 save route retains existing write permissions: `marks.write` or `results.write`. Teachers retain their existing class-assignment restriction. The current role map grants the teacher `marks.write`; Proprietor retains wildcard access; Headteacher and Assistant Headteacher retain result read/generate access but do not have these write permissions, so their save attempts remain 403. No role permission was added or broadened. The prior save flow had no separate Headteacher-only remarks authorization contract; all five fields follow the existing Save Result writer authorization.

## L. Sample Mode isolation

The real write endpoint and repository reject preview/sample flags, TEST provenance, and reserved `TEST-OSAAH-` identities. Sample previews continue using the existing request-local sample workflow and its isolated assessment values. Tests confirm sample saves create no canonical GES row.

## M. Historical year/term/class isolation

The unique scope and exact read predicates distinguish First Term from Second Term, 2025/2026 from 2026/2027, and Basic 4 from Basic 5 for the same canonical student. Reads also require the selected historical enrollment. A second student’s assessment is not returned for the first student.

## N. Part 4C score regression status

Migration 055 and the canonical score writer/reader contract remain unchanged. Score Entry, real Result Slip, PDF, and broadsheet still use `canonical_academic_scores`. The focused Part 4C HTTP/repository tests pass with both prepared migrations installed in their production-compatible fixtures.

## O. Lower Primary regression status

Lower Primary grade points remain A=1 through I=9. The existing calculation tests still prove `A,A,A,A,A,A → 6` and `A,B,B,C,C,D → 15`; Part 5 does not change grading or aggregate calculations.

## P. Attendance status

Historical durable attendance remains unverified and out of scope. The Result Slip continues to show “Not recorded” for attendance where the Part 4C repository has no verified value. The GES save path does not fabricate or infer attendance.

## Q. Signature status

**SIGNATURE DURABILITY: NOT YET VERIFIED.** Part 5 leaves the existing signature resolver and its displayed behavior unchanged.

## R. Part 29 release-gate failure status

The previous failure was a Windows path normalization bug in `scripts/part28-release-gate.mjs`: concatenating URL `.pathname` into filesystem paths produced `C:\C:\...`. The script now resolves its root using `fileURLToPath` and `path.join`, and `test/part29-sidebar-release-gate.test.js` passes all four assertions. The release gate and test remain intact; this script fix has its own commit.

## S. Migrations

- Migration 055, `canonical_academic_scores`: **PREPARED / NOT APPLIED**.
- Part 5 migration 056, `canonical_ges_assessments`: **PREPARED / NOT APPLIED**.
- No production or local application database was mutated by migration execution; tests use isolated in-memory SQLite fixtures.
- Migration validation discovers 55 versioned migrations successfully.

## T. Tests

- Focused Part 5 and Parts 1–4C/result/PDF/broadsheet/grading/identity/RBAC/release-gate suite: **160 passed, 0 failed, 0 skipped**.
- Final `npm test`: **882 passed, 0 failed, 0 skipped**.
- `npm run migration:validate`: passed, 55 migrations discovered. JavaScript syntax checks and `git diff --check`: passed.

## U. Git

Parts 1–4C are preserved. Part 5 commits are local only; no merge or deployment occurred. The release-gate fix, durable GES migration/repository, and Result Slip/API integration are committed separately:

- Part 4B report recovery: `ead9637846d89b27e2ecf72f83f33ad7e22592d9`.
- Part 4C canonical score migration/repository: `f714975d0b4a3e0de4dc126a6b523d36ab7efdab`.
- Part 4C durable result/API integration: `6a03566cd2f5face14915419acf5c282ad8da221`.
- Part 5 Windows release-gate path fix: `032cf62a73746d723e86b75ce478ca121927aa03`.
- Part 5 GES migration/repository: `e62cf24d7b6c42d9bdf303e646143d1c8b5b754b`.
- Part 5 Result Slip/API integration: `4213ea90018e1c0a1cf4caf96ce41a7e30f05d23`.
- Part 5 sample and duplicate-write hardening: `1def64804e813d122d631e8f4241092971694ccb`.

The final tests/report commit SHA and clean-tree status are recorded in the completion response.
