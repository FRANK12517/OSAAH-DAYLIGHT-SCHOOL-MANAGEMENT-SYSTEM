# Part 1 Handoff — Subject Configuration and Architecture Audit

**Audit date:** 2026-10-03 (UTC)  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Audited base revision:** `5e1a8cf5f7dd594304816afd23baf9a4850948c1` (`main`)  
**Audit branch:** `audit/part1-subject-configuration-handoff-2026-10-03`  
**Scope:** Audit and handoff only; no application source or schema changes and no production database writes.

## Executive summary

The selected `main` revision already contains the subject-configuration implementation from [PR #267](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/267), merged at `139e5c6bb78328bd992a1d7fb138f2b3deabb603`, and the Part 2 grading/aggregate implementation from [PR #270](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/270), merged at the audited base revision. Rebuilding those features would duplicate recent work and risk breaking existing flows. This branch therefore records the audit and blockers rather than reimplementing existing modules.

The repository has a TiDB-backed subject and score path when its database adapter is configured, with server-side permission, school/class scope, year/term validation, score bounds, and subject-assignment checks. However, **Part 1 is not production-certified**: the protected migration chain is blocked (064's dry-run requires Migration 063, and 065's dry-run requires verified 064); published result configuration is not snapshotted with marks; and result save/publication/broadsheet paths still use the process-local academic-results service rather than the durable score rows. No migration or deployment was attempted in this audit.

## Existing implementation map

| Area | Existing implementation to reuse | Audit result / qualification |
|---|---|---|
| Subject registry and configuration | `src/durable-academic.js`; `src/default-subject-catalog.js`; `/api/subjects` endpoints in `src/server.mjs` | With TiDB configured, subject list/create/update/deactivate, defaults and class assignments use server-side SQL. The non-database `src/subjects.js` service remains a memory fallback for local/demo use. `/api/subjects/configure-defaults` fails closed with 503 if durable storage is absent. |
| Academic levels and classes | `src/default-subject-catalog.js` (`canonicalAcademicClass`, `academicLevelForClass`); `src/students.js`; durable `classes` table queries | Handles Nursery 1–2, KG 1–2, Primary/Basic 1–6, and JHS 1–3 through canonical aliases. Preserve existing IDs/labels rather than adding duplicate class rows. |
| Academic year and term | `academic_years`, `terms`; `durable-academic.js` `options()` / `resolvePeriod()` | The durable service resolves and validates year/term ownership server-side. Production rows and migration state still require protected verification. |
| Class-subject assignments | Existing `subject_class_assignments` and compatibility reads of legacy `class_subjects`; durable `assignSubject()`, `deactivateSubjectAssignment()`, `subjectCascade()` | Effective-year assignment overrides and a configuration-version field exist. Teacher-to-subject register entries in `src/subject-register.js` are a separate concern and are currently process-local; do not treat them as the durable class-subject mapping. |
| Subject defaults/classification | `src/default-subject-catalog.js`; `configureDefaultSubjects()`; migrations `063_subject_classification.sql` and `065_subject_assessment_components.sql` | Defaults include core/elective/non-scoring classifications, mandatory and optional labels, version 1 and component labels; setup is tested for repeat-safe behavior and preservation of Nursery assignments. `maximumMarks` is currently supplied by the code catalog (100) rather than stored as a general per-subject DB value for custom configurations. |
| Terminal Score Entry | `durable-academic.js` `roster()` / `saveScore()`; `/api/academic/score-entry/roster` and `/api/academic/scores` | The durable writer validates CA and exam to 0–50, checks enrollment, term/class scope and scoring assignment, calculates grade on the server, then writes `academic_score_records`. The repository handoff `docs/SCORE_ENTRY_PERSISTENCE_HANDOFF.md` confirms this is the active writer; migration 055's `canonical_academic_scores` is not used by that writer. |
| Mock Score Entry | `durable-academic.js` `mockRoster()` / `saveMockScore()`; `/api/academic/mock-scores` | DB-backed write path validates JHS eligibility and 0–100 total-only input. Mock and terminal flows remain distinct. |
| Grading and aggregate calculations | `src/grading.js`; `src/result-calculation.js`; Part 2 changes in PR #270 | Calculation code is server-side and the regression suite covers grade/aggregate/position contracts. |
| Result slips, PDF and branding | `src/academic-results.js`; `src/result-slip.js`; `src/result-slip-pdf.js`; `public/result-view.js`, `public/mock-result-view.js`, `public/result-pdf.js`; existing logo/watermark assets | Existing layout, school branding/watermark and dual-border PDF treatment are preserved by the current implementation and regression checks. No visual replacement was made. |
| Mock results and broadsheets | `src/academic-results.js`; `/api/academic/mock-result`, `/api/academic/mock-broadsheet`; `src/reporting.js` | Existing interfaces are reused, but result/broadsheet reads are not wired to the durable score rows in the database-backed route path (see blockers). |
| Sample-data isolation | `src/sample-result-workflow.js`; `src/sample-fixture-repository.js`; `src/students.js` | Explicit test-record flags and sample identities are present; sample publication and ranking isolation have regression coverage. |
| Authentication, roles and audit | `src/auth.js`; `canAccess()`; route-level `subjects.manage`, `marks.write`, result/mock permissions; `createAuditLog()` | Permission checks are server-side and use the existing role permission sets. Do not collapse Proprietor, School Admin, Headteacher, Assistant Headteacher, Examination Officer, and other roles into one assumed grant. Subject mutations record audit events at route level. |
| Migration history | `schema/063_subject_classification.sql`, `064_academic_result_blocking.sql`, `065_subject_assessment_components.sql`; protected workflow scripts | 065 is additive/idempotent for TiDB's supported `ADD COLUMN IF NOT EXISTS` syntax. Production status is not equivalent to the files being present in the repository; see exact gate evidence below. |

## Findings requiring resolution before claiming full completion

### 1. Production migration chain is blocked

Protected, read-only workflow evidence establishes the following sequence:

1. Production Migration 064 dry-run [run #36949671467](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36949671467) reported a baseline at `049_production_schema_reconciliation.sql`, 9 applied ledger entries, 7 pending entries and 47 historical untracked migrations. The 064 preflight then failed with `MIGRATION_PREDECESSOR_MISSING`: **Migration 063 is not recorded as applied**.
2. Later Migration 065 dry-run [run #37080408659](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/37080408659) failed with `MIGRATION_065_PREDECESSOR_NOT_VERIFIED`: **Migration 064 has no verified ledger entry** (`ledger: null`). Apply and post-apply verification were skipped.

This is a dependency/ledger reconciliation issue, not permission to skip a migration. No database status can be inferred from local files alone. Do not manually add ledger rows, bypass predecessor validation, run the generic all-pending migration command, or modify the existing migration files. The current production subject-assessment schema dependency must be resolved through the established protected workflow and review process.

### 2. Historical result reproducibility is not yet guaranteed

The assignment rows carry `configuration_version`, and deactivation paths preserve score records rather than deleting them. But the durable score row stores subject/year/term identifiers, marks, grade and remark; it does not snapshot the subject's display name/code, classification, scoring flag, maximum marks, assessment components, or grading configuration at result publication time. Subject updates also mutate the current subject record. Assignment version metadata by itself is not a full immutable published-result snapshot or an authorized correction workflow. Therefore historical reproducibility should not be described as complete until the published result captures the applicable configuration and corrections are explicitly versioned/authorized.

### 3. Durable score writes and result reads/publication are split

The database-backed `/api/academic/scores` POST and mock-score POST use `durableAcademic.saveScore()` / `saveMockScore()`. In contrast, the `/api/academic/scores` GET route returns an empty list when `durableAcademic` is active, and `/api/academic/results/save`, `/api/academic/results/publish`, parent result reads, and mock-result/broadsheet reads still call the in-memory `academicResults` service. That service is useful for the existing demo/test workflow, but it is not a durable result system for scores written to TiDB. Reconcile the read, calculation, save, publication and broadsheet paths before claiming durable production result generation.

### 4. Configuration fields and constraints

- The standard catalog's mark maximum is currently represented in code (100); there is no general durable per-subject `maximum_marks` column in migration 065. If per-subject configurable maxima are required, agree and migrate that contract additively before enabling it.
- Application checks and deterministic IDs reduce duplicate creation, but production uniqueness and idempotence must be verified against the actual schema after the protected migration ledger is reconciled.
- Migration 063's SQL is an additive `ALTER TABLE` but does not use `IF NOT EXISTS`; do not blindly rerun it. Use the approved metadata preflight to reconcile physical columns with the migration ledger first.

## Tests and production verification

- Focused subject/academic/mock/result/migration regression selection: **37 passed, 0 failed**.
- Full repository test suite on audited `main`: **1,096 passed, 0 failed** (about 24 seconds).
- `npm run migration:validate` locally: **valid; 64 migration files discovered**. This is local-file validation only and says nothing about production ledger state.
- Production site root request: **HTTP 200** at `https://www.osaahdaylightschool.online/` during this audit. This is a basic availability check, not authenticated API, database, schema, or deployed-revision verification.
- Vercel deployment lookup could not be authorized for the connected `frank12517s-projects` scope (403). Consequently, **production deployment ID and deployed SHA were not verified**. No Vercel token or database secret was exposed or sought.
- Production migration execution: **not performed**; all migration evidence cited above is dry-run/preflight failure evidence.

## Release and change record for this audit
- Starting code revision: `5e1a8cf5f7dd594304816afd23baf9a4850948c1`.
- Part 1 implementation already present: PR #267, merged; merge commit `139e5c6bb78328bd992a1d7fb138f2b3deabb603`.
- Part 2 implementation already present: PR #270, merged; merge commit `5e1a8cf5f7dd594304816afd23baf9a4850948c1`.
- Changes made on this audit branch: this handoff report only; no schema, source, or production data changes.
- Handoff PR #271: https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/271 (the PR head is the authoritative audit-report revision).
- Merge status of the audit PR: pending normal checks/review; not merged by this audit.
- Production deployment status for this audit: none requested or performed.

## Continuation prerequisites

The repository has already advanced beyond Part 1 and Part 2 on `main`. Do not recreate either part. Before the next continuation modifies or deploys academic result behavior:

1. Have the authorized production owner reconcile the physical state and truthful ledger for migrations 063 and 064 through protected read-only inventory. Resolve the missing 063 ledger entry without fabricating history, using the existing approved baseline/recovery procedure.
2. Re-run the protected 064 dry-run against the exact approved `main` SHA. Apply 064 only if its physical-state/predecessor preflight, backup confirmation, exact apply token and protected environment review succeed.
3. After 064 verifies, re-run the protected 065 dry-run and only apply via its documented exact-SHA/checksum/backup/reviewer gate if it passes. Confirm the expected columns and unchanged academic record counts before deploying code that requires them.
4. Design and test the immutable result configuration snapshot and authorized correction/version flow; include test coverage for historical result display after later subject rename, deactivation, reclassification or maximum-mark changes.
5. Reconcile durable score reads, result generation/publication, result-slip/PDF data, mock results and broadsheets with the actual production score table (`academic_score_records` per current writer), preserving existing GES assessment, both result-slip designs, borders, branding, watermark and signatures.
6. Decide whether subject maximum marks are fixed at 100 or administratively configurable, and enforce that same contract in server validation, grading, persistence and result rendering.
7. Verify the production deployment SHA/ID and authenticated academic API/DB health through an authorized Vercel scope and the approved production test process. An HTTP 200 homepage alone is insufficient.

**Stop point:** This handoff completes the audit/reporting scope. No Part 3 or further implementation was started.
