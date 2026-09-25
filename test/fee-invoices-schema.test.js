import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fee invoice migration preserves canonical account and item relationships', async () => {
  const sql = await readFile(new URL('../schema/043_fee_invoices.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_invoices/);
  for (const field of ['account_id', 'permanent_student_id', 'academic_year_id', 'term_id', 'class_id', 'invoice_number', 'invoice_date', 'due_date', 'subtotal', 'discount_amount', 'total_amount', 'status', 'issued_by', 'issued_at', 'created_by', 'created_at', 'updated_by', 'updated_at']) assert.match(sql, new RegExp(`\\b${field}\\b`));
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS uq_fee_invoice_number/);
  assert.match(sql, /idx_fee_invoice_student/);
  assert.match(sql, /idx_fee_invoice_account/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_invoice_items/);
  assert.match(sql, /fee_structure_id/);
  assert.match(sql, /amount DECIMAL\(15,2\)/);
  assert.match(sql, /idx_fee_invoice_items_invoice/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});

test('production reconciliation creates fee invoice tables before using their columns', async () => {
  const sql = await readFile(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url), 'utf8');
  const invoiceCreate = sql.indexOf('CREATE TABLE IF NOT EXISTS fee_invoices');
  const itemCreate = sql.indexOf('CREATE TABLE IF NOT EXISTS fee_invoice_items');
  assert.ok(invoiceCreate >= 0);
  assert.ok(itemCreate > invoiceCreate);
  assert.doesNotMatch(sql, /ALTER TABLE fee_invoices\s+ADD COLUMN/i);
  assert.doesNotMatch(sql, /ALTER TABLE fee_invoice_items\s+ADD COLUMN/i);
  assert.match(sql.slice(invoiceCreate, itemCreate), /academic_year_id VARCHAR\(64\) NULL/);
  assert.match(sql.slice(invoiceCreate, itemCreate), /issued_by VARCHAR\(64\) DEFAULT NULL/);
  assert.match(sql.slice(itemCreate), /fee_structure_id TEXT DEFAULT NULL/);
  assert.match(sql.slice(itemCreate), /amount DECIMAL\(15,2\) NOT NULL/);
});
