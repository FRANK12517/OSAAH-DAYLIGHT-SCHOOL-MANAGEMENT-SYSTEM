import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const schemaPath = fileURLToPath(new URL('../schema/031_controlled_schema_upgrade.sql', import.meta.url));

test('Part 2 migration is discovered as the next controlled migration', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  const migration = migrations.find((item) => item.name === '031_controlled_schema_upgrade.sql');
  assert.ok(migration);
  assert.equal(migration.version, 31);
  assert.match(migration.checksum, /^[a-f0-9]{64}$/);
});

test('Part 2 migration is additive and contains no destructive production operation', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  const executableSql = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executableSql, /\b(DROP|TRUNCATE|DELETE|RENAME)\b/i);
  assert.doesNotMatch(executableSql, /ALTER\s+TABLE\s+.*\b(MODIFY|CHANGE|DROP)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS class_label_aliases/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_users_school_status/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_fee_obligations_target_period/i);
});

test('Part 2 preserves one canonical class identity and does not seed class rows', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  assert.match(sql, /class_label_aliases/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+classes\b/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+class_levels\b/i);
});

test('Part 2 prepares the canonical staff role identifiers without hard-coding users', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  for (const role of ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'TEACHER']) {
    assert.match(sql, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+users\b/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+staff\b/i);
  assert.doesNotMatch(sql, /password/i);
});

test('migration inventory remains uniquely versioned after student fee ledger reconciliation', async () => {
  const migrations = await discoverMigrations(new URL('../schema', import.meta.url));
  assert.equal(migrations.length, 41);
  assert.equal(new Set(migrations.map((item) => item.version)).size, migrations.length);
  assert.equal(migrations.at(-1).name, '042_student_fee_ledger.sql');
});
