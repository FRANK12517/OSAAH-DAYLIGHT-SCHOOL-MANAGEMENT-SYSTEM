-- Reconcile admitted students that have a current class and admission year but
-- no student_enrollments row. Historical or promoted students with any
-- enrollment history are deliberately left unchanged.
--
-- The inferred academic year is limited to the year whose configured date
-- range contains the student's admission_date (or created_at date). Students
-- without an unambiguous class/year match are not fabricated into a roster.

INSERT INTO student_enrollments (
  id,
  school_id,
  student_id,
  permanent_student_id,
  academic_year,
  academic_year_id,
  class_id,
  class_name,
  term_id,
  enrollment_status,
  is_current
)
SELECT
  UUID(),
  s.school_id,
  s.id,
  s.permanent_student_id,
  y.name,
  y.id,
  c.id,
  c.name,
  NULL,
  'ACTIVE',
  1
FROM students s
JOIN academic_years y
  ON y.school_id = s.school_id
 AND COALESCE(s.admission_date, DATE(s.created_at)) BETWEEN y.starts_on AND y.ends_on
JOIN classes c
  ON c.school_id = s.school_id
 AND c.id = COALESCE(
   s.current_class_id,
   (SELECT sp.class_id
      FROM student_profiles sp
     WHERE sp.school_id = s.school_id
       AND (sp.student_master_id = s.id
         OR (sp.student_master_id IS NULL AND sp.student_id = s.permanent_student_id))
     ORDER BY sp.id DESC
     LIMIT 1)
 )
WHERE (s.current_class_id IS NOT NULL
   OR EXISTS (
     SELECT 1
       FROM student_profiles sp
      WHERE sp.school_id = s.school_id
        AND sp.class_id = c.id
        AND (sp.student_master_id = s.id
          OR (sp.student_master_id IS NULL AND sp.student_id = s.permanent_student_id))
   ))
  AND s.is_test_record IS NOT TRUE
  AND UPPER(COALESCE(s.student_status, 'ACTIVE')) NOT IN ('WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'GRADUATED')
  AND NOT EXISTS (
    SELECT 1
      FROM student_enrollments e
     WHERE e.school_id = s.school_id
       AND e.student_id = s.id
  );
