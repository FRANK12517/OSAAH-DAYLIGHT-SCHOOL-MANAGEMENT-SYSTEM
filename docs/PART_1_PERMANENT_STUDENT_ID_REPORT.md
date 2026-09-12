# Part 1 Permanent Student ID completion report

## Scope completed

The existing `student_profiles` table remains the student authority. This change adds a nullable, unique `permanent_student_id` and a yearly `student_id_sequences` allocator table through migration 023. Existing numeric/text primary keys and every current foreign-key relationship remain unchanged.

New identifiers use `OSAAH/YYYY/XXXX`. The allocator advances per admission year and does not decrement or reuse issued numbers. The production repository must lock the applicable `student_id_sequences` row with `SELECT ... FOR UPDATE` inside the enrolment transaction; the in-process service mirrors this behavior for the current runtime.

## Backfill preflight and results

No production database adapter or production connection is configured in this workspace, so production counts and backfill results are **not available** and no migration/backfill was executed. This is intentional: the system must not guess an admission year or mutate unknown production records.

Before applying the unique constraint to populated production data, run the server-owned `reconcilePermanentStudentIds` workflow against the authoritative records and retain its report fields: total students, valid existing IDs, missing IDs, duplicates, malformed IDs, uncertain admission years, assigned IDs, and ambiguity rows. Only records with a verified admission year may receive an ID. Duplicates, malformed IDs, and uncertain dates require operator reconciliation.

## Admission, guardian, register, and record view

On accepted admission, the existing server creates the student once, persists the primary/secondary guardian information into the existing `student_profiles.family` service representation, and returns the generated permanent ID. The original admission date is sent to the student service for year selection. Parent phone uses the existing canonical `student_family_contacts.telephone` column; no competing phone column is introduced.

`GET /api/attendance/register?classId=...` returns ordered permanent ID and name rows only after attendance RBAC and teacher class-assignment checks. The attendance page now renders the responsive, horizontally scrollable register and saves through the existing batch endpoint.

`GET /api/students/master-record?permanentStudentId=...` provides an authorized, aggregate academic master record. It reuses student, class history, attendance, result, and fee services and suppresses sections the caller is not authorized to read.

## Verification

`npm test -- --test-name-pattern="admission form|attendance|student"` passed: 46 test files, 0 failures.

`npm run migration:validate` passed with 22 discovered migrations. This validates ordering/checksum discovery only; it does not apply migrations or connect to production.

No production migration, commit, merge, or deployment was performed.
