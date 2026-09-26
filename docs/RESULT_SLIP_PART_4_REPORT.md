# Result Slip repair — Part 4 investigation

Status on 2026-09-26: **BLOCKED ON VERIFIED SCORE SCHEMA. Part 4 is not implemented or complete.**

The Part 4 instruction to stop before speculative schema changes applies. No runtime code, SQL writer, grading rule or migration has been changed. Parts 1–3 remain intact. NOT MERGED. NOT DEPLOYED.

## A. Verified previous architecture

With Test Mode off, `public/result-view.js:loadResult` sends the form's internal durable student ID, stored Permanent Student ID, canonical class ID, year and term to `/api/academic/result`. The request has the Part 2/3 abort, context-version and timeout protection. The real response currently has no explicit frontend identity-match validation beyond the request/context version.

`src/server.mjs` authenticates the request and requires `results.read` or `results.generate`, but the route unconditionally invokes `academicResults.result`. That instance is constructed from the ordinary student/subject/signature services rather than a durable real-result reader. Its configured school is `OSAAH_SCHOOL_ID`, defaulting to `sch_default_01` with a database; the service factory itself still has a legacy default, but server construction supplies the configured school.

In `src/academic-results.js`, `terminal`, `mocks`, `savedResults` and `publications` are Maps. `studentFor` uses the in-memory student service. Class checks and classification use legacy class values. Subject resolution uses the in-memory subject service/register, whose generic default catalogue cannot stand in for production configuration. Missing configured marks become zero-valued placeholder rows. The method computes positions, grades, remarks and aggregates using existing calculation services, then returns the full renderer's flat DTO.

Attendance and GES fields come from the in-memory saved-result record. Gender and class totals come from the in-memory student roster. Signatures come from `src/signatures.js`, which stores signatures in a Map and uses in-memory staff assignments. Real PDF generation calls the same in-memory result method. Part 3 separately routes sample previews through its isolated durable-context adapter.

The current durable Score Entry writer is `src/durable-academic.js:saveScore`. It writes CA/examination/total to `academic_score_records`, refers to `student_profiles` for score identity, validates `subject_class_assignments`, and requires `e.school_id`, `e.enrollment_status` and `e.is_current`. The roster query uses the same assumptions. Repository-wide source searches found no current SQL writer/reader mapping the production `assessment_scores`, `exam_scores` or `examination_marks` tables into this result flow.

## B. Root cause and schema blocker

The real endpoint has never been connected to the durable student/score path repaired in the preceding parts. A second, independent incompatibility prevents safely adopting the current durable Score Entry SQL unchanged.

Evidence: the successful [production inventory run 36139568009](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36139568009), recorded 2026-09-25 13:13 UTC, was read again for this investigation. Listing the latest five inventory runs found no newer successful inventory.

| Contract | Recorded production evidence |
| --- | --- |
| `academic_score_records` | Absent from the complete table inventory |
| `subject_class_assignments` | Absent from the complete table inventory |
| `student_enrollments` | Only `id`, `student_id`, `class_id`, `academic_year_id`; no school/status/current columns expected by Score Entry |
| Existing score candidates | `assessment_scores`, `assessments`, `exam_scores`, `exams`, `examination_marks`, `examinations`, `examination_subjects` exist |
| Existing subject configuration | `subjects` and `class_subjects` exist |
| Existing result/support candidates | `report_cards`, `student_assessments`, `result_publications`, `result_blocks`, `student_attendance`, `result_signatures` exist |

The inventory includes columns for students/classes/years/terms/enrollments, but not those score/result/support tables. Table names alone do not establish CA/examination weighting, student identity links, uniqueness, publication state or which persisted source is authoritative. Old migration definitions cannot establish their actual production columns. No local DATABASE_URL is configured in this worktree environment.

Consequently, claiming to have identified the actual production Score Entry source, or constructing a realistic SQL fixture for it, would be unsupported. Creating `academic_score_records` would also risk a second score store, explicitly prohibited by the request.

## C. Work performed and required next step

Only this report and `docs/RESULT_SLIP_PART_4_SCHEMA_READONLY.sql` were added. The SQL file reads column and key metadata from information_schema; it contains no schema/data mutation and selects no student or score records. It has **not** been executed against production.

Required next evidence: run that metadata query through an authorized read-only database connection, or supply an equivalent export. Inspect the actual production Score Entry writer if it differs from this repository. Resolve student/profile identity, CA/examination source, year/term/class/school ownership and saved/publication state before implementing a shared durable read path.

No migration is proposed at this stage. First prefer adapting both result retrieval and any necessary existing Score Entry query to the same established tables. Preserve existing IDs, records and history; do not copy scores into a parallel table. If metadata proves a missing capability, a separately documented additive, backward-compatible proposal and preservation strategy must precede any migration.

## D. Permanent Student ID

The verified source remains `students.permanent_student_id`. Part 2 returns its unchanged stored value separately from `students.id`. This investigation performed no allocation, normalization, regeneration or record write. Real-result integration with that source remains blocked and is not claimed complete.

## E. Existing calculations by level

| Level | Inspected current behavior; no rules changed |
| --- | --- |
| Nursery | Existing OTHER classification; no Best Six aggregate |
| KG | Raw total and no aggregate |
| Lower Primary | English Language, Mathematics, Science and History plus best two; letter-grade numeric-conversion defect remains |
| Upper Primary | No aggregate in current calculator |
| JHS | Existing numeric 1–9 scale, core four plus eligible best two, current tie-breakers retained |

