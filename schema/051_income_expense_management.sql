-- 051_income_expense_management.sql
-- Durable general/non-fee income and expenditure transactions.
-- Student fee payments remain in the canonical fee/payment tables.

CREATE TABLE IF NOT EXISTS general_income (
  id VARCHAR(191) PRIMARY KEY,
  school_id VARCHAR(191) NOT NULL REFERENCES schools(id),
  transaction_date VARCHAR(32) NOT NULL,
  academic_year VARCHAR(64) NOT NULL,
  term VARCHAR(64) NOT NULL,
  income_category VARCHAR(96) NOT NULL,
  custom_category VARCHAR(160) DEFAULT NULL,
  description VARCHAR(500) NOT NULL,
  reference_number VARCHAR(160) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(32) NOT NULL,
  payer_or_source VARCHAR(240) NOT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOIDED')),
  created_by VARCHAR(191) NOT NULL REFERENCES users(id),
  created_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(191) NOT NULL REFERENCES users(id),
  updated_at VARCHAR(32) NOT NULL,
  voided_by VARCHAR(191) DEFAULT NULL REFERENCES users(id),
  voided_at VARCHAR(32) DEFAULT NULL,
  void_reason TEXT DEFAULT NULL,
  UNIQUE(school_id, reference_number, status)
);

CREATE INDEX IF NOT EXISTS idx_general_income_school_date ON general_income(school_id, transaction_date, id);
CREATE INDEX IF NOT EXISTS idx_general_income_school_period ON general_income(school_id, academic_year, term, status);
CREATE INDEX IF NOT EXISTS idx_general_income_school_category ON general_income(school_id, income_category, status);

CREATE TABLE IF NOT EXISTS general_expenses (
  id VARCHAR(191) PRIMARY KEY,
  school_id VARCHAR(191) NOT NULL REFERENCES schools(id),
  transaction_date VARCHAR(32) NOT NULL,
  academic_year VARCHAR(64) NOT NULL,
  term VARCHAR(64) NOT NULL,
  expense_category VARCHAR(96) NOT NULL,
  custom_category VARCHAR(160) DEFAULT NULL,
  description VARCHAR(500) NOT NULL,
  reference_number VARCHAR(160) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(32) NOT NULL,
  payee VARCHAR(240) NOT NULL,
  notes TEXT DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOIDED')),
  budget_id VARCHAR(64) DEFAULT NULL REFERENCES budgets(id),
  budget_item_id VARCHAR(64) DEFAULT NULL REFERENCES budget_items(id),
  created_by VARCHAR(191) NOT NULL REFERENCES users(id),
  created_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(191) NOT NULL REFERENCES users(id),
  updated_at VARCHAR(32) NOT NULL,
  voided_by VARCHAR(191) DEFAULT NULL REFERENCES users(id),
  voided_at VARCHAR(32) DEFAULT NULL,
  void_reason TEXT DEFAULT NULL,
  UNIQUE(school_id, reference_number, status)
);

CREATE INDEX IF NOT EXISTS idx_general_expenses_school_date ON general_expenses(school_id, transaction_date, id);
CREATE INDEX IF NOT EXISTS idx_general_expenses_school_period ON general_expenses(school_id, academic_year, term, status);
CREATE INDEX IF NOT EXISTS idx_general_expenses_school_category ON general_expenses(school_id, expense_category, status);
CREATE INDEX IF NOT EXISTS idx_general_expenses_budget_item ON general_expenses(school_id, budget_id, budget_item_id, status);
