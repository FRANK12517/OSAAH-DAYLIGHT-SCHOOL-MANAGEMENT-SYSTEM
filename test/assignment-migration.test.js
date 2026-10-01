import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const migration = await readFile(new URL('../schema/062_assignments.sql', import.meta.url), 'utf8');

test('assignment migration is discovered as additive migration 062', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const current = migrations.find((item) => item.version === 62);
  assert.ok(current);
  assert.equal(current.name, '062_assignments.sql');
  assert.equal(migrations.at(-1).version, 62);
  assert.match(current.checksum, /^[a-f0-9]{64}$/);
});

test('assignment migration preserves school isolation, publication state, recipients, and private file metadata', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assignments/i);
  assert.match(migration, /school_id VARCHAR\(64\) NOT NULL/);
  assert.match(migration, /recipient_student_ids JSON NOT NULL/);
  assert.match(migration, /status VARCHAR\(16\) NOT NULL DEFAULT 'DRAFT'/);
  assert.match(migration, /published_by VARCHAR\(64\) NULL/);
  assert.match(migration, /published_at VARCHAR\(32\) NULL/);
  assert.match(migration, /fk_assignments_school FOREIGN KEY \(school_id\) REFERENCES schools\(id\)/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS assignment_files/i);
  assert.match(migration, /storage_reference VARCHAR\(1024\) NOT NULL/);
  assert.match(migration, /fk_assignment_files_assignment FOREIGN KEY \(assignment_id\) REFERENCES assignments\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /fk_assignment_files_school FOREIGN KEY \(school_id\) REFERENCES schools\(id\)/i);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\b(TRUNCATE|DELETE FROM)\b/i);
});
