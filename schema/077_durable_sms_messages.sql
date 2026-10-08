-- Part 2: durable SMS campaigns, recipients, and dedicated role permission.
-- Additive only. TEXT fields are deliberately not indexed and have no defaults.
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  message_body TEXT NOT NULL,
  recipient_mode VARCHAR(32) NOT NULL,
  selector_json TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NOT NULL REFERENCES users(id),
  idempotency_key VARCHAR(128),
  provider_key VARCHAR(32),
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  sent_at VARCHAR(64),
  UNIQUE KEY uq_sms_campaign_idempotency (school_id, idempotency_key),
  KEY idx_sms_campaign_history (school_id, created_by, updated_at),
  KEY idx_sms_campaign_status (school_id, status, updated_at)
);
CREATE TABLE IF NOT EXISTS sms_campaign_recipients (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id),
  campaign_id VARCHAR(64) NOT NULL REFERENCES sms_campaigns(id),
  parent_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  student_id VARCHAR(64) REFERENCES students(id),
  normalized_phone VARCHAR(20) NOT NULL,
  recipient_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  provider_message_id VARCHAR(128),
  last_error VARCHAR(255),
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  delivered_at VARCHAR(64),
  UNIQUE KEY uq_sms_campaign_phone (school_id, campaign_id, normalized_phone),
  KEY idx_sms_recipient_campaign_status (school_id, campaign_id, status),
  KEY idx_sms_recipient_provider (school_id, provider_message_id)
);
INSERT IGNORE INTO permissions (id,permission_key,permission_name,created_at,updated_at)
VALUES ('permission-messages-sms-send','messages.sms.send','Send parent SMS messages',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
INSERT IGNORE INTO role_permissions (role_id,permission_id,created_at)
SELECT r.id,p.id,CURRENT_TIMESTAMP FROM roles r JOIN permissions p ON p.permission_key='messages.sms.send'
WHERE r.role_key IN ('PROPRIETOR','SCHOOL_ADMIN','HEADTEACHER');
