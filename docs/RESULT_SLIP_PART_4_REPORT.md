# Result Slip repair — Part 4 investigation

Status on 2026-09-26: **Lower Primary aggregate defect fixed under Part 4A. Production schema inspected through the protected read-only workflow. Durable real-result integration remains blocked because the active canonical Score Entry source is not established. Part 4 is not complete.**

The Part 4 instruction to stop before speculative schema changes still applies to durable result retrieval. The Part 4A Lower Primary calculation fix changes runtime calculation only. No SQL writer or migration has been changed. Parts 1–3 remain intact. NOT MERGED. NOT DEPLOYED.

## A. Verified previous architecture

With Test Mode off, `public/result-view.js:loadResult` sends the form's internal durable student ID, stored Permanent Student ID, canonical class ID, year and term to `/api/academic/result`. The request has the Part 2/3 abort, context-version and timeout protection. The real response currently has no explicit frontend identity-match validation beyond the request/context version.

`src/server.mjs` authenticates the request and requires `results.read` or `results.generate`, but the route unconditionally invokes `academicResults.result`. That instance is constructed from the ordinary student/subject/signature services rather than a durable real-result reader. Its configured school is `OSAAH_SCHOOL_ID`, defaulting to `sch_default_01` with a database; the service factory itself still has a legacy default, but server construction supplies the configured school.

In `src/academic-results.js`, `terminal`, `mocks`, `savedResults` and `publications` are Maps. `studentFor` uses the in-memory student service. Class checks and classification use legacy class values. Subject resolution uses the in-memory subject service/register, whose generic default catalogue cannot stand in for production configuration. Missing configured marks become zero-valued placeholder rows. The method computes positions, grades, remarks and aggregates using existing calculation services, then returns the full renderer's flat DTO.

Attendance and GES fields come from the in-memory saved-result record. Gender and class totals come from the in-memory student roster. Signatures come from `src/signatures.js`, which stores signatures in a Map and uses in-memory staff assignments. Real PDF generation calls the same in-memory result method. Part 3 separately routes sample previews through its isolated durable-context adapter.

The current durable Score Entry writer is `src/durable-academic.js:saveScore`. It writes CA/examination/total to `academic_score_records`, refers to `student_profiles` for score identity, validates `subject_class_assignments`, and requires `e.school_id`, `e.enrollment_status` and `e.is_current`. The roster query uses the same assumptions. Repository-wide source searches found no current SQL writer/reader mapping the production `assessment_scores`, `exam_scores` or `examination_marks` tables into this result flow.

## B. Root cause and schema blocker

The real endpoint has never been connected to the durable student/score path repaired in the preceding parts. A second, independent incompatibility prevents safely adopting the current durable Score Entry SQL unchanged.

Evidence: the successful [production inventory run 36139568009](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36139568009), recorded 2026-09-25 13:13 UTC, was read again for this investigation. Listing the latest five inventory runs found no newer successful inventory.

| Contract | Verified production metadata |
| --- | --- |
| `academic_score_records` | Table is absent. The current repository writer in `durable-academic.js` expects it. |
| `subject_class_assignments` | Table is absent. `class_subjects(id,class_id,subject_id,teacher_id)` exists instead; its declared FKs point to classes, subjects and teachers, with no school/year/term columns. |
| `student_enrollments` | Only `id,student_id,class_id,academic_year_id`; declared FKs link to `students.id`, `classes.id`, `academic_years.id`. No school/status/current/term columns. |
| `assessment_scores` | `id,assessment_id,student_id` are non-null `varchar(191)`; `score decimal(5,2)` and `remarks text` nullable. PK `id`; nonunique FK indexes on assessment/student. FKs to `assessments.id` and `students.id`. Parent `assessments` has required class, subject, academic-year ID, name and nullable maximum; no school or term. |
| `exam_scores` | Required `varchar(191)` IDs, `score decimal(5,2)`, `entered_by`; nullable `remarks`; required `created_at text`. Unique `(exam_id,student_id)`, with FKs to `exams.id`, `student_profiles.id`, `users.id`. Parent `exams` has required school, string academic year/term, class, subject, exam name; max and weight default to 100.00; FKs to school and class. |
| `examination_marks` | Required IDs, `school_id`, `raw_marks double`, `weight double`, `weighted_marks double`, `grade`, `state`, `version`, `entered_by`, `updated_at`; nullable `comment`; defaults state `DRAFT`, version `1`. Unique `(examination_id,student_id,subject_id)`. FKs to schools, examinations, student profiles, subjects and users. Parent examination links to school, nullable academic-year ID and term ID; examination-subject marks and weights default to 100. |
| `student_assessments` | Required `varchar(191)` IDs for school/student/subject/term; nullable `class_score`, `exam_score`, `total_score decimal(5,2)` each default `0.00`; nullable `grade varchar(10)` and `remarks varchar(255)`; required `created_at`. FKs link school, student profile and subject. No declared term FK, class/year column or unique score-scope index. |
| `report_cards` | Required school/profile-student/string-year/string-term/class IDs; nullable `total_score decimal(6,2)`, `average_score decimal(5,2)`, position/size, attendance, remarks, publication time/user and Permanent Student ID; `published` defaults 0, publication status `DRAFT`, `is_blocked` defaults 0. Unique `(school_id,student_id,academic_year,term)`. |
| Identity and catalogue | `students.permanent_student_id` is unique and stored on the master `students` record. `student_profiles` links to the master by `student_master_id`, and stores profile `student_id`, current `class_id` and school. `subjects` stores school ownership; `class_subjects` links class and subject. |

