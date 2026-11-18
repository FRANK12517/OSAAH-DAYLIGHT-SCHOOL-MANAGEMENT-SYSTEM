-- 089_correct_legacy_student_id_prefix.sql
-- Correct the historical OSAA/ spelling to OSAAH/ without changing the year,
-- sequence, or any other student data. Exact prefix matching makes every
-- statement repeat-safe and leaves already corrected IDs untouched.

UPDATE students
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';

UPDATE students
SET admission_number = CONCAT('OSAAH/', SUBSTRING(admission_number, 6))
WHERE admission_number LIKE 'OSAA/%';

UPDATE student_profiles
SET student_id = CONCAT('OSAAH/', SUBSTRING(student_id, 6))
WHERE student_id LIKE 'OSAA/%';

UPDATE student_profiles
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';

UPDATE student_profiles
SET admission_number = CONCAT('OSAAH/', SUBSTRING(admission_number, 6))
WHERE admission_number LIKE 'OSAA/%';

UPDATE student_enrollments
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';

UPDATE parent_student_links
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';

UPDATE admission_applications
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';

UPDATE student_id_reservations
SET permanent_student_id = CONCAT('OSAAH/', SUBSTRING(permanent_student_id, 6))
WHERE permanent_student_id LIKE 'OSAA/%';
