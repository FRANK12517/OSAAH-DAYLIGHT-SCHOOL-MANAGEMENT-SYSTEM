# Result Slip repair — Part 3

Completed locally on 2026-09-26. NOT MERGED. NOT DEPLOYED.

## A. Existing sample architecture

`public/result-view.js` owns Test Mode, form submission and the full slip renderer. The existing `/api/academic/sample/generate` route calls `src/sample-result-workflow.js`. That workflow uses the existing student service's in-memory seeded test roster: two sample identities per supported legacy class, marked `isTestRecord`, with reserved `TEST-OSAAH-...` identifiers. Supplying those reserved identifiers bypasses production Permanent Student ID allocation.

The workflow previously accepted legacy class values such as `Nursery1`, `KG1`, `Primary1` and `JHS3`. It creates deterministic demonstration scores using the existing hash-based generator: CA is out of 50, examination is out of 50, and the existing academic-results/calculation services compute totals, grades, positions and aggregates. It also supplies existing test attendance and GES assessment values. No new score generator or renderer was introduced.

The legacy subject service has a generic default subject set and supports class assignments; it does not provide a separate complete built-in subject library for each requested level. The durable academic service already resolves database subject assignments. Part 3 reuses that source instead of introducing another subject catalogue.

## B. Verified integration gap

The browser required a selected student and entered the sample path only when that selected record had `isTestRecord`. Part 2 deliberately returns durable production membership, not the old in-memory test roster. Consequently, a class-only Test Mode selection could not invoke the intended sample workflow. Independently, the sample generator expected legacy class values, while Part 1 correctly submits canonical database class IDs. Passing those IDs directly could not satisfy its legacy class validation. The server also constructed the sample workflow without supplying the configured school ID.

The existing durable subject query assumes `subject_class_assignments`; the recorded production table inventory contains `class_subjects`. Its columns were not captured in that inventory, so the compatibility path discovers actual columns before building its query. This is a verified schema compatibility concern, not a claim that a live production sample request was executed.

## C. Implementation

Flow: authenticated school → existing canonical class lookup and teacher scope → existing year/term resolution → server-side normalization of the stored class name → existing configured subject resolver → request-local instances of the existing sample and calculation services → existing Result Slip renderer.

Canonical class IDs remain in browser requests and returned result context. Only the internal calculation adapter uses the verified legacy class classification. Browser labels, supplied school IDs and supplied student identities cannot override sample context. Nursery maps to Nursery1; KG 1–2 to KG1–2; Basic 1–6 to Primary1–6; JHS 1–3 to JHS1–3. The existing level classifier determines Nursery, KG, Lower Primary, Upper Primary or JHS behavior.

The subject resolver first uses its existing assignment query. Only sample resolution enables the legacy compatibility path, and only for missing-table/column errors. That path inspects `class_subjects` and `subjects`, requires the necessary identity columns, scopes subjects to the authenticated school and canonical class, and applies supported year, term and active/status restrictions. Other database failures propagate. Missing configuration produces an unavailable state; there is no generic or other-class fallback.

Test Mode requires year, term and class, without requiring a real student. Enabling it clears selected student identity and rendered result while retaining academic context. Disabling it removes sample rendering and restores explicit durable-student selection. Context changes clear the result immediately and retain an explicitly enabled Test Mode. AbortController, result version checks and a bounded timeout prevent stale responses and indefinite loading. Loading, unavailable, recoverable error and retry states are covered.

The existing renderer remains responsible for subjects, CA/examination, totals, grades, remarks, position/aggregate, GES fields, attendance, signatures and print. The existing PDF endpoint regenerates an isolated preview when requested with `sample=true`; the same PDF builder is used. Preview Save/Publish controls are disabled, and server guards enforce that restriction independently.

### Files changed

| File | Purpose |
| --- | --- |
| `src/durable-academic.js` | Canonical sample context, configured subjects and metadata-checked legacy assignment compatibility |
| `src/sample-result-workflow.js` | Isolated use of existing sample identities, generator and calculation engine |
| `src/server.mjs` | School wiring, existing sample/PDF route integration and production mutation guards |
| `public/result-view.js` | Class-only sample loading, toggles, stale-response protection, statuses and preview controls |
| `public/results.html` | Load Result label and retry control |
| `public/result-pdf.js` | Preview PDF request flag |
| `src/result-slip-pdf.js` | Display canonical class name rather than opaque ID |
| `test/result-slip-sample-context.test.js` | 30 focused Part 3 regression tests |
| `test/result-slip-options.test.js` | Test Mode event-capable test fixture |
| `test/result-slip-students.test.js` | Event-capable fixture and explicit real-mode reset expectations |
| `docs/RESULT_SLIP_PART_3_REPORT.md` | This report |

## D. Data safety evidence

