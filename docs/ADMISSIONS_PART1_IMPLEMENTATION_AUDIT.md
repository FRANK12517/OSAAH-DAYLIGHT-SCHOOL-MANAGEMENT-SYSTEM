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
