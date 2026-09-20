# OSAAH Daylight School Complex
## Part 4 Fee Setup Class Dropdown and Fee Publication Report

**Implementation date:** 2026-09-20  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Branch:** `main`  
**Base commit:** `cf1ce5e`  
**Scope:** Part 4 only. Part 5 was not implemented.

## Part 4 status

| Area | Status |
|---|---|
| Fee Setup load | **PASS** — canonical options endpoint and safe client loading are implemented and tested. |
| Database connection | **PASS for the configured production path; live connection not exercised in this sandbox.** |
| Academic Year | **PASS** — school-scoped database options query. |
| Term | **PASS** — school-scoped academic-year-linked options query. |
| Fee Type | **PASS** — school-scoped fee-structure options query. |
| Amount | **PASS** — positive, finite minor-unit validation with two-decimal frontend parsing. |
| Target | **PASS** — `SPECIFIC_CLASS` and `WHOLE_SCHOOL`, with legacy `ALL_STUDENTS` compatibility. |
| Class dropdown | **PASS** — backend-driven canonical class IDs and display labels. |
| Nursery 1–JHS 3 | **PASS** — 13 canonical classes represented once. |
| Specific-class publication | **PASS** — validates school/class/year/term and persists canonical class ID. |
| Whole-school publication | **PASS** — no class required and no class ID stored. |
| Parent visibility | **PASS / preserved** — existing parent Fee Hub query and Permanent Student ID path remain unchanged. |
| Raw database-error protection | **PASS** — safe Fee Setup and Fee Hub messages replace raw database errors. |

Live production database connectivity, live class rows, live fee structures, and live parent records were not queried because no deployment database credentials were configured in this sandbox. The production code path uses the configured `DATABASE_URL` adapter and strict validation.

## Root cause of “No classes available”

The previous `/api/classes` implementation derived its response from the in-memory student service:

```text
students.listStudents(...).map(student => student.classId)
```

That meant the Fee Setup dropdown only contained class IDs represented by currently loaded in-memory student fixtures. It did not query the canonical database `levels → classes` relationship, could omit valid classes with no in-memory student, and could not provide the required Nursery-through-JHS sequence reliably. The frontend also loaded classes independently and rendered a generic “No classes available” option when that incomplete response was empty.

Part 4 fixes the root cause by adding `/api/fee-setup/options`, which queries school-scoped `academic_years`, `terms`, `fee_structures`, `levels`, and `classes`. `/api/classes` now uses the same resolver. Without a database adapter, the local development fallback exposes the full canonical `CORE_LEVELS` sequence rather than deriving classes from students.

## Canonical class source and naming

The database source is:

```text
levels.school_id → classes.level_id → classes.id
```

The returned value is the stable database class ID. The UI receives a display label separately. The resolver maps legacy presentation names without duplicating records:

- `Primary 1` through `Primary 6` display as `Basic 1` through `Basic 6`.
- `KG1` and `KG2` display as `KG 1` and `KG 2`.
- Nursery and JHS labels are preserved.

The canonical sequence is:

`Nursery 1`, `Nursery 2`, `KG 1`, `KG 2`, `Basic 1`, `Basic 2`, `Basic 3`, `Basic 4`, `Basic 5`, `Basic 6`, `JHS 1`, `JHS 2`, `JHS 3`.

The frontend does not hard-code these as `<option>` values. It consumes the backend `{ id, name }` contract.

## APIs modified

### `GET /api/fee-setup/options`

Added a school-scoped options endpoint. It returns:

- `academicYears`
- `terms`
- `feeTypes`
- `classes`

The endpoint requires an authenticated user with Fee Hub read/configure/write access. It returns safe error messages such as `Unable to load Fee Setup data. Please try again.` and records only sanitized diagnostic metadata in the audit stream.

### `GET /api/classes`

Updated to use the canonical Fee Setup options resolver rather than the in-memory student list. It remains authenticated and permission-protected.

### `POST /api/fees/obligations/publish`

The existing Fee Hub publication endpoint remains in place. It now passes the target into the repository and uses strict production validation for:

- supported target;
- positive amount;
- fee structure belonging to the actor’s school;
- academic year belonging to the actor’s school;
- term belonging to the selected school-scoped academic year;
- specific class belonging to the actor’s school;
- required class when target is specific.

### Existing parent Fee Hub endpoint

No replacement parent architecture was created. Existing `/api/parent/fee-obligations` behavior and Permanent Student ID/parent-link query path were preserved.

## Database queries modified or added

The new options resolver uses these school-scoped query contracts:

```sql
SELECT id, name, starts_on, ends_on, is_current
FROM academic_years
WHERE school_id=?
ORDER BY starts_on DESC, id
```

```sql
SELECT t.id, t.academic_year_id, t.name, t.starts_on, t.ends_on, t.is_current
FROM terms t
JOIN academic_years y ON y.id=t.academic_year_id
WHERE y.school_id=?
ORDER BY t.starts_on ASC, t.id
```

