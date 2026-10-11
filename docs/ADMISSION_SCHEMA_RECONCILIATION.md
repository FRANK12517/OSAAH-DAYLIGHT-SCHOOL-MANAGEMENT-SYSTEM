# Admission schema reconciliation — production evidence

## Evidence sources

- The read-only production migration ledger inventory completed successfully on 2026-10-11. [Workflow run #36](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38106066528) queried `schema_migrations`, `schema_baselines`, and `schema_migration_lock`; it did not issue data or schema writes. The run checked out `main` at `9c9160c` and verified release ref `b6c2038`.
- The latest read-only production schema inventory available completed on 2026-10-10. [Workflow run #55](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/38054705032) inspected production tables and selected columns. Its output includes key flags for selected columns but does not enumerate all student-domain foreign keys or indexes.
- Local candidate migration copies were compared after normalizing Windows CRLF to the LF representation used by the Linux migration runner. An applied ledger checksum is considered a source match only where it equals that normalized file checksum.

## Deployed migration ledger reconciliation

The production ledger has a primary key on `version` and records version, filename, SHA-256 checksum, and applied time. It contains the versions below. All recorded checksums match the correspondingly named migration file in the local `codex/admission-form-next-back` worktree after LF normalization.

| Version | Filename | Production checksum | Verified applied |
| ---: | --- | --- | --- |
| 050 | `050_budget_management.sql` | `85934067232d12fc848972f4d1167f8fb34f3dfa3a2a5950004f297447467337` | Yes |
| 051 | `051_income_expense_management.sql` | `96961180ba62a7b1bc3a9e720e3560ef321edb6aa71925f77fa969207e0c48cd` | Yes |
| 052 | `052_durable_auth_sessions.sql` | `5fe2615835d5feda2f8c85aff8407e0e6531182729604964a05b951a25e77d28` | Yes |
| 053 | `053_forward_production_reconciliation.sql` | `3eb82bfe9b588fdfbf0e884b8a00a7fa66b3ea279e40417df581d38c3444ec95` | Yes |
| 057 | `057_fee_obligation_custom_type.sql` | `3bf9bc3a517e7310bbf5fc3a7e456525c0c490dae1d75f9238e9dc3003a96a99` | Yes |
| 059 | `059_backward_compatible_enrollment_contract.sql` | `15f26ecbd421869172219303069f4591b04dceaff405e1aba6a7b3cf99e06e48` | Yes |
| 060 | `060_terms_academic_year_name_unique.sql` | `46a545db7f0e4af4c859dcb1780a40acb4fd7b08e5cd5b0529d15a9052fad86d` | Yes |
| 061 | `061_durable_sample_data_fixtures.sql` | `6f822be0e397723b612f0fed0b238b2bfba34b1f8d159b827b6ee2bceea9764a` | Yes |
| 062 | `062_assignments.sql` | `2b1d12358c3bb713d41f4dfbd07431d28ef5db7476daccdd2242e7ae13461d4e` | Yes |
| 063 | `063_subject_classification.sql` | `6bc83d1411f4813eadd577fa4de6c43d9e979e1baca59f4222d0689456f828e7` | Yes |
| 064 | `064_academic_result_blocking.sql` | `bc3a815e8bae941373d8acf1293d822f9eecb62762cbef12302a2d31fb97cbff` | Yes |
| 065 | `065_subject_assessment_components.sql` | `7c8fbda1f7e9fbeb4b05daa88fdbd93a8144d78906ed9ad26f5a4134fb71d8db` | Yes |
| 066 | `066_subject_class_assignments_reconciliation.sql` | `83a199d9f1590e2cf7d02b04ffc406b61784c99e51ee8ea8d3b3687056412c3c` | Yes |
| 067 | `067_academic_result_lifecycle.sql` | `7ee3424e30edbc8b48a7260343f8259e6b89da57dcdf2fd6575d6f6bfe1c655f` | Yes |
| 068 | `068_academic_score_records_foundation.sql` | `ace215c301203a755d276150802647856cb8a696e32a1f12c25b176fa2274b97` | Yes |
| 069 | `069_production_user_login_identifiers.sql` | `6cb72f77bfb41bd6573255a8005fe13acc0ba5c424b588816b8968f2055b1acc` | Yes |
| 073 | `073_subject_updated_at.sql` | `1e8bcf78ebc71f91340a17be249011be9fac47bcd8872d4f6f9364db7b50292b` | Yes |
| 074 | `074_durable_promotion_rollover.sql` | `5278fef846740971cfa95ab4bbacbaa5e30f263953574706b9aee7ff874a5940` | Yes |
| 075 | `075_result_blocking_examination_scope.sql` | `54446f29409c11314330292ec657dceaab94918dc85d854cb9d0fb6a16ff59bb` | Yes |
| 076 | `076_durable_announcements.sql` | `47d407159944ec705b067c65db26e94fb6d668fc016608267e13057a2ba453da` | Yes |

The production ledger has **no row** for versions `001–049`, `054–056`, `058`, `070–072`, or `077–081`. Absence is not proof that no effects from those SQL files exist: the schema inventory confirms some such effects are present. Versions `001–049` are represented only by 14 `schema_baselines` records, each labelled `HISTORICAL_BASELINE` with `historical_migrations_executed = 0`; their fingerprints change over time. Those records name `049_production_schema_reconciliation.sql` but do not retain its checksum. Two local source copies of migration 049 diverge (`c7525768c8dbd7d0eef582317afe8fc752837db0328b81623d8b5744a02ba06b` versus `f051d6c0b106d3b48fa0338d400754d0485a57a23020dc42a2cd16a848902526`). The deployed 049 source therefore cannot be identified from the ledger or baseline metadata.

The source map for versions 031–080 is incomplete in this feature branch: 031–078 appear in one or more sibling/recovery copies; 079–080 appear only in the admission workflow worktree; 078 also differs between that worktree and the recovery copy. These sources are supporting evidence, not proof of deployment. The source for versions 050–053, 057, 059–069, and 073–076 is identified by the matching production checksums above. No production checksum exists for the unrecorded versions.

## Admissions dependencies against production schema

| Required object or contract | Production evidence | Migration/source relationship | Result |
| --- | --- | --- | --- |
| Canonical student master | `students` exists; `permanent_student_id` is unique. The live columns do not include `full_name`, `parent_guardian_name`, or `parent_phone`. | Candidate contracts are spread across 001, 023, 028, 038, and 054; their pre-050 applied history is not recoverable from `schema_migrations`. | The enrollment INSERT no longer writes those three absent fields. Remaining student columns, nullability, indexes, and foreign keys still need disposable-database verification. |
| Student profile/master link | `student_profiles.student_master_id` exists and is unique/nullable; `student_id` is also unique. The inspected profile has `last_name`, but not `middle_name`, `surname`, `nationality`, `qr_code`, `previous_school`, `admission_type`, `updated_at`, or `permanent_student_id`. | Sibling migrations 038/054 describe the canonical relationship. Version 054 has no ledger row despite the live link column, so its application/checksum remains unverified. | The profile INSERT now uses `last_name` and omits the reported-absent columns. Remaining profile constraints and canonical relationship indexes still need disposable-database verification. |
| Student enrollment | Production has `student_enrollments` with `id`, `student_id`, `class_id`, `academic_year_id`, `school_id`, and `term_id`. The inspected columns omit `enrollment_status`, `is_current`, and `enrolled_at`. | Version 059 is recorded and checksum-matched. Version 080, which restores `is_current`, has no ledger row; the column is absent from the inventory. | The enrollment INSERT now uses only the six inspected columns. Constraints and transactional behavior remain unverified. |
| Permanent-ID sequence | `student_id_sequences` is present in the production table inventory, but the schema inventory did not report its columns or indexes. Version 027 is not in the migration ledger. | Candidate 027 defines the annual sequence; service needs `admission_year`, `next_sequence`, and `updated_at` and locks the row with `FOR UPDATE`. | The available production evidence cannot verify the allocator contract. The service probes it on each enrollment and blocks if columns, transactional engine, or the single-column year primary key do not match. |
| Durable admission application | Production has `admission_applications` with `application_number`, `stage`, `applicant_data`, optional student/permanent-ID references, and parent details. Its `student_id` is not marked unique in the inspected column inventory. The production inventory does not list `admission_form_applications`. | Version 078 (idempotency fields and uniqueness indexes) has no ledger row; `enquiry_request_id` is absent. The tracked public form service instead stores submissions in a process-local `Map`; migration 015 describes a different `admission_form_applications` model. | No verified public-form-to-durable-application adapter or retry-safe contract exists. |
| Admission migration audit | The production inventory contains neither `admission_migration_batches` nor `admission_migration_items`. | Migration 081 creates these audit tables and is the only such migration in this feature branch. Its comment places it after 001–080. | Migration 081 is not applied and must remain pending. |

The schema inventory reported key flags for selected columns, but it did not return full table definitions, the `student_id_sequences` indexes, or the full student-domain foreign-key/index inventory. The enrollment service now checks `student_id_sequences` at runtime for the candidate 027 column contract, transactional engine, and unique `admission_year` primary key; it fails closed on any mismatch. This runtime check is not evidence that production currently matches. No SQL compatibility, transaction, rollback, concurrency, retry, or audit-write test ran against production or a disposable TiDB-compatible database. The ledger read was a production metadata-only inventory, not an exercise of the admission services.

## Ordering and release decision

`src/platform/migration-runner.js` sorts discovered migrations numerically and rejects duplicate versions/checksum changes, but it does not require contiguous versions. In this branch, the tracked schema stops at 030 and contains 081. Migration 081 now requires an adapter-provided `verifyMigrationPrerequisites` check and refuses to run if that capability is missing, throws, or reports an unexpected schema. No repository database adapter currently implements that check, so 081 remains blocked. Do not apply it until the exact migration history and prerequisite contract are restored and validated from a clean disposable schema.

Keep `OSAAH_ENABLE_DURABLE_ADMISSIONS` disabled. Do not merge, deploy, or apply migrations while the full migration history, remaining service-to-schema constraints, and real transaction/locking behavior are unverified. The public workflow remains in-memory and separate from authorized staff routes; public applicants do not receive permanent IDs or migration execution access. Staff acceptance may create students through the existing path, but it is not a transactional mapping from the public form record to the legacy durable application record.

No local disposable MySQL/TiDB service, Docker executable, or admission database integration test configuration is available in this checkout. The production inventory connection was used only for the approved read-only workflow. No production preview or student write was run.

## Targeted reconciliation code and verification

- `src/admission-enrollment.js` removes the explicitly absent student/profile/enrollment columns from its inserts and uses the inspected profile `last_name` field.
- Permanent-ID allocation checks the live sequence table engine, exact candidate 027 columns, and its `admission_year` primary-key index inside the transaction; mismatches stop enrollment before allocation.
- The migration runner refuses version 081 without explicit adapter prerequisite verification; tests cover an absent verifier, a negative result, and a positive result.
- No Docker or Podman executable, isolated database CI service, or project-supported disposable TiDB/MySQL integration setup was available in this checkout. The service SQL and concurrency behavior therefore remain unverified against a real database.
- Focused admission/enrollment/migration/permanent-ID tests after these changes: 33/33 passed. `npm run migration:validate` passed (30 tracked migrations). `npm run assets:verify` passed (12 assets).
- The maintained test set run with `node --test --test-force-exit` over `test/*.test.js`: 464 passed, 44 failed. Most failures are loopback HTTP cases returning `EACCES` under this workspace sandbox; the non-loopback failures include the mock-score permission assertion in the modified `test/foundation.test.js` and teacher-scope assertion in the modified `src/academic-results.js`/`test/transcripts.test.js`. This run does not establish a fully passing regression suite.

## Tests already run for the committed admission changes

- Focused admission, enrollment, authorization, migration, and permanent-ID tests: 27/27 passed.
- `npm run migration:validate`: passed with 30 tracked migration files.
- `npm run assets:verify`: passed with 12 protected login assets.
- Maintained test suite: 503/505 passed. The two failures are Mock Score Entry permission navigation (`test/foundation.test.js`) and teacher assignment scope (`test/transcripts.test.js` / dirty `src/academic-results.js`).

These unit checks do not establish SQL compatibility or runtime safety against the production schema.
