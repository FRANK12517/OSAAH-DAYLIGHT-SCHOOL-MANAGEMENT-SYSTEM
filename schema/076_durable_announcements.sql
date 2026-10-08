CREATE TABLE IF NOT EXISTS announcement_records (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  recipient_category VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  scheduled_for VARCHAR(64),
  published_at VARCHAR(64),
  sender_id VARCHAR(64) NOT NULL REFERENCES users(id),
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  announcement_id VARCHAR(64) NOT NULL REFERENCES announcement_records(id),
  recipient_id VARCHAR(64) NOT NULL REFERENCES users(id),
  recipient_type VARCHAR(32) NOT NULL,
  assigned_at VARCHAR(64) NOT NULL,
  UNIQUE(school_id,announcement_id,recipient_id)
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  announcement_id VARCHAR(64) NOT NULL REFERENCES announcement_records(id),
  recipient_id VARCHAR(64) NOT NULL REFERENCES users(id),
  read_at VARCHAR(64) NOT NULL,
  UNIQUE(school_id,announcement_id,recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_recipient ON announcement_recipients(school_id,recipient_id,announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_due ON announcement_records(school_id,status,scheduled_for);
CREATE INDEX IF NOT EXISTS idx_announcement_reads ON announcement_reads(school_id,recipient_id,announcement_id);
