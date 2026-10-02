CREATE TABLE IF NOT EXISTS academic_result_blocks (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  academic_year VARCHAR(128) NOT NULL,
  term VARCHAR(128) NOT NULL,
  class_id VARCHAR(128) NOT NULL,
  student_id VARCHAR(64) NOT NULL DEFAULT '*',
  scope ENUM('STUDENT','CLASS') NOT NULL,
  status ENUM('BLOCKED','UNBLOCKED') NOT NULL DEFAULT 'BLOCKED',
  reason VARCHAR(500) NOT NULL,
  blocked_by VARCHAR(64) NOT NULL,
  blocked_by_role VARCHAR(64) NOT NULL,
  blocked_at DATETIME NOT NULL,
  unblocked_by VARCHAR(64) NULL,
  unblocked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_result_block_scope (school_id, academic_year, term, class_id, student_id),
  KEY idx_academic_result_block_lookup (school_id, academic_year, term, class_id, status)
);

CREATE TABLE IF NOT EXISTS academic_result_unblock_requests (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  block_id VARCHAR(64) NOT NULL,
  academic_year VARCHAR(128) NOT NULL,
  term VARCHAR(128) NOT NULL,
  class_id VARCHAR(128) NOT NULL,
  student_id VARCHAR(64) NOT NULL DEFAULT '*',
  scope ENUM('STUDENT','CLASS') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  requested_by VARCHAR(64) NOT NULL,
  requested_by_role VARCHAR(64) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME NOT NULL,
  decided_by VARCHAR(64) NULL,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_academic_result_unblock_lookup (school_id, status, requested_at)
);
