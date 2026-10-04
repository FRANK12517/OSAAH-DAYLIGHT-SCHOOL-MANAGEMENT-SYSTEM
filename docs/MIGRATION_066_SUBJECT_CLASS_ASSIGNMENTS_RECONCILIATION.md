# Migration 066 — Subject/Class Assignment Reconciliation

## Status

**Prepared for review only. Not applied to production.**

The protected Migration 065 dry-run reported `MIGRATION_065_PREREQUISITE_MISSING` because production lacks `subject_class_assignments`. The repository’s active durable academic service expects that normalized table but already retains a compatibility fallback to the legacy `class_subjects` mapping.

## Root cause

The historical Migration 017 definition contains `subject_class_assignments`, but it is SQLite-oriented (`TEXT` identifiers, `PRAGMA foreign_keys`) and is not safe to replay wholesale against the production TiDB-compatible schema. Production must be inspected first for actual identifier types, tenant columns, indexes, foreign keys, legacy relationships, and data consistency.

## Verified application contract

The durable service expects:

- `school_id` tenant scope;
- canonical `subject_id` and `class_id` references;
- nullable `academic_year_id` for default assignments;
- `active` state;
- `configuration_version`, `created_at`, and `updated_at`;
- school/class/year lookup behavior;
- duplicate prevention within a school and academic context.

`academic_score_records` remains the authoritative durable score store. This reconciliation does not create or use `canonical_academic_scores`, does not touch `academic_result_records`, and does not modify result signatures or financial records.

## Proposed Migration 066

`schema/066_subject_class_assignments_reconciliation.sql` is forward-only and additive:

1. Creates `subject_class_assignments` only if absent.
2. Uses `VARCHAR` identifiers compatible with the production contract.
3. Adds primary, unique, lookup, and foreign-key constraints.
4. Copies legacy `class_subjects` relationships only when:
   - class and subject rows exist;
   - class and subject belong to the same school;
   - the normalized relationship is not already present.
5. Uses a deterministic SHA-256-derived ID for retry-safe legacy-row copying.
6. Never drops, updates, deletes, or overwrites existing records.

The migration runner refuses to proceed if the legacy mapping has orphan rows, cross-school relationships, duplicates, missing prerequisites, or an already-present normalized table without a matching ledger decision.

## Protected preflight

`.github/workflows/production-subject-class-assignments-reconciliation.yml` is `workflow_dispatch`-only and uses the protected `Production` environment. The default `DRY_RUN_ONLY` path verifies, without production writes:

- database identity `osaahdaylightschool`;
- Migration 063 and 064 file/ledger checksums;
- metadata ledger and baseline;
- classes, subjects, academic years, and legacy `class_subjects` presence;
- required columns, indexes, and foreign-key metadata;
- subject/class counts;
- orphan, cross-school, and duplicate legacy relationships;
- absence of `subject_class_assignments`;
- the proposed reconciliation state.

Backup/recovery readiness remains an explicit operator prerequisite before any apply. The apply path additionally requires the exact token `APPLY_SUBJECT_CLASS_ASSIGNMENTS_066` and `BACKUP_CONFIRMED`.

## Production data preservation

No production database credential was used locally. No production SQL was executed. The proposed SQL contains no destructive statements and preserves existing subject IDs and legacy mappings. Production preservation evidence remains pending the protected read-only preflight.

## Approval boundary

Before any production schema change, separately approve:

1. the dedicated PR;
2. the protected `DRY_RUN_ONLY` preflight result;
3. a recent recoverable backup;
4. the exact Migration 066 apply SHA and token;
5. the subsequent, separately authorized Migration 065 apply.

This branch and PR must remain unmerged until those approvals are complete.
