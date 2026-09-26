# Result Slip Repair — Part 6 Report

## Part 6A — production metadata

**COMPLETE.** Protected metadata inventory run **36276551209**, job **108500306509**, checked release `25181033f7b442804143a0d29e6af87c44ea691a` against `osaahdaylightschool`; database identity matched and there were no production mutations.

## Part 6B — durable historical attendance and signatures

The real `durableAcademic.result()` path now loads attendance from production `student_attendance` using its verified `date` column and exact school, master student/profile bridge, class, academic-year name, term name, and term ID. The student bridge uses `student_profiles.student_master_id -> students.id` and matches the profile's permanent identifier. The previous process-local signature resolver is no longer used for real results.

Daily attendance collapses duplicate subject rows by distinct date. A `subject_key='daily'` row is canonical and takes precedence. If there is no canonical daily row, the day is counted only when all subject statuses agree; conflicts are surfaced separately. Only recognized present/absent statuses contribute to those totals; early departure and unsupported statuses are reported separately. Missing attendance yields “Not recorded” counts, never an inferred absence.

`totalSchoolDays` remains **Not recorded** (`null`): verified `attendance_sessions` records do not prove an official academic-period calendar, and no date range is used to invent a total.

Class teachers resolve through unique active `staff_assignments` for the selected class, year, and term, then `staff_profiles -> users`, with an active TEACHER role. Their durable signature must be active and match school, staff, class, and academic year. Ambiguous assignment/signature matches do not select an arbitrary record.

The verified schema has no historical headteacher assignment. The explicit policy is **current active official Headteacher by product design**, school scoped and resolved through active user-role relationships. Only a unique active headteacher is shown; no proprietor/actor fallback is used. Durable `signature_url` is shared by the screen and PDF DTO. The browser only renders safe same-origin `signatures/` references; the PDF embeds local PNG/JPEG assets within the public signatures directory and safely omits unavailable/non-local assets.

Sample Mode continues to use its isolated synthetic workflow and does not query real attendance, staff assignments, or persisted signatures. Migrations 055 and 056 remain prepared/unapplied; migration 057 was not created because the verified schema supports the required reads. No production writes, migrations, merges, or deployment occurred.

## Verification

Part 6B adds coverage for production date/query scope, the student-profile identity bridge, daily subject-row collapse, conflicts, unknown statuses, missing attendance, historical staff assignment, durable identity/signature resolution, inactive/wrong-school signature exclusion, ambiguity handling, current-headteacher policy, PDF/browser resolver parity, Sample Mode isolation, and no real-result Map fallback.

- Focused Part 6 / PDF / Sample Mode tests: **43 passed, 0 failed**.
- Full `npm test`: **893 passed, 0 failed**.
- `npm run migration:validate`: **passed**, 55 migrations valid.
- JavaScript syntax checks and `git diff --check`: **passed**.
- Migrations 055/056: prepared, not applied. Migration 057: not required, not created.
- Production changes, deployment, and merge: none.
- Commit: local Part 6B commit on `fix/result-slip-options-part1`.
- Push: failed; normal Git could not connect to `github.com:443` (`Failed to connect to server`). No alternate or forced push was attempted.
