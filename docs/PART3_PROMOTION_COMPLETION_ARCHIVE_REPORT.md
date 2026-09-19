# Part 3 — Automatic Promotion, Repetition, Completion, and Completed Archives

## Scope

Part 3 continues the canonical Class Database implementation from Parts 1 and 2. The Class Database remains a projection over the canonical student/enrollment service; no manual Class Database update is required after a promotion, repetition, or completion decision.

## Promotion architecture

The existing `createExaminationService().promote()` workflow remains the authorized decision entry point. When the service is created with the canonical student service, a successful `PROMOTED` decision now calls `students.assignClass()` with the target class, next academic period, and `PROMOTED` reason. The promotion record stores the Permanent Student ID, source class, decision context, and target class. The current student projection changes immediately, while the prior enrollment remains in the student history array.

The target class can be supplied explicitly through `toClassId` or `nextClassId`; for standard configured classes, the existing class registry provides the next class. JHS 3 has no implicit next class and must use the explicit authorized completion workflow rather than being completed merely because the student is in JHS 3.

Promotion records are idempotent for a canonical student/enrollment key. Repeating the same API request returns the existing decision without adding a duplicate history entry. A conflicting decision for the same enrollment is rejected.

## Repetition architecture

A `REPEAT` decision calls the same canonical `assignClass()` path with the original class and the next academic period. The student remains in the same class, receives no new identity, and is not archived. The historical enrollment entry is retained, while the next-period active enrollment is represented by the current student projection and a new history entry.

## Bulk promotion

`examinations.bulkPromote()` validates every decision and enrollment before applying any mutation. It supports mixed cohorts in one request, such as students promoted from Primary 4 to Primary 5 and students repeating Primary 4. Existing decisions are idempotent, conflicting decisions fail, and each student is processed through the same canonical single-student workflow.

## Completion and archive architecture

Completion is explicit and authorized. `examinations.complete()` and `GRADUATED` decisions require the student to be a current JHS 3 student and require a completion year. Completion sets the student status to `COMPLETED`, records the completion year and timestamp, appends a `COMPLETION` history entry, and removes the student from active class membership without deleting the student identity.

The Permanent Student ID, student identity, parent links, parent phone, attendance references, result references, and academic history remain attached to the same student record. Completed students are excluded from active `listStudents()` and promotion eligibility, and are returned through `listCompleted()`.

JHS 3 repetition uses `REPEAT`, retains active JHS 3 membership for the next academic period, and does not create a completed record.

## Completed Class Database UI

A protected sibling page, `/completed-class-database.html`, is registered in the existing Students Management navigation. It provides:

- Completion Year selector populated from actual completion records.
- Search by Permanent Student ID, student name, parent/guardian name, or phone.
- Permanent Student ID.
- Name of Student.
- Name of Parent/Guardian.
- Registered Parent Phone Number.
- Year of Completion.

There is no hard-coded short year list. If no completion records exist, the year options are empty and the page presents a safe empty state.

## Enrollment architecture

The existing in-memory canonical student service remains the source of current class membership and enrollment history. `assignClass()` is now duplicate-aware for the same class, academic year, and term, while still preserving all prior historical assignments. Completed status is represented on the canonical student record; no duplicate archived student identity is created.

This implementation preserves the repository’s existing service interfaces and legacy decision-only examination mode when no student service is injected. That compatibility is required by existing examination tests and does not weaken the canonical automatic-transition path used by the application.

## APIs changed

| API | Change |
|---|---|
| `POST /api/examinations/promotion` | Existing route now passes target class, next academic period, and completion context into the canonical workflow. |
| `POST /api/examinations/promotion/bulk` | New protected bulk promotion/repetition endpoint. |
| `POST /api/examinations/completion` | New protected explicit completion endpoint. |
| `GET /api/class-database/completed/options` | New protected completion-year options endpoint. |
| `GET /api/class-database/completed` | New protected completed/archive search endpoint. |

All new endpoints require the existing authenticated school workflow and relevant `promotion.write` or `students.read` permissions. School ownership and existing role/teacher scoping remain enforced.

## Schema changes

No SQL schema change was required for the repository’s canonical in-memory workflow. Completion year, completed status, completion timestamp, and completion history are stored on the existing canonical student object and returned through the existing student service projection. This avoids a second archive identity table and preserves the existing System of Record design.

## Files changed

- `src/students.js` — duplicate-aware enrollment assignment, completion state, active filtering, completed listing, completion years.
- `src/examinations.js` — automatic promotion/repetition transitions, bulk decisions, explicit completion, idempotency, legacy compatibility.
- `src/class-database.js` — completed archive projection, search, and actual completion-year options.
- `src/server.mjs` — promotion context, bulk/completion APIs, completed archive APIs.
- `src/sidebar-registry.js` — protected Completed Class Database navigation entry.
- `public/completed-class-database.html` — completed archive UI.
- `public/completed-class-database.js` — completion-year filter, search, table, empty state, and escaping.
- `test/class-database-promotion.test.js` — isolated promotion, repetition, bulk, completion, archive, identity, parent, history, and retry tests.

## Required test coverage

| Requirement | Result |
|---|---|
| Primary 1 → Primary 2 promotion | PASS |
| Primary 2 repetition | PASS |
| Mixed bulk promotion and repetition | PASS |
| JHS 3 → completed | PASS |
| JHS 3 → repeat | PASS |
| Completed search by Permanent Student ID | PASS |
| Completed search by completion year | PASS |
| Permanent Student ID unchanged | PASS |
| Parent relationship and phone preserved | PASS |
| Old enrollment history preserved | PASS |
| Duplicate promotion retry safe | PASS |
| Duplicate completion retry safe | PASS |
| Completed students excluded from current Class Database | PASS |

## Validation

The Part 3 focused suite passed **17/17** tests. The complete repository suite passed **550/550** tests. Protected login asset verification passed **12/12** assets.

The first full-suite run exposed one legacy compatibility regression because decision-only examination tests construct the examination service without a student service. The implementation was corrected so automatic enrollment transitions occur only when the canonical student service is present; legacy decision-only behavior remains unchanged. The corrected full suite is green.

Per the requirements, implementation stops after Part 3. Part 4 was not started.
