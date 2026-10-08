CREATE TABLE IF NOT EXISTS announcement_records (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  recipient_category TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  scheduled_for TEXT,
  published_at TEXT,
  sender_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_recipients (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  announcement_id TEXT NOT NULL REFERENCES announcement_records(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  recipient_type TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  UNIQUE(school_id,announcement_id,recipient_id)
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  announcement_id TEXT NOT NULL REFERENCES announcement_records(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL,
  UNIQUE(school_id,announcement_id,recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_recipient ON announcement_recipients(school_id,recipient_id,announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_due ON announcement_records(school_id,status,scheduled_for);
CREATE INDEX IF NOT EXISTS idx_announcement_reads ON announcement_reads(school_id,recipient_id,announcement_id);
