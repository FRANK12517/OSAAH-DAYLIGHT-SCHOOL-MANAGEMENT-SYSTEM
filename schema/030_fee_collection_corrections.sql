CREATE TABLE IF NOT EXISTS fee_collection_corrections (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL,
  collection_id VARCHAR(64) NOT NULL,
  actor_user_id VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  before_amount_received_minor BIGINT NOT NULL,
  after_amount_received_minor BIGINT NOT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_fee_correction_collection FOREIGN KEY (collection_id) REFERENCES fee_collection_records(id),
  KEY idx_fee_corrections_school (school_id),
  KEY idx_fee_corrections_collection (collection_id)
);
