# Part 5 — Promotion Class and Term Filtering

## Files changed

The existing `public/promotion.html` page was enhanced in place with Academic Year, a single-selection canonical Class dropdown, a single-selection Term dropdown, an eligible Student dropdown, Decision, Comment, and the existing Save Promotion Decision action. The client references students by internal `id` and displays `name — permanentStudentId`.

`src/students.js` now records `termId` in class-assignment history and exposes `listEligibleStudents`. `src/examinations.js` now validates school, academic year, class, term, student enrollment, decision vocabulary, and sample-mode boundaries while retaining backward compatibility for the existing promotion service. `src/server.mjs` wires the examination service to the canonical student service and exposes filtered promotion options through `/api/examinations/promotion/options`; the existing save endpoint now passes class and term context. The generic `/promotion` page alias targets the existing promotion page rather than the results page. `test/promotion-filtering.test.js` contains the new regression coverage.

## Canonical enrollment query

The authoritative query is `students.listEligibleStudents({ requestedSchoolId, academicYearId, classId, termId, includeTestRecords })`. It filters the canonical student collection by tenant school and excludes test records by default, then requires a matching class-assignment history entry for all three academic dimensions: `academicYearId`, `classId`, and `termId`. Student references remain the canonical internal student ID; Permanent Student ID is display identity only.

The canonical class source is `CORE_LEVELS` from `src/students.js`: Nursery 1, Nursery 2, KG1, KG2, Primary 1–6, and JHS 1–3. Terms use the existing display/internal values First Term, Second Term, and Third Term because no separate incompatible term registry exists in the current service layer.

## Safety and historical behavior

Opening or changing a dropdown does not create a promotion decision. Save requires an explicit decision and a matching school/year/class/term/student enrollment context. Sample students are excluded from normal eligible lists and cannot be promoted into production enrollment. Promotion records store their selected class and term context; they do not mutate result records or Permanent Student IDs. Existing student class history remains append-only, preserving historical class/year/term context for retrieval.

## Tests

The Part 5 focused suite passed **88/88** tests, including Nursery-to-JHS3-style term coverage, wrong-class and wrong-term exclusion, Permanent Student ID retention, school/year filtering, explicit-save validation, and sample isolation. The complete repository suite passed **534/534** tests. Protected asset verification passed for all **12** login assets.

Part 6 was not started.