The expanded [production schema inventory run 36208849852](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36208849852) succeeded at 2026-09-26 01:33:50 UTC against the expected production database. It checked out the Part 4A inventory commit `1243aaad5b6272eed3edcd180c5cd4aeb04cc329`. It ran the checked-in metadata-only SQL through the protected production workflow. The SQL queried only `DATABASE()` and `information_schema.COLUMNS`, `STATISTICS`, and `KEY_COLUMN_USAGE`; no score or student rows were read. It found absent `academic_score_records` and `subject_class_assignments`.

Schema alone does not establish which of the three existing scoring designs is the active Score Entry writer. A repository-wide search found no current writer or reader for `student_assessments`, `assessment_scores`, `exam_scores` or `examination_marks`; the only current repository score writer is `durable-academic.js:saveScore`, targeting the absent `academic_score_records`. The `student_assessments` table is the strongest combined-score candidate by its CA/exam/total/grade columns, but it lacks class/year keys, a declared term FK and a uniqueness constraint; there is no code provenance confirming its use by Score Entry. The other candidates split assessment and exam rows, use different student identifiers, or store weighted examination marks. Choosing one as canonical would still be a guess.

No realistic durable score fixture or real-result query was written. Selecting the wrong source risks duplicate or cross-class results, and the request explicitly prohibits a parallel store or guessed data contract.

### Repository provenance

| Table | Repository provenance and usage |
| --- | --- |
| `academic_score_records` | Defined in `schema/017_academic_results_migration.sql`; current `src/durable-academic.js` Score Entry writer/roster expects it; absent in production inventory. |
| `subject_class_assignments` | Used by current durable subject and score queries and assignment writer; no production table. Production has `class_subjects`; no writer for that mapping was found in the Result Slip path. |
| `assessment_scores` | Production table and FKs verified; no current writer/reader/migration definition found in this repository. Student FK targets master `students.id`; assessment parent supplies class/year, not term/school. |
| `exam_scores` | Production table and FKs verified; no current writer/reader/migration definition found. Student FK targets `student_profiles.id`; exam parent supplies school, class, subject and string year/term. |
| `examination_marks` | Defined in `schema/007_examinations_results.sql`; production table/FKs verified. No active score-entry/result reader in this repository was found. Examination supplies school/year/term; mark supplies profile, subject and weighted score. |
| `student_assessments` | Production table/FKs verified; no current writer/reader/migration definition found. It has combined score fields but the class/year linkage and active writer remain unverified. |

### Canonical score contract decision

| Field | Decision |
| --- | --- |
| CA / Class Assessment | **NOT VERIFIED.** `student_assessments.class_score` is a candidate, but no active writer provenance was found. `assessment_scores.score` is another candidate, linked through an assessment parent. |
| Examination Score | **NOT VERIFIED.** `student_assessments.exam_score`, `exam_scores.score`, and `examination_marks.weighted_marks` represent different possible sources. |
| Total | **NOT VERIFIED.** `student_assessments.total_score` exists; recomputation/authority against its components is unknown. |
| Student | **NOT VERIFIED as a unified source.** Existing tables point variously to master `students.id` and `student_profiles.id`; the profile-to-master link is `student_profiles.student_master_id`. |
| Subject | Subject FKs exist in assessment/exam/examination paths; `student_assessments.subject_id` also declares a FK to `subjects.id`. Active writer still unknown. |
| Class | **NOT VERIFIED for a combined score row.** Assessment and exam parent records carry a class; `student_assessments` does not. Profile class is current and cannot establish the historical selected class by itself. |
| Academic Year | **NOT VERIFIED uniformly.** Assessment parent uses an ID; exam parent uses a string; examination parent uses an ID; student assessment has no year column and no declared term FK. |
| Term | **NOT VERIFIED uniformly.** Exam parent uses a string and examination parent uses an ID; student assessment has a term ID column but no declared FK. |
| School isolation | **NOT VERIFIED uniformly.** `examination_marks`, exams and student_assessments contain school IDs, but assessment_scores relies on its parent and FKs have no school composite scope. |

