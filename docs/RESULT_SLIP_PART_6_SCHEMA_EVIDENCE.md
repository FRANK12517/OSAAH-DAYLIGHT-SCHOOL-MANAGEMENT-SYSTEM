# Result Slip Part 6 — Production Schema Evidence

## Protected inventory

Part 6A is complete from protected production schema inventory workflow run **36276551209**, job **108500306509**, release **25181033f7b442804143a0d29e6af87c44ea691a**. The connected database was `osaahdaylightschool`; the expected database identity check passed. The job was metadata-only and made no production mutations.

## Verified contracts used by Part 6B

### Attendance

`student_attendance` uses the production date column `date`, not `attendance_date`. Its verified fields include `school_id`, `student_id`, `class_id`, `term_id`, `date`, `status`, `permanent_student_id`, `academic_year`, `term`, `subject_key`, and audit fields. Its unique attendance identity is `(school_id, academic_year, term, date, class_id, student_id, subject_key)`. `student_id` references `student_profiles.id`.

The production `student_profiles` identity bridge links `student_master_id` to the canonical `students.id`, and `student_id` carries the student's permanent identifier. Part 6B joins both keys and the school to avoid treating profile IDs and master IDs as interchangeable.

`attendance_sessions` records school, class, stream, date, session type, and taker, with uniqueness over `(school_id, class_id, stream_id, date, session_type)`. The inventory and current repository semantics do not establish that these rows are the official school-day calendar for an academic year/term. Part 6B therefore reports `totalSchoolDays: null` (“Not recorded”).

The attendance writer uses `subject_key='daily'` for a whole-day row when no subject is supplied. Part 6B gives that canonical daily row precedence. Without one, it counts a date only when all subject rows agree. Conflicting dates are reported separately, and missing attendance rows do not imply absence.

### Signatures and staff identity

`result_signatures` provides `id`, `school_id`, `staff_id`, `signature_type`, `class_id`, `academic_year`, `signature_url`, `is_active`, uploader/deactivation fields, and timestamps. Part 6B uses active signatures scoped by school, staff, and signature type. Class-teacher signatures also require exact class and academic-year scope.

`staff_profiles` links to `users` through `user_id`; `staff_assignments.staff_id` references `staff_profiles.id` and assignments carry class, academic year, and term IDs. Active users provide `full_name` and `phone`; school-scoped roles and `user_roles` establish the teacher/headteacher role.

No historically versioned headteacher-assignment path was verified. The implemented and documented policy uses the one current active Headteacher role holder in the selected school by product design, if exactly one exists. It does not label that person historical and does not fall back to an actor, proprietor, or process-local signature.

## Migration decision

The verified production contracts supply the attendance and signature fields needed by the real Result Slip read path. **Migration 057 is not required and was not created.** Migrations 055 and 056 remain prepared and unapplied. Part 6B performs no database writes or schema changes.
