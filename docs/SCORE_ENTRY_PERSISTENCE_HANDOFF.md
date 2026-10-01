# Score Entry persistence handoff

**Verification date:** 2026-10-01

## Verified repository writer

The durable Score Entry service is implemented in `src/durable-academic.js`. Its `saveScore()` method reads and updates **`academic_score_records`**. The insert path writes terminal records with `ca_score`, `examination_score`, `total_score`, `grade`, `remark`, `entered_by`, and the academic year, term, class, student-profile, and subject identifiers.

The read path in `roster()` also joins **`academic_score_records`** to return `caScore`, `examScore`, `totalScore`, `grade`, and the saved-state flag. Therefore, based on the current application code, the active durable writer is **not** `canonical_academic_scores`.

## Canonical-table discrepancy

Migration `schema/055_canonical_academic_scores.sql` defines **`canonical_academic_scores`** as a newer forward-only table for Score Entry, Result Slips, broadsheets, and ranking. The current durable writer does not reference that table; it continues to use `academic_score_records`, which is defined by the older academic-results migration. No automatic backfill or destructive reconciliation should be inferred from either schema file.

## Production evidence status

The latest successful protected targeted inventory (GitHub Actions run `36720084109`, 2026-09-30) authenticated to the expected `osaahdaylightschool` database and completed read-only metadata queries, but the previous inventory target list did not include either score table. It therefore cannot establish which table exists or contains production rows.

This change extends the protected inventory target list to include `academic_score_records`, `canonical_academic_scores`, and `result_signatures`. After this change reaches `main`, dispatch the protected workflow again and inspect `tableInventory`, `columns`, `indexes`, and `absentTargetObjects`. The inventory remains metadata-only: it queries no business rows and performs no writes.

## Release decision

Keep the application writer unchanged until the protected inventory confirms production state and a reviewed migration/reconciliation plan is approved. The safe current conclusion is:

> **Application code currently writes `academic_score_records`; production table presence and row ownership remain unverified until the expanded protected inventory succeeds.**