```sql
SELECT id, fee_type, fee_type
FROM fee_structures
WHERE school_id=?
ORDER BY fee_type, id
```

```sql
SELECT c.id, c.name, c.display_order, l.name, l.display_order
FROM classes c
JOIN levels l ON l.id=c.level_id
WHERE l.school_id=?
ORDER BY l.display_order, c.display_order, c.id
```

Strict publication validation additionally verifies fee structure, academic year, term, and canonical class ownership through school-scoped queries before inserting materialized student obligations.

The existing materialized obligation model is preserved: the Fee Hub creates one obligation per eligible active student because the existing Parent Portal and balance path consumes student obligations. It does not create duplicate fee definitions.

## Frontend files modified

### `public/fee-setup.html`

The page now:

- loads academic years, terms, fee types, and classes from `/api/fee-setup/options`;
- uses backend class IDs as option values;
- displays the canonical class labels;
- activates and requires Class only for `Specific Class`;
- hides and clears Class for `Whole School`;
- validates positive amounts with at most two decimal places;
- rejects incomplete fields before publication;
- displays safe user-facing errors;
- preserves the existing Fee Hub publication and published-obligation list.

## Backend files modified

- `src/server.mjs`
  - added Fee Setup options resolver;
  - made `/api/classes` canonical and database-backed;
  - enabled strict Fee Hub publication validation in production;
  - passed target information into the existing publication repository.
- `src/fee-collections-repository.js`
  - added target, amount, academic-period, and canonical-class validation;
  - retained idempotent materialized student obligations;
  - kept legacy adapter behavior compatible for existing repository tests through explicit `strictValidation` configuration.

## Access control and error handling

Fee Setup options require `fees.read`, `fees.configure`, or `fees.write`. Fee publication remains restricted by the existing Fee Hub write roles. Existing `ACCOUNTANT_BURSAR` access is preserved, and unauthorized roles cannot use the Fee Setup API.

Raw database errors are not rendered by the Fee Setup page. Client-facing messages include:

- `Unable to load Fee Setup data. Please try again.`
- `Unable to load classes. Please try again.`
- `Unable to publish this fee. Please try again.`
- safe validation messages such as `Class not found.` and `Academic year not found.`

No `DATABASE_URL`, database username, SQL stack trace, internal hostname, or raw access-denied error is sent to the browser.

## Tests executed

| Test or check | Result |
|---|---|
| New Part 4 Fee Setup tests | **PASS** — canonical options, 13 classes, target behavior, publication, validation, and safe errors. |
| Existing Fee Hub repository tests | **PASS** — legacy atomicity, idempotency, tenant, class, status, and transaction behavior preserved. |
| Existing Fee Hub API tests | **PASS**. |
| Part 3 authentication tests | **PASS**. |
| Full `npm test` | **PASS** — 631 tests passed, 0 failed. |
| `npm run migration:validate` | **PASS** — 30 migrations discovered. |
| `npm run assets:verify` | **PASS** — 12 protected assets verified. |
| `git diff --check` | **PASS**. |
| Live production database query | **NOT RUN** — no configured deployment database in sandbox. |
| Browser QA against live authorized accounts | **NOT RUN** — live database/session unavailable. |

## Branch

`main`

## Commit

No commit was created. The working tree is based on commit `cf1ce5e`.

## Files changed

- `public/fee-setup.html`
- `src/server.mjs`
- `src/fee-collections-repository.js`
- `test/fee-setup-part4.test.js`
- `docs/PART_4_FEE_SETUP_REPORT.md`

Part 1, Part 2, and Part 3 work was preserved. Part 5 was not implemented.

## Safety confirmations

- No duplicate Fee Hub architecture was created.
- No duplicate class rows were created.
- Existing materialized student-obligation behavior was preserved for Parent Portal visibility and balances.
- Existing Accountant permissions were preserved.
- No production migration or production data mutation was performed.
- No raw database error or credential was exposed to browser users.

## Stop condition

Part 4 is complete and locally validated. Stop here. Do not implement Part 5 automatically.

## References

[1]: `public/fee-setup.html` "Canonical Fee Setup UI and target-aware class selector"

[2]: `src/server.mjs` "Fee Setup options endpoint, canonical class endpoint, and Fee Hub publication route"

[3]: `src/fee-collections-repository.js` "Fee obligation publication validation and materialization"

[4]: `src/parent-fee-obligations-repository.js` "Existing Parent Portal fee-obligation visibility query"

[5]: `test/fee-setup-part4.test.js` "Part 4 Fee Setup and publication tests"

[6]: `test/fee-collections-repository.test.js` "Existing Fee Hub repository regression tests"

[7]: `docs/PART_3_STAFF_AUTHENTICATION_RBAC_REPORT.md` "Part 3 authentication and RBAC foundation"
