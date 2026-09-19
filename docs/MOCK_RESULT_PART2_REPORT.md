# Mock Result Slip Enhancement — Part 2

## Canonical library located

The authoritative End-of-Term GES assessment source is the existing EduTrack-parity asset `public/ges-assessment-libraries.js`, generated from `test/fixtures/edutrack-ges-assessment-libraries.json` and already used by the End-of-Term result implementation. The server-side counterpart is `src/ges-assessment-libraries.js`. The library categories are `conduct`, `attitude`, `interest`, `ctRemarks`, and `htRemarks`.

Each category contains exactly 30 unique positive statements and 30 unique negative statements. The Mock Result client now loads this same browser asset before rendering and does not define a Mock-specific comment bank.

| Category | Positive | Negative |
|---|---:|---:|
| Conduct | 30 | 30 |
| Attitude | 30 | 30 |
| Interest | 30 | 30 |
| Class Teacher Remarks | 30 | 30 |
| Headteacher Remarks | 30 | 30 |

## Persistence mechanism

Mock assessments now use the existing academic result persistence path: `POST /api/academic/results/save`, `academicResults.saveResult()`, the existing result-key isolation, and `savedResultFor()` retrieval. The saved record uses `examination: 'MOCK'`, so the selected statements are isolated by school, student, class, academic year, term, and examination type. Mock users with the existing `mock.scores.write` permission can persist the assessment through the shared Save Result service.

After saving, the Mock Result is regenerated through the existing protected Mock Result API. The saved assessment is returned in the generated result and is therefore retained across regeneration, publication, refresh, login, print, and PDF rendering wherever the existing result lifecycle is used.

## Edit mode and final mode

When no assessment has been saved, the Mock Result Slip displays Positive and Negative selection controls backed by the shared library. Selecting a sentiment replaces the category picker with the corresponding 30 statements, and each category stores one selected statement.

After the assessment is saved, the result renderer switches to final mode. The final assessment section contains only the category name and selected statement. Positive, Negative, dropdowns, and action controls are not included in that assessment output. Print/PDF uses the same final rendered markup and the existing no-print behavior for the print button.

## Files changed

- `public/mock-results.html`: loads the existing authoritative GES assessment library before the Mock client.
- `public/mock-result-view.js`: adds shared-library Positive/Negative selection, one-selection-per-category behavior, shared Save Result persistence, and final-mode rendering without sentiment labels.
- `src/academic-results.js`: allows Mock assessment saves through the existing Mock score permission path while retaining the shared result persistence service.
- `test/mock-result-part2.test.js`: adds shared library count/parity, persistence, final-rendering, and print/PDF contract tests.
- `docs/MOCK_RESULT_PART2_REPORT.md`: records the forensic discovery and implementation evidence.

No duplicate Mock comment library, schema, or separate persistence architecture was created. Existing End-of-Term behavior and its shared library remain unchanged.

## Validation

Focused Part 2 and regression tests completed successfully: **18/18 passed**. The tests verified exact 30/30 library counts, parity with the authoritative fixture, persistence through shared Save Result and regeneration, one selection per category, final output without Positive/Negative labels, print/PDF control behavior, existing Mock calculations, JHS eligibility, and existing result-slip helpers.
