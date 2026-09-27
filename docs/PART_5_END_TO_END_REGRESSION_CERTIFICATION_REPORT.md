# OSAAH Daylight School Management System
## Part 5 — End-to-End Regression and Production Certification

**Certification date:** 2026-09-27  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Certification commit:** `525f36798f55294932862f6d11c81b9679c5bf72` before this report commit  
**Production domain:** https://www.osaahdaylightschool.online

## Final status

| Area | Status | Evidence |
|---|---|---|
| Canonical admission → Permanent Student ID → enrollment → attendance → scores → results → result slip → broadsheet → promotion flow | PASS | 820 deterministic repository tests, including permanent-ID, enrollment, attendance, scoring, result, broadsheet, and promotion coverage |
| Attendance context and scoped register | PASS | Focused attendance and tenant-scope tests passed |
| Score Entry academic options and roster | PASS | Academic-options, subject, roster, fallback, persistence, and UI regression tests passed |
| Result Slip context, identity, borders, and PDF | PASS | Result Slip context, double-border, identity, rendering, and PDF tests passed |
| Sample isolation | PASS | Sample ranking, attendance, publication, communications, promotion, and production-data guard tests passed |
| Nursery through JHS 3 class coverage | PASS | Canonical 13-class catalog and class-database tests passed |
| Error paths and school isolation | PASS | RBAC, cross-school, unauthorized, empty-state, and invalid-context tests passed |
| Migration validation | PASS | 55 ordered migrations validated |
| Asset validation | PASS | 12 protected login assets verified |
| Complete deterministic test suite | PASS | 820 passed, 0 failed |
| Public production homepage | PASS | HTTPS `200` from `https://www.osaahdaylightschool.online/` |
| Unauthenticated production session API | PASS | HTTPS `401` with `Authentication required.` |
| Unauthenticated Fee Setup API | PASS | HTTPS `401` with `Authentication required.` |
| Authenticated production UI QA | BLOCKED | No authorized production account/session was available in this sandbox |
| Production database connectivity/schema verification | BLOCKED | No protected production database credential was available in this sandbox |
| Production PDF download through authenticated UI | NOT TESTED | Requires an authorized production session |

## 1. Root cause of “Unable to load academic options”

The durable academic service assumed the normalized schema in which classes are reached through `levels.level_id` and subjects through `subject_class_assignments`. The production-compatible database contract uses tenant-scoped `classes.school_id`, `classes.level`, `classes.sort_order`, and, on older installations, the authoritative `class_subjects` mapping. The repair now queries the canonical production classes table first and falls back to the normalized/legacy contracts only for schema-compatibility errors. Academic years and terms are loaded from the authenticated school context, and the UI renders real academic-year and term options instead of hard-coded values.

## 2. Files changed for this certification

- `docs/PART_5_END_TO_END_REGRESSION_CERTIFICATION_REPORT.md` — this report.
- The application fixes under certification were already present on `main` before this report: `public/examinations.html`, `public/score-entry.js`, `src/durable-academic.js`, and their regression tests.

No additional application feature was added in Part 5.

## 3. Database/schema changes

**None in this certification.** Repository migration validation passed for 55 migrations. No production migration was applied, and no production data was modified.

## 4. Sample-data architecture and count

Sample students are pre-existing, reserved test records identified by `isTestRecord` and permanent sample IDs. Sample workflows use the same academic result engine but remain explicitly classified and cohort-scoped. They are excluded from real enrollment totals, real rankings, production communications, and production data-guard projections. The repository’s sample workflow tests cover the configured sample cohort across the canonical classes; the exact live production count is **NOT TESTED** because authenticated production database access was unavailable.

## 5. Functional verification

- **Score Entry:** PASS — academic year, term, class, subject, roster loading, real-student precedence, sample fallback, save, reload, and school scope passed automated verification.
- **Attendance:** PASS — class/year/term/date filtering, correct historical enrollment, register loading, duplicate protection, correction, sync, and school scope passed automated verification.
- **Result Slip:** PASS — class/student context, Permanent Student ID, result generation, sample and real paths, single active double-line border, signatures, and print contracts passed automated verification.
- **PDF:** PASS — server PDF generation and protected export routes passed automated verification. Authenticated production download is **NOT TESTED**.

## 6. GitHub and deployment record

| Item | Status / value |
|---|---|
| Main baseline | `525f36798f55294932862f6d11c81b9679c5bf72` |
| Existing merged repairs | Attendance, Score Entry academic options, sample students, and Result Slip context repairs are already merged into `main` |
| Current production deployment before this report | `dpl_6kZ3Snn5H7V6wGy1SJdh93WDApAV` |
| Current production deployment state | READY |
| Current deployment SHA | `525f36798f55294932862f6d11c81b9679c5bf72` |
| New Part 5 report commit | Recorded after commit/push |
| Pull request | Recorded after creation |
| Merge SHA | Recorded after merge |
| Post-merge deployment ID | Recorded after Vercel deployment completes |
| Post-merge production SHA | Recorded after deployment inspection |
| Post-merge production URL verification | Recorded after deployment inspection |

## 7. Remaining blockers

1. Authenticated production UI certification for Attendance, Score Entry, sample testing, Result Slip, and PDF requires an authorized production account/session.
2. Production database `SELECT 1`, schema/migration state, live class catalog, live sample count, and cross-school data checks require the protected production database credential.
3. These blockers do not represent repository test failures; they are environment-access limits and are not reported as PASS.
