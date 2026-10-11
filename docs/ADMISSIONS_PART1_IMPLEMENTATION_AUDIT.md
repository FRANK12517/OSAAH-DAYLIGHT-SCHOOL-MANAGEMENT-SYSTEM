# Admissions Part 1 — Implementation Audit

**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Production site:** <https://www.osaahdaylightschool.online>  
**Baseline revision:** `2cb8a64` (`main`, 2026-10-11)  
**Baseline working tree:** clean  
**Audit scope:** admissions UI, leadership roles, application persistence, student enrollment and permanent-ID allocation. No production database was accessed or changed.

## Baseline test result

Before edits, the focused admission/authorization command passed **25 tests, 0 failures**:

```sh
node --test test/admissions-workflow-ui.test.js test/admissions-leadership-http.test.js \
  test/admission-enrollment.test.js test/permanent-student-id.test.js \
  test/admission-form.test.js test/admission-document-upload-http.test.js \
  test/admissions-migration-gate.test.js
```

## Existing implementation traced

- The leadership route `/admissions` serves `public/admissions.html` for School Proprietor, Headteacher, and Assistant Headteacher. The application APIs are in `src/server.mjs`; durable application persistence is in `src/durable-admissions.js`.
- Parent-facing `/admissions/apply` serves a separate application page and remains subject to parent declarations, required application validation, applicable document review, assessment/review, approval, offer acceptance, and school-side enrollment. Parent sessions do not receive the staff review/enroll routes.
- Staff application creation/editing is permission-guarded by `admissions.write`; reading uses `admissions.read`; review, accept/reject, document review, and enrollment have separate server-side permission checks. The local leadership-role tests confirm all three leadership dashboards can open and save/reopen applications; a teacher is denied staff application creation.
- `src/admission-enrollment.js` performs durable transactional student/profile/enrollment/guardian-link creation and annual Permanent Student ID allocation. Existing student IDs are not changed by the allocator. The service has duplicate-submit and concurrent annual sequence tests.
- Application and related records are persisted in `admission_applications`, `admission_documents`, student/profile/enrollment/link tables. Migration 078 adds stable enquiry idempotency, application-to-student uniqueness and leadership RBAC links; migrations 023/027 define permanent-ID support.

## Findings and risk assessment

1. The leadership landing form previously asked for one full name, phone, class, academic year and term, then handed the user to a larger candidate form. Candidate fields can be populated from the same persisted application, but this two-step handoff is easy to mistake for a second data-entry stage.
2. The same workflow offered `ALREADY_ENROLLED`, `TRANSFER`, and `FIRST_TIME`, but still put each through the same submitted-application, review, offer, acceptance and enrollment UI. In particular, the UI offered assessment recording to any submitted application. `ALREADY_ENROLLED` therefore did not have a safe, distinct migration/registration path.
3. `src/durable-admissions.js` currently validates a broad set of candidate and guardian fields at submission and enforces a standard review path. `src/server.mjs` requires an accepted application and accepted offer before enrollment. Bypassing those checks in the browser would not create a reliable backend workflow.
4. The current enrollment method creates a new student master/profile from an eligible application. The repository does not expose a verified staff API to find and link a pre-existing enrolled student by a stable identity, preserve all legacy academic/guardian relationships, or adopt a pre-existing valid Permanent Student ID. A name-only match would be unsafe and could duplicate an existing student.
5. Current transfer document requirements are encoded in `public/admission-form-navigation.js` and enforced server-side. This audit found no policy document establishing that the list is mandatory transfer policy, nor a persisted transfer-specific assessment policy. Changing either behavior without an authoritative school policy would be an unsupported assumption.
6. Schema/test contracts indicate that enquiry and candidate data are stored in one `admission_applications` record, with request-id deduplication; this is not evidence of separate enquiry/candidate row duplication. Production schema/record state cannot be verified from the available local repository.
7. `healthInsuranceNumber` was not an identified canonical column in the admission schema contract. The interface can retain it in applicant JSON, but a schema/API owner must confirm its permanent canonical representation before relying on it as structured backend data.

## Changes implemented in this branch

- Reframed the leadership admission form with a clear three-category selector and category-specific fields: actual historical admission year for already-enrolled students, previous school for transfer students, and optional Health Insurance Number.
- Added client-side visibility/required-field behavior for the historical year and preserved the full form state when reopening an application.
- Carried category-specific fields in the existing application JSON record, keeping the single canonical application/enquiry entity and existing idempotency behavior; no second student/enquiry row was introduced by these UI changes.
- Added UI regression coverage for category selection, optional insurance number, persisted details, and duplicate-submit protection.

## Preserved functionality and permissions

No roles, permissions, dashboard routes, parent application gates, fee routes, document storage controls, class/academic data, student records, guardian links, or migrations were changed. The front end does not generate or display a fabricated Permanent Student ID. No destructive operation, production write, or migration apply was run.

## Verification status

