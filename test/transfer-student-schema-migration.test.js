import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const schemaDirectory = fileURLToPath(new URL('../schema/', import.meta.url));

test('TiDB transfer migration checks the live schema before adding or normalizing nullable columns', async () => {
  const migrations = await discoverMigrations(schemaDirectory);
  const migration = migrations.find((item) => item.version === 86);
  assert.ok(migration, 'migration 086 is registered');
  assert.match(migration.name, /^086_transfer_student_previous_class\.sql$/);
  assert.match(migration.sql, /information_schema\.COLUMNS/i);
  assert.match(migration.sql, /ADD COLUMN previous_school VARCHAR\(120\) NULL/i);
  assert.match(migration.sql, /MODIFY COLUMN previous_school VARCHAR\(120\) NULL/i);
  assert.match(migration.sql, /ADD COLUMN previous_class VARCHAR\(20\) NULL/i);
  assert.match(migration.sql, /MODIFY COLUMN previous_class VARCHAR\(20\) NULL/i);
  assert.match(migration.sql, /IS_NULLABLE = 'YES'/i);
});

test('production runbook requires a verified backup and width preflight', async () => {
  const runbook = await readFile(new URL('../docs/transfer-student-fields-migration.md', import.meta.url), 'utf8');
  assert.match(runbook, /protected backup/i);
  assert.match(runbook, /mysqldump.*single-transaction/s);
  assert.match(runbook, /over-limit count is nonzero, stop/i);
});
