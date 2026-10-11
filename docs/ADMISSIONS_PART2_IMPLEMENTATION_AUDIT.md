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
- The active sandbox exposed no database/TiDB/MySQL environment-variable names or database connector. GitHub Actions secret-name listing was denied by repository permissions. Read-only inventory workflows were dispatched for the current production revision: migration-ledger run [38129692856](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38129692856) is in progress; schema inventory run [38129694667](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38129694667) is waiting on the protected Production environment approval. No database status is claimed until those runs complete.
- Migration 081 remains the canonical nullable `students.health_insurance_number` migration. No duplicate Part 2 health-insurance column or historical migration rewrite was introduced.

## 2. Implementation

### Existing OSAAH students

`src/existing-student-linking.js` now:

- preserves a valid existing `OSAAH/YYYY/NNN` ID exactly;
- refuses malformed existing IDs with `PERMANENT_STUDENT_ID_REVIEW_REQUIRED` rather than replacing them;
- requires a staff-supplied, exact four-digit, non-future historical OSAAH admission year when the canonical ID is missing;
- allocates the missing ID inside the existing transaction using `student_id_sequences` with `FOR UPDATE` locking;
- reconciles the yearly counter against existing master and profile IDs, including legacy four-digit sequence values;
- now fails closed if any queried same-year ID is malformed or has an invalid sequence instead of silently dropping it during reconciliation;
- now rejects different non-empty IDs on the existing master student and profile as a controlled identity conflict;
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
- now fails closed on malformed same-year IDs encountered during counter reconciliation;
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
- `uq_students_school_permanent_id` on `(students.school_id, students.permanent_student_id)` from Migration 038;
- existing admission/application uniqueness constraints from Migration 078;
- the nullable canonical Health Insurance Number field from Migration 081.

The implementation does not use `SELECT MAX(sequence)+1`, does not renumber IDs, and does not overwrite an existing valid ID. Source schema establishes the school-scoped master-ID unique index and the yearly sequence primary key; actual target deployment of those constraints, current duplicate/conflict state, and lock/unique behavior remain unverified pending the read-only inventory runs and a real database integration test.

## 4. Historical identity handling

No production student rows were read or modified during this audit. Local tests cover:

- missing ID + missing historical year: controlled rejection;
- missing ID + verified 2020 historical year: allocation of `OSAAH/2020/001` and persistence to the canonical student row;
- valid existing ID: exact preservation;
- malformed IDs: controlled-review rejection in the service contract;
- ambiguous identity and conflicting supplied identity: rejection;
- retry/idempotent existing-student linking: existing record reuse.
- malformed same-year sequence IDs: controlled conflict in both allocators;
- differing valid master/profile IDs: controlled conflict rather than choosing one.

No automatic name-only merge or ambiguous historical-year backfill was added.

## 5. Tests and quality gates executed

- `node --test test/existing-student-linking.test.js test/permanent-student-id.test.js test/admission-enrollment.test.js` — **22 passed, 0 failed** after takeover fixes.
- `npm test` — **1,400 passed, 0 failed** after takeover fixes.
- `npm run migration:validate` — **passed**, `{"valid":true,"migrationCount":80}`.
- `npm run assets:verify` — **passed**, 12 protected assets.
- `npm run protection:verify` — **passed**, 5 protected components.
- `node --check src/existing-student-linking.js` — **passed**.
- `node --check src/admission-enrollment.js` — **passed**.
- `git diff --check` — **passed after correcting the audit-document whitespace found during takeover**.

The focused tests use test adapters; they are not evidence of real database locking/concurrency. PR #363 currently has no submitted human review (`reviews: []`, `reviewRequests: []`, no review decision). A production-compatible TiDB integration run, required review, merge, and Part 2 deployment are not complete. Migration 081 is present in the repository, but production schema and ledger status remain unverified until the dispatched inventory workflows complete.

## 6. Changed files

- `src/existing-student-linking.js`
- `src/admission-enrollment.js`
- `test/existing-student-linking.test.js`
- `test/admission-enrollment.test.js`
- `docs/ADMISSIONS_PART2_IMPLEMENTATION_AUDIT.md`

## 7. Release blockers and next actions

1. Run a controlled TiDB-compatible integration test for sequence locking, unique conflicts, rollback, and repeated requests; the required database credentials/adapter were not available in this sandbox.
2. Obtain approval from the repository’s authorized Production environment reviewer for read-only schema inventory run 38129694667; retrieve the migration ledger result from run 38129692856 once it finishes.
3. Obtain a review from an authorized human other than the PR author and required CI checks on existing PR #363.
4. Only after all release gates pass, merge and verify the deployed revision, approved migration application, and controlled production behavior. Do not begin Part 3 before those gates pass.
