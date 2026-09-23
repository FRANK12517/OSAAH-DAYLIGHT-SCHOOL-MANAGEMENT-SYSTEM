import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('financial identity migration extends the existing students table only', async () => {
  const sql = await readFile(new URL('../schema/039_class_database_financial_identity.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE students/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS gender VARCHAR\(16\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS parent_guardian_name TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS registered_parent_phone VARCHAR\(32\)/);
  assert.match(sql, /idx_students_school_permanent_id/);
  assert.match(sql, /idx_students_school_name/);
  assert.match(sql, /idx_students_parent_phone/);
  assert.doesNotMatch(sql, /CREATE TABLE.*\b(students|student_profiles|classes)\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