## F. Lower Primary NaN investigation

`src/result-calculation.js:numericGrade` applies `Number(row.grade)` and, on failure, applies `Number(gradeForTotal(...)[0])`. For Lower Primary both values are letters (`A`, `B`, `C`, `D`, `F`). For example, six valid 85-point subjects produce six A grades, qualify for aggregation, then produce NaN; JSON serializes the aggregate as null. This was reproduced directly in Node during this investigation.

This is a missing grade-to-aggregate-point conversion, not malformed marks. The existing thresholds are A >= 80, B >= 70, C >= 60, D >= 50, otherwise F. Repository searches did not establish an approved numeric point mapping for those letters. Production has `grading_scales` and `grading_systems`, but their columns/configuration have not been inspected. Inventing A=1 through F=5 or substituting JHS points would introduce an unverified rule. No such change, zero fallback or threshold change was made. A documented existing mapping is needed before a correct numeric-aggregate fix can be proven.

## G. Supporting component status

| Component | Status | Exact gap |
| --- | --- | --- |
| GES Assessment | REQUIRES LATER PART | Current saved-result Map/browser assessment storage is not a verified durable GES source; inspect `student_assessments`/`report_cards` contracts |
| Attendance | REQUIRES LATER PART | Repository has a durable attendance reader, but the real result does not call it; its production column/identity contract needs verification |
| Gender | PARTIALLY CONNECTED | `students.gender` is verified durable data, but the real result still obtains gender from the memory roster |
| Class gender totals | REQUIRES LATER PART | Real result must count selected year/class membership from durable students/enrollments and exclude tests |
| Signatures | REQUIRES LATER PART | Current resolver uses a Map/in-memory staff; production signature columns and assignment relationships are not inventoried |
| PDF | NOT VERIFIED | Real PDF still depends on the in-memory result method; no Part 4 PDF repair or visual validation performed |

These statuses do not establish completion of the blocked durable result contract. No missing supporting value was filled with sample data.

## H. Security

Existing route authentication, RBAC checks, teacher scope and Part 3 sample guards were inspected and left unchanged. The rerun baseline covers prior school isolation and sample mutation protections. It does not prove the requested new real durable cross-student/class/year/term authorization, enrollment validation, no-result semantics or ranking isolation. Those Part 4 checks cannot be honestly marked PASS before the SQL integration exists.

## I. Executed validation

No new Part 4 regression tests were added: implementation is blocked. New Part 4 count: **0**. Baseline rerun: **116 passed, 0 failed, 0 skipped, 0 cancelled** on Node v25.6.1.

```powershell
node --test test/result-slip-sample-context.test.js test/result-slip-students.test.js test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js test/admission-enrollment.test.js test/class-database.test.js test/class-database-part2.test.js test/class-database-financial-identity.test.js test/permanent-student-id.test.js test/student-identity.test.js test/sample-result-workflow.test.js test/result-calculation.test.js
```

Direct defect reproduction command:

```powershell
node --input-type=module -e 'import { calculateAggregate } from "./src/result-calculation.js"; import { gradeForTotal } from "./src/grading.js"; const rows=["English Language","Mathematics","Science","History","RME","Creative Arts"].map(subjectName=>({subjectId:subjectName,subjectName,totalScore:85,grade:gradeForTotal(85,{classId:"Primary1"})[0]}));const r=calculateAggregate(rows,{classId:"Primary1"}); console.log(JSON.stringify({grades:rows.map(x=>x.grade),qualifying:r.qualifying,isNaN:Number.isNaN(r.aggregate),serialized:JSON.stringify({aggregate:r.aggregate})}));'
```

Result: six A grades, qualifying=true, isNaN=true, serialized aggregate=null. This reproduces a failure; it is not a passing repair test.

Documentation whitespace is checked with `git diff --check`. Runtime syntax/build validation is not needed for these documentation-only changes. No production result, database metadata query file, new SQL-backed Part 4 fixture or live browser result was executed.

## J. Database

- Migration required: **NOT DETERMINED**; no speculative migration proposed or applied.
- Schema changes: none.
- Production data mutations: none.
- Existing table/column evidence must be completed before deciding a durable score mapping.

## K. Git

- Branch: `fix/result-slip-options-part1`.
- Part 1 preserved: `5f5e661`.
- Part 2 preserved: `cfbf0ceb69ce57bf16abb9495998af01772edee7`.
- Part 3 preserved: `06cf1d1664d784222df26b954242551d00f7a2ea`.
- Part 4 implementation SHA: **none; implementation blocked**.
- Any commit containing this report is investigation documentation only, not a completed Part 4 repair. Exact documentation SHA and working-tree status are recorded in the accompanying response.
- NOT MERGED. NOT DEPLOYED. No push or history rewrite.

## L. Remaining GES gaps for Part 5

Determine the durable source for Conduct, Attitude, Interest, Class Teacher Remarks and Headteacher Remarks; map its school/student/class/year/term keys; connect saved values and reload behavior without browser-local state overriding authoritative values; preserve save validation and sample isolation. No GES values have been fabricated and Part 5 has not begun.
