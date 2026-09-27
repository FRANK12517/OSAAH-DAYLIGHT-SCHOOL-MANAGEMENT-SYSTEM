# Result Slip repair — Part 1 report

## Scope and location

Repair branch: `fix/result-slip-options-part1`, based on `origin/main` at `655328d`.
Working directory: `.worktrees/result-slip-options-part1` beneath the original workspace.
The original checkout was an older `codex/admission-tidb-enrollment` branch without the reported error message. Remote references were refreshed and current main was inspected in an isolated worktree. No merge, push, deployment, migration, or production data write was performed.

## Verified root cause

The exact message originates in `src/server.mjs`, in the catch for `GET /api/academic/options`. It returns HTTP 500 for non-authorization errors from `durableAcademic.options(user)`.

Production schema evidence: the successful read-only [Production schema inventory run 36139568009](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36139568009), logged September 25, 2026 at 13:13 UTC, reports:

- `classes`: `id`, `school_id`, `name`, `level`, `department_id`, `created_at`.
- `levels`: `id`, `school_id`, `name`, `display_order`, `created_at`, `updated_at`.
- Academic years and terms contain all columns referenced by the existing options queries.

The old academic-options class query joins on `c.level_id`, selects `COALESCE(c.sort_order,c.display_order,0)`, and filters `c.status`. All four referenced class columns are absent from the recorded production schema. SQL resolves column identifiers before evaluating COALESCE; that expression cannot provide compatibility for a missing column. A temporary SQL database with the production class layout reproduces the query failure.

There is a separate frontend contract defect: `public/result-view.js` treated each class as a string, although the durable endpoint returns `{ id, name, displayOrder, levelName }` objects. It would display `[object Object]` and use that text as the value. It then called `options.students.filter`, although the durable response has no `students` property.

This establishes the schema/query incompatibility and frontend parsing defects. No authenticated production HTTP request was made in this task, and no claim is made about the first column named in a live TiDB error or the current count of production class rows.

## Request trace

1. `public/results.html` loads `public/result-view.js`.
2. Initialization requests `/api/academic/options`.
3. The server authenticates the session/cookie or bearer token (401 when absent).
4. The route requires `academics.read`, `results.read`, or `examinations.read` (403 otherwise).
5. The durable service checks the actor school against the configured service school: `OSAAH_SCHOOL_ID`, otherwise the existing database-mode default `sch_default_01`.
6. Academic years are scoped by `academic_years.school_id`; terms are scoped through their academic year. Both existing SQL queries are unchanged.
7. Class options now read the canonical `classes` table using its verified production ownership column.
8. The endpoint returns class objects; the frontend binds the existing ID to the option value and the display name to its visible label.
9. Year remains an input, enhanced with database-backed suggestions; term remains a select using the existing name-valued request contract. Available terms follow the selected academic year.

## API/query repaired

`GET /api/academic/options`, through `src/durable-academic.js`:

```sql
SELECT c.*
FROM classes c
WHERE c.school_id=?
ORDER BY c.name,c.id
```

Only the public option fields are mapped into the response. Optional status and ordering fields, if present, are handled after retrieval without referencing absent SQL columns. Existing inactive records are excluded when their status is available.

For a database explicitly reporting `ER_BAD_FIELD_ERROR` for `c.school_id`, the service uses the repository's legacy `classes.level_id -> levels.school_id` ownership contract. Connection, permission, and missing-table failures do not trigger that fallback. The legacy query uses the foundation schema's actual ordering columns. Tenant and permission checks run before querying; teacher assignment filtering is retained for configured assignments.

No schema column was added or invented, and no class was created or duplicated.

## Class source and dropdown behavior

The sole production class source is existing `classes` rows. IDs are never derived from labels. The Result Slip displays, in order:

Nursery; KG 1; KG 2; Basic 1; Basic 2; Basic 3; Basic 4; Basic 5; Basic 6; JHS 1; JHS 2; JHS 3.

Legacy display mappings retain the original backend values: Nursery 1 -> Nursery; KG1/KG2 -> KG 1/KG 2; Primary 1–6 -> Basic 1–6. Nursery 2 remains in the shared catalogue and database; it is outside this requested Result Slip list. No other module's catalogue is changed. Classes absent from the response are never fabricated; teachers see only returned assigned classes.

The dropdown is a required native single select. Loading, no configured classes, malformed response, request failure, and a 15-second timeout each have explicit states. Failed loads offer retry. Missing optional students cannot destroy the class selector. Generation is disabled when no student can be selected.

## Files changed

- `src/durable-academic.js`: options query compatibility, service permission checks, canonical class response mapping and tenant/assignment filtering.
- `public/result-view.js`: correct object/string handling, canonical option values, requested class labels/order, year suggestions and term binding, optional-student guard, loading/error/timeout/retry states.
- `public/results.html`: required single class selector, initial loading states, academic-year datalist, retry control, and initial generation gate.
- `test/result-slip-options.test.js`: SQL, HTTP, frontend, compatibility and security regression coverage.
- `docs/RESULT_SLIP_PART_1_REPORT.md`: this report.

The result rendering, signatures, assessment, scores, saving, publication, printing, and PDF implementations were not modified.

## Focused verification

Command:

```text
node --test test/result-slip-options.test.js test/durable-academic.test.js test/score-entry-regression.test.js test/academic-results.test.js test/academic-workflow-regression.test.js
```

Result: **32 passed, 0 failed, 0 skipped**, Node 25.6.1.

Coverage includes the old SQL failure; successful production/legacy-schema queries; successful HTTP endpoint response; 12 visible labels; single selection; canonical ID submission; 401/403; cross-school exclusion; assigned teacher filtering; optional-student absence; unchanged legacy year/term values; timeout; malformed/empty responses; retry recovery; optional inactive-class filtering; and existing score/result/academic workflow checks.

SQL tests use temporary in-memory SQLite with the relevant recorded column layouts, not production TiDB. Frontend tests execute the page script with DOM/fetch test doubles. Native browser/live-production verification was not performed. SQL integration cases require Node 22+ `node:sqlite` and explicitly skip on Node 20; the application itself retains Node 20 compatibility. `git diff --check` passed.

## Remaining issues for Part 2

- The durable options response does not include students. A school/class/year-scoped durable student source for Result Slip selection must be connected in Part 2.
- `/api/academic/result` and the save/publication/PDF result flow still use `academicResults`, the in-memory service, while the options endpoint uses durable class IDs. That integration requires separate diagnosis and repair; it has not been bypassed or replaced here.
- Other durable academic operations reference schema contracts outside this options repair. Their compatibility must be assessed within the next authorized scope.
- After deployment is explicitly authorized, verify the live canonical class rows and an authenticated browser load. The tests prove behavior with all 12 records supplied; they do not assert that those 12 records currently exist in the live tenant.
