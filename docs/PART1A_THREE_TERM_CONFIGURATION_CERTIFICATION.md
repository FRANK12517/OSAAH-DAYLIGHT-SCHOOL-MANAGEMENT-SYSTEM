# PART 1A — THREE-TERM CONFIGURATION CERTIFICATION

## 1. Starting SHA

`270449473e3f298478768ff79631ea244e84c4d1`

## 2. Scope and result

This implementation adds a guarded, idempotent production configuration runner for the approved 2026/2027 three-term configuration. It does **not** create a schema migration, hard-code term dates into the Parent Dashboard, create official student enrollments, or bypass Parent authorization.

**Final status: BLOCKED for production completion in this sandbox.** The protected production `DATABASE_URL` was not available, so no production read or write was attempted. The repository implementation and local verification are complete and ready to run against the protected production database.

## 3. Configuration identity

| Item | Value |
|---|---|
| School ID | `sch_default_01` |
| Academic Year ID | `ay_2026_01` |
| Academic Year | `2026/2027 Academic Year` |
| Academic Year dates | `2026-09-01` → `2027-07-31` |
| Confirmed term-ID convention | Sequential IDs for this verified academic year: `term_2026_01`, `term_2026_02`, `term_2026_03`; the runner preflights ownership and conflicts before writing |
| First Term ID | `term_2026_01` |
| Second Term ID | `term_2026_02` |
| Third Term ID | `term_2026_03` |

The runner refuses to proceed if the school, academic year, First Term, uniqueness contract, target-ID ownership, or existing Second/Third Term data do not match the approved preflight contract.

## 4. Term dates

| Canonical name | Parent label | ID | Dates |
|---|---|---|---|
| First Term | 1st Term | `term_2026_01` | `2026-09-01` → `2026-12-18` |
| Second Term | 2nd Term | `term_2026_02` | `2027-01-11` → `2027-04-09` |
| Third Term | 3rd Term | `term_2026_03` | `2027-05-03` → `2027-07-23` |

Second Term and Third Term dates are **temporary sample configuration values approved for testing**. They must be replaced through the canonical academic configuration mechanism when authoritative school dates are available.

## 5. Implementation performed

- Added `src/production-three-term-config.js` with:
  - final read-only preflight;
  - school and academic-year identity checks;
  - First Term existence verification;
  - target-ID conflict and cross-year ownership checks;
  - `(academic_year_id, name)` uniqueness verification;
  - transactional insertion of only missing Second and Third Term rows;
  - post-write verification;
  - idempotent rerun behavior;
  - dry-run mode.
- Added `scripts/production-three-term-configure.mjs`.
- Added `npm run production:three-terms -- dry-run|apply`.
- Added focused tests covering preflight, approved dates, idempotency, conflict rejection, and dry-run behavior.
- Confirmed the existing Parent term normalization renders `1st Term`, `2nd Term`, and `3rd Term` while preserving canonical server-side IDs and dates.
- Confirmed the existing controlled sample-context architecture supports all three canonical terms and remains restricted to `OSAAH-DEMO-001` and `OSAAH-DEMO-002` under the server-owned controlled Parent fixture.

## 6. Schema and migration status

- Schema changes: **NONE**
- Migration changes: **NONE**
- Migration 059: **UNCHANGED**
- Unrelated official student, attendance, result, fee, payment, receipt, timetable, assignment, promotion, and completion data: **NOT CREATED**

## 7. Verification evidence

- Focused configuration + Parent/sample-context suite: **32 passed / 0 failed**
- Full repository regression suite: **940 passed / 0 failed**
- Migration inventory validation: **PASS — 58 migrations discovered**
- Production configuration dry-run: **BLOCKED safely with `DATABASE_URL_MISSING` before any database access**
- Production data write: **NOT RUN**
- Parent production QA login `0247293733`: **NOT RUN; protected production database/runtime unavailable**
- DEMO-001 / DEMO-002 production three-term QA: **NOT RUN; protected production database/runtime unavailable**
- HTTP 500 count during local verification: **0 test failures attributable to this change**
- HTTP 503 count during local verification: **0 test failures attributable to this change**

The full suite emits expected negative-path authorization/error logs in tests, but all 940 tests pass.

## 8. Production execution gate

After the protected production `DATABASE_URL` is made available, run:

```bash
npm run production:three-terms -- dry-run
npm run production:three-terms -- apply
```

The command is intentionally fail-closed and targets only the expected `osaahdaylightschool` database. After apply, rerun the Parent login and child/term switching QA for `OSAAH-DEMO-001` and `OSAAH-DEMO-002`, then re-query `terms` to certify exactly three rows for `ay_2026_01` with no duplicate names.

## 9. Remaining limitation

The sandbox did not contain the protected production database credential, so this certification cannot truthfully claim that the live canonical terms table was changed or that the live Parent portal was exercised. Part 1A should be marked **PASS** only after the protected dry-run, apply, post-write query, and production Parent QA complete successfully.