The evidence gate therefore selects no single canonical Score Entry table and no Outcome A real-result integration. It also does not prove Outcome B's required capability is missing: production has tables storing score components and a combined-score candidate. No migration proposal or schema change is justified yet.

## C. Work performed and required next step

Part 4A fixed Lower Primary calculation and tests, and extended `scripts/production-schema-inventory.mjs` to execute the checked-in read-only metadata SQL through the existing protected workflow. The workflow succeeded. Its metadata records exact columns/defaults, indexes and declared foreign keys for score, result and supporting tables.

Required next evidence: identify the deployed/authorized production Score Entry writer and verify how it populates `student_assessments`, `assessment_scores`, `exam_scores` or `examination_marks`. Confirm whether score rows can be unambiguously scoped to selected class and year, how duplicate rows are handled, and how class/year/term/filter semantics agree with score-entry UI. Then establish the shared repository contract. Do not implement real result reads against a merely plausible table.

No migration is proposed at this stage. First prefer adapting both result retrieval and any necessary existing Score Entry query to the same established tables. Preserve existing IDs, records and history; do not copy scores into a parallel table. If metadata proves a missing capability, a separately documented additive, backward-compatible proposal and preservation strategy must precede any migration.

## D. Permanent Student ID

The verified source remains `students.permanent_student_id`. Part 2 returns its unchanged stored value separately from `students.id`. This investigation performed no allocation, normalization, regeneration or record write. Real-result integration with that source remains blocked and is not claimed complete.

## E. Existing calculations by level

| Level | Inspected current behavior |
| --- | --- |
| Nursery | Existing OTHER classification; no Best Six aggregate |
| KG | Raw total and no aggregate |
| Lower Primary | English Language, Mathematics, Science and History plus best two; approved A–I point mapping now sums the selected six |
| Upper Primary | No aggregate in current calculator |
| JHS | Existing numeric 1–9 scale, core four plus eligible best two, current tie-breakers retained |

## F. Lower Primary NaN investigation

`src/result-calculation.js:numericGrade` previously applied `Number(row.grade)` and, on failure, `Number(gradeForTotal(...)[0])`. For Lower Primary both values are letters. Six valid 85-point subjects therefore produced six A grades, qualified for aggregation, then produced NaN, serialized as null. This pre-fix behavior was reproduced directly in Node.

This was a missing grade-to-aggregate-point conversion, not malformed marks. Part 4A now provides the user-approved centralized conversion A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8, I=9. Lower Primary best-subject sorting and aggregate summation use those points. Unknown non-empty grades throw an explicit error; absent grades use the existing score-to-grade service before conversion. Score thresholds are unchanged. KG and JHS do not use the Lower Primary map. Regression tests prove six A grades aggregate to 6 and A,B,B,C,C,D aggregate to 15, with numeric non-null JSON output.

## G. Supporting component status

| Component | Status | Exact gap |
| --- | --- | --- |
| GES Assessment | REQUIRES LATER PART | Current saved-result Map/browser assessment storage is not a verified durable GES source. `report_cards` contains conduct, class-teacher and headmaster remarks, but no attitude/interest columns; inspected `student_assessments` does not establish the five GES fields or their writer. |
| Attendance | REQUIRES LATER PART | Production table columns/FKs are now verified, but differ from `attendance-repository.js` expectations (for example, production has `date`, not `attendance_date`; it lacks `method` and arrival/departure fields). The real result does not call this service. |
| Gender | PARTIALLY CONNECTED | `students.gender` is verified durable data, but the real result still obtains gender from the memory roster |
| Class gender totals | REQUIRES LATER PART | Real result must count selected year/class membership from durable students/enrollments and exclude tests |
| Signatures | REQUIRES LATER PART | Production `result_signatures` and `staff_assignments` metadata is inventoried, but the active writer/role and tenant/class/context resolution contract is not connected to the current Map-based resolver. |
| PDF | NOT VERIFIED | Real PDF still depends on the in-memory result method; no Part 4 PDF repair or visual validation performed |

