# Result Slip Part 6A — Production Schema Evidence

## Collection status

**BLOCKED — the expanded metadata inventory is prepared and tested, but no new protected production run has been dispatched and no new live metadata has been retrieved.** This file deliberately contains no guessed or reconstructed production columns.

The existing protected workflow is `.github/workflows/production-schema-inventory.yml`. It verifies that `DATABASE_URL` exists without printing its value, then invokes `scripts/production-schema-inventory.mjs`. Its configured expected database is `osaahdaylightschool`. The inventory script now guards the database name before any table metadata read and emits full catalog-only columns, PK/unique constraints, indexes, and FK rules for the required tables plus tables directly related through declared FKs. Focused tests cover metadata-only query behavior and the fail-closed database guard. The updated protected workflow has not yet run.

No workflow dispatch has been made from this task. The metadata-only tooling and status-document updates are being published to the existing branch through the authenticated GitHub connector because normal `git push` cannot connect to `github.com:443` and the local GitHub CLI token is invalid. The connector exposes Git operations but no workflow-dispatch action. No database connection or application-table query was attempted; no production application data or live schema metadata was read, and no production mutation occurred.

## Captured production results

None from the updated tooling. Every required field below remains **NOT VERIFIED** until an authorized protected workflow run returns sanitized `information_schema` results and those results are copied here. The previous inventory run `36208849852` predates the expanded output and its available report summary is insufficient to fill these fields.

| Required evidence | Status |
| --- | --- |
| Connected database identity | NOT VERIFIED; expected `osaahdaylightschool` |
| `student_attendance` columns and types | NOT VERIFIED |
| Attendance PK columns and order | NOT VERIFIED |
| Attendance indexes/unique academic-scope keys | NOT VERIFIED |
| Attendance FKs and referential rules | NOT VERIFIED |
| `date` versus `attendance_date`, SQL type and index membership | NOT VERIFIED beyond prior report summary that production has `date` |
| Attendance school/student/class/year/term relationships | NOT VERIFIED |
| `subject_key` daily versus subject semantics | NOT VERIFIED |
| Attendance status enum/type and canonical meaning | NOT VERIFIED from production metadata |
| `attendance_sessions` official school-day contract | NOT VERIFIED |
| `attendance_audit_history` role in current attendance state | NOT VERIFIED from production contract |
| `result_signatures` columns and storage format | NOT VERIFIED |
| Signature owner FK, role scope, class/year/term scope | NOT VERIFIED |
| Signature indexes/unique active constraint | NOT VERIFIED |
| User/staff/teacher identity bridge | NOT VERIFIED |
| Class teacher and headteacher assignment paths | NOT VERIFIED |
| Historical teacher/headteacher resolution | NOT VERIFIED |
| Migration 057 requirement | UNDETERMINED |

## Next required action

Dispatch the existing protected metadata-only workflow against `fix/result-slip-options-part1` once workflow-dispatch access is available. Verify the connected database name, retain only sanitized catalog metadata, and paste the actual relevant result into this file. Do not use production application rows to fill schema gaps.
