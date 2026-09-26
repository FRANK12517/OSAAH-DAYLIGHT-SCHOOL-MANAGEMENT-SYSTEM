-- Metadata only. Run against the existing production database with read-only access.
-- This file does not select student records, scores, credentials or other row data.
SELECT DATABASE() AS inspected_database;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'schools', 'students', 'student_enrollments', 'student_profiles',
    'classes', 'academic_years', 'terms', 'subjects', 'class_subjects',
    'subject_class_assignments', 'academic_score_records',
    'assessment_scores', 'assessments', 'exam_scores', 'exams',
    'examination_marks', 'examinations', 'examination_subjects',
    'report_cards', 'student_assessments', 'result_publications', 'result_blocks',
    'student_attendance', 'attendance_sessions', 'result_signatures',
    'staff_assignments', 'teacher_classes', 'grading_scales', 'grading_systems'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, SUB_PART
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'students', 'student_enrollments', 'student_profiles', 'classes', 'subjects',
    'class_subjects', 'subject_class_assignments', 'academic_score_records',
    'assessment_scores', 'assessments', 'exam_scores', 'exams',
    'examination_marks', 'examinations', 'examination_subjects',
    'report_cards', 'student_assessments', 'result_publications', 'result_blocks',
    'student_attendance', 'attendance_sessions', 'result_signatures',
    'staff_assignments', 'teacher_classes', 'grading_scales', 'grading_systems'
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'student_enrollments', 'student_profiles', 'class_subjects',
    'subject_class_assignments', 'academic_score_records',
    'assessment_scores', 'assessments', 'exam_scores', 'exams',
    'examination_marks', 'examinations', 'examination_subjects',
    'report_cards', 'student_assessments', 'result_publications',
    'student_attendance', 'attendance_sessions', 'result_signatures',
    'staff_assignments', 'teacher_classes', 'grading_scales', 'grading_systems'
  )
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
