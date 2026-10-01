-- Establish the canonical terms identity contract for installations whose
-- production schema predates the composite uniqueness in 001_foundation.sql.
CREATE UNIQUE INDEX IF NOT EXISTS uq_terms_academic_year_name
  ON terms (academic_year_id, name);
