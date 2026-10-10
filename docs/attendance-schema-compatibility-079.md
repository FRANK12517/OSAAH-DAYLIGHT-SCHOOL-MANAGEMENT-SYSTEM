# Attendance Schema Compatibility Migration 079

## Verified root cause

The read-only production inventory for `student_attendance` showed a legacy schema with `date`, `remarks`, and `created_at`, while the durable attendance reader selects `attendance_date`, `method`, `reason`, `arrival_time`, `departure_time`, `version`, `entered_by`, `entered_at`, and `updated_at`. The missing `attendance_date` is the first field used by the register read path and produces MySQL/TiDB `ER_BAD_FIELD_ERROR` before the register can be returned.

The production inventory also confirmed that `academic_year`, `term`, `subject_key`, `recorded_by`, `recorded_at`, `updated_by`, and `source` already exist. No student-row contents were queried or exported.

## Repair

`079_attendance_legacy_schema_compatibility.sql` is additive and forward-only. It adds the fields required by the durable reader, backfills `attendance_date` from the legacy `date`, and backfills timestamp metadata from `created_at` only where the canonical field is absent. It leaves `remarks` untouched rather than assuming it means `reason`. Unknown historical authors, reasons, and times remain unknown (`NULL`); the migration does not fabricate identities or attendance history.

The legacy columns and record identifiers are retained. The canonical read index is added with an idempotent guard. Existing migration-ledger and protected-workflow controls remain the authority for production application.

## Release gate

This migration must be dry-run and applied only through a protected production workflow against the exact tested release commit. It must not be run with the general migration command if unrelated migrations are pending. A production database backup/recovery checkpoint and the authorized production environment approval are required before applying it.
