-- Align the admission application linkage with the master student identity
-- contract used by enrollment and all downstream academic/finance modules.
ALTER TABLE admission_applications
  DROP FOREIGN KEY fk_aa_student,
  ADD CONSTRAINT fk_aa_student_master
  FOREIGN KEY (student_id) REFERENCES students(id);
