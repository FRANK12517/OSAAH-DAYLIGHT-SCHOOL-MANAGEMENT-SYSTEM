# Part 2 — Subject Configuration and Result Calculations

**Date:** 2026-10-03

**Branch:** `codex/part2-nursery-kg-lower-primary`  
**Base revision:** `5e1a8cf5f7dd594304816afd23baf9a4850948c1` (PR #270 merged to `main`)
**Implementation commit:** `a74d2f8110b4c30e6229d60771907a6d8da27a69`
**Pull request:** [Draft PR #272](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/pull/272)
**Release status:** implementation prepared for review; production release is blocked by the protected migration chain and the existing TiDB-score/in-memory-result integration gap.

## Nursery 1–2: approval pending

The existing eight-subject catalog remains present as a **provisional catalog only**. It is not represented as the school-approved Nursery curriculum. TiDB default configuration continues to skip Nursery 1 and 2: it creates no Nursery defaults or assignments, restores none, and leaves their current registered subjects and assignment rows unchanged. Nursery configuration remains editable through the existing subject-management authorization (`subjects.manage`). The durable configuration response reports `nurseryCurriculumApproval: PENDING`.

No subjects, assignments, scores, or historical results were deleted. The implementation does not enforce the provisional eight items as mandatory. School curriculum approval remains **PENDING**.

## KG 1–2

KG uses exactly four scoring parent subjects: **Language and Literacy**, **Numeracy**, **Our World, Our People**, and **Creative Arts**. Each parent is worth at most 100 marks; the existing terminal entry contract caps Class Assessment at 50 and Examination at 50, and the server no longer trusts client-supplied maxima to raise those limits. KG result totals are out of 400; the server exposes a percentage only when all four parent subjects have submitted scores. For 355/400, the calculated percentage is 88.75%. KG does not receive a Best Six aggregate. Its class position is calculated from the actual result totals, with equal totals sharing the same rank.

Component labels persist as metadata on their parent subjects and are not separate 100-mark subjects or aggregate candidates:

| Parent subject | Assessment components |
| --- | --- |
| Language and Literacy | Phonics and Word Building; Oral Language and Listening; Pre-Writing and Penmanship |
| Numeracy | Number Operations; Geometry and Spatial Awareness; Data and Sorting |
| Our World, Our People | Personal and Social Development; Ghanaian Values and Science |
| Creative Arts | Visual Arts; Performing Arts and Movement |

The TiDB defaults operation refreshes those component labels on existing KG parent rows when needed; it does not alter score or result records.

## Lower Primary 1–3

Defaults retain the four mandatory core subjects—English Language, Mathematics, Science, and History—plus Religious and Moral Education, Creative Arts, and Ghanaian Language (Fantse) as scoring electives. Physical Education remains visible in subject configuration as **NON_SCORING**, but is excluded from Score Entry's scoring cascade and the aggregate.

The Best Six aggregate is the sum of the four core grade points plus the best two grade points among active, scoring electives assigned to that class. It is incomplete unless all four core results and at least two eligible elective results exist. Other authorized, active, scoring electives remain eligible without changing the core.

The existing Primary grading scale is retained, including the gap at Grade 7: Grade 1 80–100; 2 70–79; 3 60–69; 4 55–59; 5 50–54; 6 40–49; 8 35–39; 9 0–34. Decimal marks are evaluated using the same inclusive lower-bound thresholds.

## Deterministic tie policy

Electives are selected by **grade points first** (lower grade-point number is better). Only when grade points are equal does a higher raw mark win. Exact ties are resolved by normalized subject name, then canonical subject ID. Thus raw marks do not overtake a better grade point. Class positions use KG raw totals; Primary/JHS aggregate ranking uses aggregate points and the existing selected-six/core tie-break fields, with identical ranking keys sharing a position.

## Persistence, cascade, and presentation

Default subjects and class assignments continue to use the existing TiDB-backed subject registry. Default assignments remain academic-year-neutral, while class/year overrides are resolved by the server for the selected academic year and term; the three academic terms and future years are covered by regression tests. Existing active class assignments remain in the class-specific cascade, rather than falling back to a global subject list.

The result service now returns the KG percentage to the browser and PDF renderers. The existing Examination Result Slip, GES Assessment, attendance/signature content, watermark, and two-border design are retained; the percentage is an additional summary item only when available. Broadsheet result data also includes the calculated percentage. No application schema migration was added in this branch.

**Existing production data-plane gap:** in `src/server.mjs`, terminal score POSTs use `durableAcademic.saveScore()` when TiDB is configured, while result slip, result PDF, broadsheet, and parent-result routes still call the in-memory `academicResults` service. `createApp()` also defaults its student and subject registries to in-memory services. Therefore this branch's server-side calculations and regressions prove the calculation contract, but do **not** prove that production TiDB score rows feed Result Slip, broadsheet, or parent views, or that those screens use the TiDB class-subject cascade. Closing this safely requires joining the durable student/profile identity to score/result rows while preserving GES assessment, publication lifecycle, and historical-result correction rules. That broader integration was not changed here; it is a release blocker and must not be represented as completed.

## Validation

- Final focused subject, result-calculation, route-adjacent, and durable-academic suite passed: **46/46**.
- Final full repository suite after the fixed-cap and Nursery-status assertions: **1,100 passed, 0 failed**.
- Protected schema files are unchanged; `git diff --check` passed.
- Tests verify KG four-parent totals and percent, missing/incomplete percentage, actual KG class ranking, subject/component caps, lower-primary score boundaries, non-scoring PE exclusion, deterministic ties, preservation/editability of Nursery registration, and TiDB cascades over all three terms and a future year.

## Production gate and deployment status

Production was **not** modified, merged, or redeployed by this implementation. Preflight evidence recorded the following:

- Main revision `5e1a8cf5f7dd594304816afd23baf9a4850948c1` had GitHub production deployment record [#6821363447](https://api.github.com/repos/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/deployments/6821363447/statuses) marked `success`; the public homepage returned HTTP 200. This verifies availability for the pre-existing revision, not database schema health.
- Protected Migration 064 run [#36949671467](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/36949671467) failed with `MIGRATION_PREDECESSOR_MISSING` because Migration 063 was not verified in the ledger.
- Protected Migration 065 run [#37080408659](https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM/actions/runs/37080408659) failed with `MIGRATION_065_PREDECESSOR_NOT_VERIFIED` while Migration 064's ledger state was null.
- The TiDB score-write versus in-memory result-read split described above is a separate functional release blocker for persisted scores and reports.

Do **not** bypass or manually alter the production ledger. The migration chain must be reconciled through the protected workflow and the database owner before production deployment. Until then, the report and source changes remain in the review branch/PR; this document does not claim the new behavior is live.

## Follow-up required

1. Complete and validate a durable result/broadsheet integration that reads TiDB score records and preserves GES assessment, publication, historical corrections, and class-scoped subjects.
2. Reconcile Migrations 063–065 through the protected workflow and verify their ledger status; do not bypass the gate or write directly to production.
3. Review and merge the implementation PR only after required checks and repository approvals are satisfied and both production prerequisites above are resolved.
4. Run the protected deployment through its normal gate; then verify the deployed SHA and authenticated DB-backed score/result/cascade paths, not only the public homepage.
5. Obtain and record school approval of the Nursery 1–2 curriculum before any later change makes the provisional catalog an automatic default.
