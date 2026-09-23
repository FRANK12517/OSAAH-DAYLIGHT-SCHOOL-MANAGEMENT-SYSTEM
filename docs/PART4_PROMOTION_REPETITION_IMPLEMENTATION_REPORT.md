# Part 4 — Promotion, Repetition, and Automatic Class Database Movement

## Conclusion

Part 4 integrates the existing Promotion workflow with the canonical student enrollment history used by Class Database. A promoted student receives a next-academic-year enrollment in the next canonical class. A repeated student receives a distinct next-academic-year enrollment in the same class. The original enrollment remains available as historical truth.

The implementation preserves one canonical student identity, one Permanent Student ID, one canonical gender record, and the existing parent relationship. It does not create separate class tables, duplicate students, duplicate parents, or a second promotion engine. JHS 3 promotion beyond the terminal class is rejected, while JHS 3 repetition remains valid. The completed-class archive lifecycle remains outside Part 4.

The focused Part 4 suite passed **57 tests** with **0 failures**. The deterministic repository suite passed **702 tests** with **0 failures**. The external live-provider test remains excluded because it requires a live external provider and independently stalls in the sandbox.

## Branch and commit scope

The work is implemented on the feature branch `feat/part4-promotion-repetition`. The final commit and merge commit are recorded after the GitHub workflow completes.

## Promotion architecture discovered

The Promotion page is `public/promotion.html`. It loads eligible students through `GET /api/examinations/promotion/options` and submits decisions through `POST /api/examinations/promotion`. Bulk decisions use `POST /api/examinations/promotion/bulk`.

The server authorizes promotion writes with the existing `promotion.write` permission. It passes the decision to the existing `createExaminationService` instance in `src/examinations.js`. The service validates school scope, selected academic year, class, term, student eligibility, sample-record rules, duplicate decisions, and terminal-class progression. It then updates the canonical student service through `assignClass` or `completeStudent`. The existing server audit sink records the promotion decision with the actor, actor role, decision, class context, destination class, and timestamp.

Class Database reads the resulting student history through `src/class-database.js`. Its `enrollmentFor` resolver selects the applicable historical enrollment by academic year and class. Therefore, promotion changes the authoritative enrollment association rather than copying or moving the student master record.

## Canonical enrollment source of truth

`src/students.js` remains the source of truth for student identity and enrollment history. Each history entry contains the student ID, class, academic year, term, reason, optional promotion ID, and effective timestamp. The current `student.classId` is updated for the current projection, while prior history entries remain intact for historical queries.

No database migration was required. The existing in-memory service contract and existing database schema conventions already model enrollment history by academic year and term. Part 4 adds a transaction helper to the canonical student service; it does not introduce a parallel persistence model.

## Transaction and idempotency behavior

`createStudentService` now exposes `withTransaction(callback)`. The helper snapshots canonical student state and restores it if the callback throws. Bulk promotion uses this boundary and snapshots the promotion decision map as well, so a failure in a later decision restores both enrollment history and promotion decisions.

Individual and bulk promotion retain the existing idempotency key of student, source academic year, source class, and source term. Repeating the same decision returns the existing decision instead of creating another enrollment. Submitting a conflicting decision for the same source enrollment is rejected.

The enrollment service now detects conflicting fully scoped academic-year and term records for direct class assignment. Promotion and repetition decisions intentionally use the existing authoritative decision path, which permits the established term-based workflow while preserving one latest Class Database projection for a scoped context.

## Terminal-class protection

The canonical class list ends at JHS 3. A `PROMOTED` decision from JHS 3 is rejected even if a caller supplies an invalid explicit destination such as JHS 4. A `REPEAT` decision from JHS 3 remains valid and creates the next-year JHS 3 enrollment. Existing `GRADUATED` and completed-archive behavior is preserved and was not expanded into the Part 5 lifecycle.

## Scenario matrix