- **Baseline focused suite:** PASS — 25/25 tests.
- **Post-change focused suite:** PASS — 26/26 tests, including the new category-form assertions.
- **Full regression suite (`npm test`):** FAIL — 1,387 passed / 3 failed / 1,390 total. All three failures are unrelated immutable migration checksum assertions: `test/production-migration-063-inventory.test.js` and `test/production-subject-classification-migration.test.js` disagree with the current checksum of migration 063; `test/terms-uniqueness-migration.test.js` disagrees with the current checksum of migration 060. None of those migrations or tests were changed in this branch. These existing failures block a merge under the requested release gate.
- **Migration validation:** PASS — 79 migrations discovered and valid; no migration was applied.
- **Protected assets:** PASS — 12 login assets verified.
- **Protected components:** PASS — 5 components verified.
- **Production database schema and duplicate-record inventory:** not verified; no production DB credentials were inspected or used.
- **Production deployment:** not performed; no deployment evidence is claimed.

## Release gate / Part 2 dependency

This branch does **not** claim that all admission requirements are complete or ready to merge/deploy. The release gate is blocked until a reviewed backend contract is implemented and tested for staff-only registration/migration of already-enrolled students, including duplicate resolution by stable existing identity, preserving an existing Permanent Student ID and relationships, and safely generating one only when absent. The school must also confirm transfer-document and transfer-assessment policy and the canonical Health Insurance Number persistence field. Do not merge or deploy this partial UI change as fulfillment of the complete Part 1 objective. No merge or production deployment should be represented as completed without those prerequisites and passing required checks.

## Recovery verification — 2026-10-11

The reported working path `/home/ubuntu/osaah-audit` did not exist in the current sandbox. The PR branch was recovered from GitHub into that path without rewriting history.

- Branch: `feature/admissions-part1-category-intake`
- HEAD: `8338a3d131f779718fe1b08e2c8b7ed936c82b07`
- HEAD equals `origin/feature/admissions-part1-category-intake` and PR #362 head.
- PR #362 is **OPEN**, **DRAFT**, **MERGEABLE**, with no review decision.
- At recovery, the checkout was clean and contained only the UI/category commit relative to the branch history: this audit, `public/admissions-workflow.js`, `public/admissions.html`, and `test/admissions-workflow-ui.test.js`.
- No unpushed prior-session implementation, detached worktree, migration 081, or supplemental backend patch was present in the current sandbox or fetched PR branch.

The previous-session claims of a new existing-student linking service, canonical Health Insurance Number persistence, additive migration 081, and LF/CRLF checksum compatibility are **not present in the recovered branch**:

- No migration 081 file exists; validation reports 79 migrations and the latest file is `080_restore_student_enrollment_is_current.sql`.
- No staff API/service was found that searches by stable existing identity and links an already-enrolled student without creating a duplicate. Current durable enrollment materializes a new student from an accepted application; it does not implement the requested existing-student migration path.
- No canonical health-record/database column or complete intake → validation → write → read-back path for Health Insurance Number was found. The field is currently carried in applicant JSON/UI state only.
- No verified migration-runner LF/CRLF equivalence handling was found. The runner retains exact recorded checksums; current tests still reject changed SQL.

### Verification executed

Dependencies were installed from the committed lockfile with `npm ci --ignore-scripts`; no source or dependency manifest was changed.

- Focused admissions suite: **PASS — 26 tests, 0 failures**.
- Full repository suite (`npm test`): **FAIL — 1,387 passed, 3 failed, 1,390 total**.
- `npm run migration:validate`: **PASS — 79 migrations; no migration applied**.
- `npm run assets:verify`: **PASS — 12 protected login assets**.
- `npm run protection:verify`: **PASS — 5 protected components**.

The three full-suite failures are immutable checksum assertions:

1. `test/production-migration-063-inventory.test.js`: raw SHA-256 of `schema/063_subject_classification.sql` is `6bc83d1411f4813eadd577fa4de6c43d9e979e1baca59f4222d0689456f828e7`, while the reviewed constant is `d2961b713998d7e8231de3c27c0179a005e8caa4abf79361ad76f92804dc9abb`.
2. `test/production-subject-classification-migration.test.js`: the same migration identity mismatch.
3. `test/terms-uniqueness-migration.test.js`: raw SHA-256 of `schema/059_backward_compatible_enrollment_contract.sql` is `15f26ecbd421869172219303069f4591b04dceaff405e1aba6a7b3cf99e06e48`, while the test expects `81d21b4e6e18d8d5cc4f400f918b4ebd2aec843b0301a41cd6fae3ff884adb11`.

The current migration files are ASCII text. The checksum tests confirm genuine SQL changes are rejected, and the migration-runner test confirms changed applied SQL is rejected. No expected hash was changed and no historical migration was rewritten during this audit. The root cause and any approved newline-only compatibility correction remain unresolved; changing expected hashes blindly would weaken the integrity gate.

The existing Permanent Student ID tests prove duplicate-submit idempotency, rollback, concurrent annual allocation, and historical-year handling for ordinary accepted enrollment. They do **not** prove linking an already-enrolled record or preserving all historical attendance/results/fees/enrollment relationships during such a link.

### Final recovery status

PR #362 must remain draft. Part 1 is **not complete** because the reported linking implementation and migration 081 are absent, canonical Health Insurance Number persistence is unresolved, and the full suite has three checksum failures. No production database credentials were inspected or used; no production migration, data write, merge, or deployment was performed. No commit or push was made by this audit because the required implementation is absent and the release gate is failing.
