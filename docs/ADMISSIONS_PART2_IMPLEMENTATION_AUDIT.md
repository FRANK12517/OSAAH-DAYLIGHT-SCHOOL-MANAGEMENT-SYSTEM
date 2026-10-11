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
- The active sandbox exposed no database/TiDB/MySQL environment-variable names or database connector. Two approved read-only GitHub Actions inventories completed successfully against `osaahdaylightschool`: [migration ledger run 38129692856](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38129692856) and [schema inventory run 38129694667](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38129694667). The ledger contains 20 recorded versions and its latest is 076; it has no record for 077–081, including 081. The live schema inventory confirms `students.permanent_student_id` is nullable `varchar(100)` with a unique index, and `student_profiles.student_id` is non-null `varchar(100)` with a unique index. It does not report a `students.health_insurance_number` column. The schema inventory does not include `student_id_sequences`, so that production table’s presence/definition remains unverified. No student data rows were queried.
- Migration 081 remains the canonical nullable `students.health_insurance_number` migration. No duplicate Part 2 health-insurance column or historical migration rewrite was introduced.

## 2. Implementation

### Existing OSAAH students

`src/existing-student-linking.js` now:

- preserves a valid existing `OSAAH/YYYY/NNN` ID exactly;
- refuses malformed existing IDs with `PERMANENT_STUDENT_ID_REVIEW_REQUIRED` rather than replacing them;
- requires a staff-supplied, exact four-digit, non-future historical OSAAH admission year when the canonical ID is missing;
- allocates the missing ID inside the existing transaction using `student_id_sequences` with `FOR UPDATE` locking;
- reconciles the global yearly counter against existing master and profile IDs, including legacy four-digit sequence values, consistent with the production’s globally unique ID indexes;
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

The codebase's canonical schema provides:

- `students.permanent_student_id`;
- school-scoped uniqueness through the canonical class-database reconciliation;
- `student_id_sequences(admission_year PRIMARY KEY, next_sequence)`;
- `uq_students_school_permanent_id` on `(students.school_id, students.permanent_student_id)` from Migration 038;
- existing admission/application uniqueness constraints from Migration 078;
- the nullable canonical Health Insurance Number field from Migration 081.

The production inventory instead shows a unique index on `students.permanent_student_id` and another on `student_profiles.student_id` (both globally unique), while `students.school_id` is a non-unique index. This global uniqueness is stricter than the codebase's school-scoped canonical master index. Production status of `student_id_sequences` is not covered by the read-only schema script and remains unverified. The live schema has no `health_insurance_number`, and the migration ledger contains no entry for Migration 081; the health-insurance write must remain gated on its approved migration. The ledger also has no recorded migrations 077–080, so do not apply 081 in isolation or infer migration readiness from `main`/deployment state.

The implementation does not use `SELECT MAX(sequence)+1`, does not renumber IDs, and does not overwrite an existing valid ID. The existing-student allocator now scans the global ID namespace, matching the globally unique production indexes and shared yearly sequence row. A real database integration run is still required to verify the actual sequence table, target duplicate/conflict state, and lock/unique behavior against the production-compatible TiDB adapter.

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

- `node --test test/existing-student-linking.test.js test/permanent-student-id.test.js test/admission-enrollment.test.js` — **23 passed, 0 failed** after takeover fixes.
- `npm test` — **1,401 passed, 0 failed** after takeover fixes.
- `npm run migration:validate` — **passed**, `{"valid":true,"migrationCount":80}`.
- `npm run assets:verify` — **passed**, 12 protected assets.
- `npm run protection:verify` — **passed**, 5 protected components.
- `node --check src/existing-student-linking.js` — **passed**.
- `node --check src/admission-enrollment.js` — **passed**.
- `git diff --check` — **passed after correcting the audit-document whitespace found during takeover**.

The focused tests use test adapters; they are not evidence of real database locking/concurrency. The production read-only inventories confirm that Migration 081 is not recorded and its health-insurance column is absent; the sequence table was not included in the schema inventory. PR #363 currently has no submitted human review (`reviews: []`, `reviewRequests: []`, no review decision). A production-compatible TiDB integration run, required review, merge, and Part 2 deployment are not complete.

## 6. Changed files

- `src/existing-student-linking.js`
- `src/admission-enrollment.js`
- `test/existing-student-linking.test.js`
- `test/admission-enrollment.test.js`
- `docs/ADMISSIONS_PART2_IMPLEMENTATION_AUDIT.md`

## 7. Release blockers and next actions

1. Run a controlled TiDB-compatible integration test for sequence locking, unique conflicts, rollback, and repeated requests; no direct database adapter/credential is exposed in the sandbox.
2. Reconcile the production migration ledger (latest recorded 076; 077–081 absent) and target schema before migration work. In particular, review/apply required migrations in the correct order; do not apply 081 alone. Verify `student_id_sequences` and its lock/index definitions in a read-only migration/DB workflow.
3. Obtain an independent human review (PR author cannot review their own PR) and confirm all CI checks for the final commit.
4. Only after all release gates pass, merge and verify the deployed revision, approved migrations, and controlled production behavior. Do not begin Part 3 before those gates pass.
