# Admissions Part 3 implementation and takeover audit

**Audit date:** 2026-10-11
**Scope:** Existing OSAAH student identity linking and `ALREADY_ENROLLED` admission safeguards. This audit does not certify production schema state or authorize deployment.

## Recovery and baseline

The active sandbox did not contain the prior checkout, so the selected GitHub repository was cloned into a fresh workspace. The recovered `origin/main` and Part 3 branch base were clean at `e50cc000bfc3e0e12987e62d088cfe35a967e0d6` (`feat(admissions): add safe existing-student ID generation (#363)`). Any uncommitted edits from the unavailable earlier workspace could not be recovered. The prior `docs/ADMISSIONS_PART2_IMPLEMENTATION_AUDIT.md` was reviewed; no separate Part 3 baseline report or recoverable admissions Part 3 branch, commit, or PR was found. PRs [#362](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/362) and [#363](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/363) are merged. The latest Vercel production deployment was `READY` and points to the same `e50cc000bfc3e0e12987e62d088cfe35a967e0d6` revision. Work is isolated on `fix/admissions-part3-existing-student-workflow` because no matching Part 3 admissions branch or PR was available to update.

## Implementation

A school-scoped, read-only identity preview now precedes an explicit authorized-staff confirmation. Matching requires a canonical record ID, Permanent Student ID (including a profile-held ID), admission number, or the complete first name, last name, and date of birth. Ambiguous, inconsistent, malformed, or unresolved identities fail closed for manual review. The browser displays no match as imported and does not create unmatched legacy records.

Linking preserves valid master/profile identifiers and existing profile, parent, class-history, and enrollment relationships. It reuses a matching enrollment, rejects a conflicting or multiply active enrollment for controlled review, treats blank legacy identifiers as unassigned, and allocates a new Permanent Student ID only after confirmation and a supplied historical OSAAH admission year. Application attachment is school-scoped and requires matching identity and consistent prior link fields.

The admissions UI separates existing-student linking from new-applicant intake, which remains available for transfer and first-time applicants. Server-side service guards block `ALREADY_ENROLLED` applications from submission into document review, document upload/review, assessment, decision, offer acceptance, reclassification, and new-student enrollment. The enrollment service returns an already linked canonical student without creating a second student or ID, and rejects an unlinked record. No production database, student record, deployment, or production migration ledger was modified.

## Verification

| Check | Result |
|---|---|
| Full project suite (`npm test`) with disposable MySQL integration enabled | 1,407 passed; 0 failed; 0 skipped |
| Real database integration | Passed on local MySQL 8.0.46 through the repository's MySQL adapter and transaction implementation |
| Integration cases | Identity matching/ambiguity, school and role scoping, explicit confirmation, parent/class/enrollment preservation, profile-held and blank IDs, rollback, idempotent/concurrent retries, `ALREADY_ENROLLED` guards, and transfer/first-time canonical student, profile, enrollment, and parent-link materialization |
| Migration validation | `valid: true`; 80 local migration files discovered. This was offline file validation, not a production ledger check. |
| Protected asset verification | Passed; 12 protected assets |
| Protected component verification | Passed; 5 components |
| Syntax and whitespace | Changed JavaScript files passed `node --check`; `git diff --check` passed |

The MySQL test creates a uniquely named disposable schema, applies the repository's `027_student_id_sequences.sql` migration, and drops only that schema in cleanup. It does not claim that the complete production schema was recreated or that production migrations were applied.

## Production schema and approval blockers

The prior Part 2 audit and supplied handoff identify these facts as unresolved. The protected Production approval gate was not bypassed to access or modify the production database:

1. Whether the production migration ledger includes migrations 077–081.
2. Whether production `students` contains `health_insurance_number`.
3. Whether production has `student_id_sequences`.

Do not replay migrations, fabricate ledger entries, or treat the deployed `e50cc...` application revision as database certification. Resolve these through the authorized read-only production-schema evidence workflow and its required approval before making production schema or linking claims. No Part 3 production smoke test was run because this change was not deployed.

## Independent review

The authenticated GitHub account and only visible repository collaborator were `FRANK12517`, the owner and PR author. There was no other authorized repository collaborator to request as an independent reviewer. The PR must remain open until an independent authorized reviewer is added and completes review; the author cannot approve their own change.
