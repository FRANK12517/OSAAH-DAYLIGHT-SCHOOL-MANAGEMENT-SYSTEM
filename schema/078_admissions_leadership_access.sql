-- Grant workflow authoring to the two existing school leadership roles.
-- Existing admissions.read/review/accept/reject and prospectus permissions remain intact.
INSERT IGNORE INTO permissions (id, permission_key, permission_name)
VALUES ('permission-admissions-write', 'admissions.write', 'Create and update admission applications');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'admissions.write'
WHERE r.role_key IN ('HEADTEACHER', 'ASSISTANT_HEADTEACHER');

-- The browser keeps this token stable while an enquiry request is retried.
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS enquiry_request_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS permanent_student_id VARCHAR(128) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_applications_enquiry_request
  ON admission_applications (school_id, enquiry_request_id);

-- One application may materialize as only one student. TiDB permits multiple NULLs.
-- Applying this index will fail safely if an existing duplicate needs preflight repair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_application_student_id
  ON admission_applications (student_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_application_permanent_student_id
  ON admission_applications (school_id, permanent_student_id);

-- Prevent duplicate active class placement for the same year and term.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_enrollment_context
  ON student_enrollments (school_id, student_id, academic_year_id, term_id, is_current);
