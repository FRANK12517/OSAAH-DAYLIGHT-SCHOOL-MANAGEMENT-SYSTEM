# Admissions Part 2 Implementation Audit

**Project:** OSAAH DAYLIGHT SCHOOL MANAGEMENT SYSTEM  
**Branch:** `feature/admissions-part2-safe-id-generation`  
**Audit date:** 2026-10-11

## 1. Starting-state verification

- `origin/main` at start: `ca86ad78f892049ab6ec7dd3bac4591c6bb514e3`.
- Part 1 PR #362 is **MERGED**: [PR #362](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/362).
- PR merge commit: `ca86ad78f892049ab6ec7dd3bac4591c6bb514e3`.
- `git merge-base --is-ancestor ca86ad78f892049ab6ec7dd3bac4591c6bb514e3 origin/main`: passed.
- GitHub deployment evidence shows a Production deployment for `ca86ad78f892049ab6ec7dd3bac4591c6bb514e3` at `2026-10-11T09:20:42Z`.
- The sandbox has no `DATABASE_URL` or `OSAAH_DATABASE_ADAPTER_MODULE`; the actual production migration ledger and production schema were not queried. Production deployment evidence is therefore distinct from database-application evidence.
- Migration 081 remains the canonical nullable `students.health_insurance_number` migration. No duplicate Part 2 health-insurance column or historical migration rewrite was introduced.

## 2. Implementation

### Existing OSAAH students

`src/existing-student-linking.js` now:

- preserves a valid existing `OSAAH/YYYY/NNN` ID exactly;
- refuses malformed existing IDs with `PERMANENT_STUDENT_ID_REVIEW_REQUIRED` rather than replacing them;
- requires a staff-supplied, exact four-digit, non-future historical OSAAH admission year when the canonical ID is missing;
- allocates the missing ID inside the existing transaction using `student_id_sequences` with `FOR UPDATE` locking;
- reconciles the yearly counter against existing master and profile IDs, including legacy four-digit sequence values;
- writes the allocated ID to the canonical `students` row and profile in the same transaction;
- remains idempotent on retry because the existing student is reused and the now-persisted ID is preserved;
- keeps staff-only, school-scoped authorization and identity-conflict checks;
- validates optional Health Insurance Number input to the existing nullable 64-character schema field.

Existing-student migration continues to bypass the parent application review/document workflow. It only creates the missing profile/enrollment records needed for the selected class/year/term and does not create a competing student record.

### Transfers and first-time applicants

The existing `src/admission-enrollment.js` path remains the canonical admission-completion path. Its existing transaction-safe allocator:

- allocates independently by applicable OSAAH admission year;
- uses the yearly sequence row under transaction lock;
- advances beyond existing legacy IDs;
- creates the canonical student, profile, enrollment, parent link, application state, and audit record atomically;
- handles repeated admission completion idempotently through the application’s persisted `student_id` and `permanent_student_id`;
- rejects missing historical year for `ALREADY_ENROLLED` and uses the current OSAAH admission year for transfer/first-time categories.

Part 2 also rejects a supplied transfer or first-time `admissionYear` that is malformed or does not match the actual OSAAH admission event year; it does not silently accept a previous-school year as the OSAAH ID year.

Parent application creation/submission remains separate from admission completion and does not generate a Permanent Student ID. The protected `/enroll` route remains restricted to authorized admissions staff and requires an accepted offer.

## 3. Database invariants

No new schema migration was necessary for Part 2 because the current schema already provides:

- `students.permanent_student_id`;
- school-scoped uniqueness through the canonical class-database reconciliation; 
- `student_id_sequences(admission_year PRIMARY KEY, next_sequence)`;
- existing admission/application uniqueness constraints from Migration 078;
- the nullable canonical Health Insurance Number field from Migration 081.

The implementation does not use `SELECT MAX(sequence)+1`, does not renumber IDs, and does not overwrite an existing valid ID. A real database integration run is still required before production release to verify the current target ledger, existing duplicate/conflict state, and lock/unique-constraint behavior against the production-compatible TiDB adapter.

## 4. Historical identity handling

No production student rows were read or modified during this audit. Local tests cover:

- missing ID + missing historical year: controlled rejection;
- missing ID + verified 2020 historical year: allocation of `OSAAH/2020/001` and persistence to the canonical student row;
- valid existing ID: exact preservation;
- malformed IDs: controlled-review rejection in the service contract;
- ambiguous identity and conflicting supplied identity: rejection;
- retry/idempotent existing-student linking: existing record reuse.

No automatic name-only merge or ambiguous historical-year backfill was added.

## 5. Tests and quality gates executed

- `node --test test/existing-student-linking.test.js test/permanent-student-id.test.js test/admission-enrollment.test.js` — **19 passed, 0 failed**.
- `npm run migration:validate` — **passed**, `{"valid":true,"migrationCount":80}`.
- `node --check src/existing-student-linking.js` — **passed**.
- `node --check src/admission-enrollment.js` — **passed**.
- `git diff --check` — **passed**.

The real database integration/concurrency checks, PR review, merge, and Part 2 deployment were not completed in this audit segment. They remain mandatory before claiming Part 2 complete.

## 6. Changed files

- `src/existing-student-linking.js`
- `src/admission-enrollment.js`
- `test/existing-student-linking.test.js`
- `test/admission-enrollment.test.js`
- `docs/ADMISSIONS_PART2_IMPLEMENTATION_AUDIT.md`

## 7. Release blockers and next actions

1. Run the full test suite and repository-specific assets/protection/build gates.
2. Run a controlled TiDB-compatible integration test for sequence locking, unique conflicts, rollback, and repeated requests.
3. Query the approved target database migration ledger and verify Migration 081 status; do not infer it from deployment status.
4. Review the final diff, commit this branch, open a PR against `main`, and wait for required review/checks.
5. Only after merge, verify the deployed revision, approved migration application, and controlled production behavior. Do not begin Part 3 before those gates pass.
