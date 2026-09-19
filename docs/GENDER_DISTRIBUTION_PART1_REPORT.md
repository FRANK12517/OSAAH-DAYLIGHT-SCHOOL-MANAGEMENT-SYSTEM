# Gender Distribution Enhancement — Part 1 Report

## Scope

Part 1 establishes student gender as a canonical student attribute and integrates it into the existing Admission and Class Database flows. Result Slip, Mock Result Slip, and Broadsheet gender-distribution UI changes were intentionally not implemented, as required by the stop point.

## Forensic discovery

The audit found that gender already exists in the canonical data architecture. The admission form already exposes one required Male/Female selector. The in-memory student service already stores `student.gender`. The existing SQL schema contains `student_profiles.gender`, and the TiDB enrollment path already inserts gender into both `students.gender` and `student_profiles.gender`. The admission application stores the applicant payload in its existing JSON sections.

Because an authoritative gender field already existed, **no competing gender column and no new migration were created**. The implementation reuses the existing fields and persistence path.

## Implementation

A shared `src/student-gender.js` contract now normalizes legacy equivalents as follows: `M` and `MALE` become `Male`; `F` and `FEMALE` become `Female`; unknown, blank, or unsupported legacy values remain null and display as `Not Recorded`. New admissions require a valid `Male` or `Female` value at submission, while legacy students are never assigned guessed values.

The existing admission form remains the single-selection required control. The admission-form service normalizes gender on create and update and validates it at submission. The database-backed accepted-admission enrollment service validates the same contract and writes the normalized value to both existing canonical student/profile fields.

The existing Class Database now displays a Gender column between Student Name and Parent/Guardian. It is autopulled from the canonical student record, with `Not Recorded` shown where an existing real student has no gender. Search, class filtering, parent information, Permanent Student ID behavior, promotion, repetition, authorization, and route behavior remain unchanged.

## Files changed

| File | Change |
|---|---|
| `src/student-gender.js` | Added shared normalization, validation, and display helpers. |
| `src/students.js` | Normalizes supplied gender while preserving null for legacy gaps. |
| `src/admission-form.js` | Normalizes gender and requires valid gender for new submission. |
| `src/admission-enrollment.js` | Validates and persists normalized gender to existing student/profile fields. |
| `src/class-database.js` | Adds canonical gender to projected rows. |
| `public/class-database.html` | Adds the Gender table column. |
| `public/class-database.js` | Renders Gender and updates empty-state table spans. |
| `test/student-gender-part1.test.js` | Adds Part 1 admission, persistence, identity, Class Database, legacy-gap, schema, and UI tests. |
| `test/class-database.test.js` | Updates the existing expected row to include the intentional Gender field. |
| `docs/GENDER_DISTRIBUTION_PART1_REPORT.md` | This implementation and validation report. |

## Data integrity and workflow checks

The focused tests verify Male and Female admissions, missing-gender rejection, equivalent-value normalization, Permanent Student ID generation, canonical Class Database retrieval, `Not Recorded` behavior for legacy gaps, promotion and repetition without identity duplication, existing schema gender columns, and the existing required admission UI control. Existing admission, enrollment, parent-link, Class Database, routing, promotion, and completion behavior remains covered.

No random gender values were assigned. No gender was inferred from names, titles, parent information, photographs, or Permanent Student IDs. Gender remains a student attribute rather than an examination, result, Mock, or Broadsheet field.

## Validation

Focused Part 1 suite: **26/26 passed**. The complete repository suite and protected asset verification are the release gate. Result Slip, Mock Result Slip, and Broadsheet gender-distribution UI work remains intentionally deferred to Part 2.

## Stop point

Part 1 only is implemented. No Part 2 gender-distribution UI work has been performed.
