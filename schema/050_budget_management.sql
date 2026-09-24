-- 050_budget_management.sql
-- Durable school-scoped budget planning. Utilization is intentionally derived
-- as zero until qualifying durable expense transactions can link to budget_item_id.
CREATE TABLE IF NOT EXISTS budgets (
  id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  academic_year VARCHAR(64) NOT NULL,
  term VARCHAR(64) NOT NULL,
  budget_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  total_budget_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_budgets_school_period (school_id, academic_year, term),
  INDEX idx_budgets_school_status (school_id, status),
  INDEX idx_budgets_school_name (school_id, budget_name)
);

CREATE TABLE IF NOT EXISTS budget_items (
  id VARCHAR(64) NOT NULL,
  budget_id VARCHAR(64) NOT NULL,
  school_id VARCHAR(64) NOT NULL,
  category VARCHAR(128) NOT NULL,
  custom_category VARCHAR(255) NULL,
  description TEXT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_budget_items_budget (school_id, budget_id),
  INDEX idx_budget_items_category (school_id, category),
  INDEX idx_budget_items_school (school_id)
);
