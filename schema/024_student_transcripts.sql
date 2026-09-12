CREATE TABLE IF NOT EXISTS student_transcripts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  student_id TEXT NOT NULL REFERENCES student_profiles(id),
  transcript_reference VARCHAR(32) NOT NULL UNIQUE,
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  generated_by TEXT NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  revoked_by TEXT REFERENCES users(id),
  revoked_at TEXT,
  revocation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS student_transcript_versions (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES student_transcripts(id),
  version_number INTEGER NOT NULL,
  academic_snapshot TEXT NOT NULL,
  document_checksum VARCHAR(128) NOT NULL,
  verification_token_hash VARCHAR(128) NOT NULL UNIQUE,
  generated_by TEXT NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  regeneration_reason TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  superseded_by_version INTEGER,
  revoked_by TEXT REFERENCES users(id),
  revoked_at TEXT,
  revocation_reason TEXT,
  UNIQUE(transcript_id, version_number)
);
CREATE INDEX idx_student_transcripts_student ON student_transcripts(school_id, student_id);
CREATE INDEX idx_student_transcripts_status ON student_transcripts(school_id, status);
CREATE INDEX idx_student_transcript_versions_token ON student_transcript_versions(verification_token_hash);