These conclusions concern the new durable terminal sample-preview path and the exercised mutation endpoints. They are based on code inspection, query recording, state snapshots and HTTP tests, not live production writes.

| Area | Verified behavior |
| --- | --- |
| Students | Existing sample identities are instantiated only in request-local memory; no production student insertion or membership change. |
| Enrollments | No enrollment writes; sample generation does not query or insert production enrollment records. |
| Permanent Student ID sequence | Reserved TEST identifiers are reused; production allocation remains unchanged, including the next real ID in the regression fixture. |
| Real scores | Production score state is unchanged across sample loads. Normal score and mock-score APIs reject sample markers/reserved IDs. |
| Real results | Shared saved-result state and academic audit snapshots remain unchanged. Preview computation uses a private instance of the existing engine. |
| Rankings | Existing real ranking snapshots remain identical; private sample peers never enter the real engine. |
| Broadsheets | Real broadsheet snapshots remain identical. |
| Publishing | Normal result save/publish APIs reject sample state with 403. Durable sample publish/reset endpoints reject preview persistence with 409. |
| SMS | No enqueue/process calls in the exercised sample or rejected publish flows; no parent notification dispatch. |

Attendance, remarks and GES demonstration values stay inside the private sample result. Browser assessment storage is scoped by school, reserved test identity and academic context, separately from real student keys. Sample generation has no production attendance, promotion or Class Database write path. School and teacher class/subject restrictions remain enforced, including 401/403 coverage. The signature adapter supplies the authenticated school and canonical class to the existing resolver.

No migration, schema change, database reset or production data modification was performed. Existing legacy non-database sample/mock services were not replaced.

## E. Subjects and calculations

All 12 canonical classes are exercised. Representative configured fixture sets are Nursery (2 subjects), KG (3), Lower Primary (6), Upper Primary (6), and JHS (8). These counts describe test configuration, not an assertion about current production subject assignments. Tests verify the selected class's configured subject IDs, deterministic CA/examination scores, maximum 50 for each component, calculated totals and parity with the existing grade/aggregate services.

Nursery, KG and Upper Primary retain existing non-JHS aggregate behavior; JHS retains numeric grading and existing aggregate/ranking rules. Lower Primary retains the existing calculation behavior. A pre-existing limitation remains: when its configured subjects qualify for aggregate computation, conversion of letter grades to numbers can produce NaN (serialized as null). Part 3 intentionally does not redesign grading or aggregate rules. This requires focused Part 4 verification.

## F. Executed validation

Runtime: Node v25.6.1. SQLite emitted its experimental-feature warning; no tests were skipped.

New tests were run first:

```powershell
node --test test/result-slip-sample-context.test.js
```

Final focused result: **30 passed, 0 failed, 0 skipped**.

The established 78-test regression set was then run together with the 30 new tests and 8 existing sample/calculation tests:

```powershell
node --test test/result-slip-sample-context.test.js test/result-slip-students.test.js test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js test/admission-enrollment.test.js test/class-database.test.js test/class-database-part2.test.js test/class-database-financial-identity.test.js test/permanent-student-id.test.js test/student-identity.test.js test/sample-result-workflow.test.js test/result-calculation.test.js
```

Final combined result: **116 passed, 0 failed, 0 skipped, 0 cancelled**.

Additional checks:

```powershell
node --check src/server.mjs
node --check public/result-view.js
git diff --check
```

These checks passed. HTTP tests exercised authentication, authorization, sample loading and valid PDF output. UI behavior was exercised through the existing DOM test harness. Live production operation, actual production subject configuration and visual browser/printed-page inspection were not verified in this task.

## G. Git

- Branch: `fix/result-slip-options-part1`
- Preserved Part 1: `5f5e661`
- Preserved Part 2: `cfbf0ceb69ce57bf16abb9495998af01772edee7`
- Part 3: the local commit containing this report; its exact SHA and final working-tree status are recorded in the completion message.
- NOT MERGED. NOT DEPLOYED. No push or history rewrite.

## H. Remaining for Part 4 — not implemented

1. The real `/api/academic/result` route still calls the shared in-memory academic-results service. Durable student IDs, canonical class IDs and durable score records need verified integration with that real-result path; this repair only adapts sample context.
2. Verify actual production subject assignment columns and completeness across all 12 classes. Missing subject configuration intentionally returns unavailable instead of inventing subjects. Verify the durable real score schema and retrieval path before changing queries.
3. Verify real result lifecycle persistence and reload, GES assessment, attendance, remarks, school/class signatures, and real PDF/print output. Sample adapter coverage does not establish that those real durable paths work end to end.
4. Investigate the existing Lower Primary letter-grade aggregate issue without assuming JHS rules should apply. Broader real-result grading/ranking verification belongs to Part 4.
5. Verify production Generate Result authorization and enrollment membership end to end, and confirm real publishing/notifications remain correctly scoped after any future durable integration.

Part 4 has not been started.