These statuses do not establish completion of the blocked durable result contract. No missing supporting value was filled with sample data.

## H. Security

Existing route authentication, RBAC checks, teacher scope and Part 3 sample guards were inspected and left unchanged. The rerun baseline covers prior school isolation and sample mutation protections. It does not prove the requested new real durable cross-student/class/year/term authorization, enrollment validation, no-result semantics or ranking isolation. Those Part 4 checks cannot be honestly marked PASS before the SQL integration exists.

## I. Executed validation

No durable-result Part 4 tests were added because its implementation is blocked. Four new Lower Primary regression tests were added; the focused result-calculation suite has **9 passed, 0 failed, 0 skipped**. The combined Part 1–3 plus relevant sample/calculation suite has **120 passed, 0 failed, 0 skipped, 0 cancelled** on Node v25.6.1. Protected production schema workflow run **36208849852** succeeded; it executed the metadata-only query for exact commit `1243aaad5b6272eed3edcd180c5cd4aeb04cc329`.

```powershell
node --check scripts/production-schema-inventory.mjs
node --test test/result-calculation.test.js
node --test test/result-slip-sample-context.test.js test/result-slip-students.test.js test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js test/admission-enrollment.test.js test/class-database.test.js test/class-database-part2.test.js test/class-database-financial-identity.test.js test/permanent-student-id.test.js test/student-identity.test.js test/sample-result-workflow.test.js test/result-calculation.test.js
git diff --check
```

Direct defect reproduction command:

```powershell
node --input-type=module -e 'import { calculateAggregate } from "./src/result-calculation.js"; import { gradeForTotal } from "./src/grading.js"; const rows=["English Language","Mathematics","Science","History","RME","Creative Arts"].map(subjectName=>({subjectId:subjectName,subjectName,totalScore:85,grade:gradeForTotal(85,{classId:"Primary1"})[0]}));const r=calculateAggregate(rows,{classId:"Primary1"}); console.log(JSON.stringify({grades:rows.map(x=>x.grade),qualifying:r.qualifying,isNaN:Number.isNaN(r.aggregate),serialized:JSON.stringify({aggregate:r.aggregate})}));'
```

This command records the pre-fix reproduction: six A grades, qualifying=true, isNaN=true, serialized aggregate=null. The post-fix values are checked by the automated Lower Primary regression tests above.

The schema SQL was inspected: after comments are stripped, all four statements start with SELECT and read `DATABASE()` or `information_schema`; the workflow script rejects mutation keywords before executing them. `node --check src/result-calculation.js`, `node --check scripts/production-schema-inventory.mjs` and `git diff --check` passed. No production score/result rows, SQL-backed durable result fixture or live browser result was read/executed.

## J. Database

- Migration required: **NOT DETERMINED**. The score source is ambiguous, and production already has score-bearing candidate tables; no migration proposal is justified or applied.
- Schema changes: none. The inventory script uses metadata SELECT statements only.
- Production data mutations: none.
- Production schema metadata is collected; deployed writer provenance and unambiguous historical class/year association must be established before deciding the durable score mapping.

## K. Git

- Branch: `fix/result-slip-options-part1`.
- Part 1 preserved: `5f5e661`.
- Part 2 preserved: `cfbf0ceb69ce57bf16abb9495998af01772edee7`.
- Part 3 preserved: `06cf1d1664d784222df26b954242551d00f7a2ea`.
- Part 4 durable result implementation SHA: **none; implementation remains blocked**.
- Part 4A calculation/inventory commit: `0a1dca77ac9f62b38eb1f7bc8fc37bb93482f264`.
- Part 4A malformed-grade and all-level validation commit: `43fab959d6bed1efef3403c9bf7a3fbb0233c551`.
- Readable inventory log-output commit: `1243aaad5b6272eed3edcd180c5cd4aeb04cc329` (pushed only so the protected workflow could inspect this exact commit).
- Evidence-report commit and final working-tree status are recorded in the accompanying response; it documents the metadata result and does not add durable result integration.
- NOT MERGED. NOT DEPLOYED. No history rewrite.

## L. Remaining GES gaps for Part 5

Determine the durable source for Conduct, Attitude, Interest, Class Teacher Remarks and Headteacher Remarks; map its school/student/class/year/term keys; connect saved values and reload behavior without browser-local state overriding authoritative values; preserve save validation and sample isolation. No GES values have been fabricated and Part 5 has not begun.
