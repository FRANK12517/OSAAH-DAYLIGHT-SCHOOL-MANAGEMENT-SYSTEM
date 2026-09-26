# Result Slip Part 6A — Production Schema Evidence

## Collection status

**BLOCKED — no production inventory was dispatched and no live metadata was retrieved.** This file deliberately contains no guessed or reconstructed production columns.

The existing protected workflow is `.github/workflows/production-schema-inventory.yml`. It verifies that `DATABASE_URL` exists without printing its value, then invokes `scripts/production-schema-inventory.mjs`. Its configured expected database is `osaahdaylightschool`. This mechanism was inspected but not run for Part 6A.

The local `gh` executable reports that its configured `FRANK12517` GitHub token is invalid. Its request to GitHub’s API was also blocked by the environment’s network policy. The checkout’s `origin` points to a local worktree mirror. Thus no dispatch or workflow run ID exists. No database connection or application-table query was attempted; no application data or metadata was read, and no production mutation occurred.

## Captured production results

None. Every required field below remains **NOT VERIFIED** until an authorized protected workflow run returns sanitized `information_schema` results and those results are copied here.

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

Restore authorized GitHub access (or confirm the pending GitHub plugin installation) and dispatch the existing protected metadata-only workflow against the intended commit. Expand the checked-in query first if needed to emit full column metadata, PK/index membership, FK targets and referential rules for attendance, signatures, staff, role and period tables. Verify the connected database name, retain only sanitized catalog metadata, and paste the actual relevant result into this file. Do not use production application rows to fill schema gaps.