| Scenario | Previous Class | Decision | Destination Class | Old History Preserved | Permanent ID Unchanged | Class Database Correct | Result |
|---|---|---|---|---:|---:|---:|---|
| Single Promotion | Primary 1 | PROMOTED | Primary 2 | Yes | Yes | Yes | PASS |
| Repetition | Primary 2 | REPEAT | Primary 2 | Yes | Yes | Yes | PASS |
| Bulk Promotion | Primary 4 | 8 PROMOTED, 2 REPEAT | 8 to Primary 5; 2 to Primary 4 | Yes | Yes | Yes | PASS |
| Duplicate Submission | Any tested class | Same decision submitted twice | One destination enrollment | Yes | Yes | Yes | PASS |
| JHS 3 Repetition | JHS 3 | REPEAT | JHS 3 | Yes | Yes | Yes | PASS |
| Invalid JHS 3 Advancement | JHS 3 | PROMOTED to JHS 4 | Rejected | Yes | Yes | Not applicable | PASS |

## Integrity checks

| Integrity Check | Expected | Actual | Result |
|---|---|---|---|
| Permanent Student ID | Unchanged | Same ID before and after promotion, repetition, and class movement | PASS |
| Gender | Canonical and unchanged | Gender remains resolved from the canonical student record | PASS |
| Parent Link | Preserved | Parent name and normalized phone continue resolving in destination Class Database | PASS |
| Historical Enrollment | Preserved | Old academic year and class remain queryable | PASS |
| Duplicate Enrollment | None | Same decision is idempotent; mixed bulk cohort creates one next-year record per student | PASS |
| Cross-School Isolation | Enforced | Student and promotion service reject actors from another school | PASS |

## Class Database integration

The end-to-end path was tested as Promotion UI/API/service to canonical enrollment history to Class Database API/service projection. After a successful individual promotion, the old academic year and class still return the student historically, while the next academic year and destination class return the student as the applicable membership. Search by Permanent Student ID, student name, parent name, and parent phone remains available through the existing Part 2 Class Database service.

The repetition test confirms that a repeated student appears in the same class for the next academic year and does not appear in the next higher class. The bulk test confirms that an isolated mixed cohort produces eight destination-class records and two same-class records without duplicate identities.

## Security and preserved authorization

Promotion remains separately protected by `promotion.write`. Class Database viewers are not automatically granted promotion permission. The service rejects cross-school actors, and existing server handlers reject unauthorized direct promotion API calls. Class Database continues to enforce school scoping and assigned-class restrictions for teachers.

Part 1 admission, gender, Permanent Student ID, and parent-linkage coverage passed. Part 2 academic-year filtering, historical enrollment, all 13 canonical classes, identity fields, search, sibling support, missing-gender handling, responsive contracts, and school isolation passed. Part 3 exact sidebar routing and canonical Class Database route coverage passed.

## Files created and modified

The implementation adds `test/part4-promotion-rollover.test.js`, which covers individual promotion, repetition, mixed bulk promotion, rollback, JHS 3 repetition, invalid JHS 3 advancement, and conflicting scoped enrollments. It adds this report at `docs/PART4_PROMOTION_REPETITION_IMPLEMENTATION_REPORT.md`.

The implementation modifies `src/students.js` to add transaction rollback support and scoped enrollment-conflict protection. It modifies `src/examinations.js` to validate terminal-class progression and wrap bulk promotion in the existing service-level transactional pattern.

No migration was created. No production student data was modified. Part 5 completed-class archive lifecycle behavior was not implemented.

## Test totals and limitations

The focused Part 4 suite completed with **57 passed and 0 failed**. The full deterministic repository suite completed with **702 passed and 0 failed**. The only excluded test is `test/live-ai-provider.test.js`, which requires an external live AI provider and stalls independently in the sandbox.

Browser-level manual login, refresh, rapid-navigation, and mobile viewport verification were not executed through a live browser in this run. Those checks are therefore **NOT SUPPLIED — MANUAL VERIFICATION REQUIRED**. The automated tests did execute the promotion API, canonical service, historical Class Database projection, authorization contracts, rollback path, idempotency path, and preserved Part 1–3 suites.

## Unresolved issues

No unresolved implementation issue was identified within the Part 4 scope. Manual browser verification remains outstanding as stated above. The full completed-class archive lifecycle remains intentionally deferred to Part 5.

## References

[1]: https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM "OSAAH Daylight School Management System repository"
