import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverMigrations } from '../src/platform/migration-runner.js';

const migrationPath = new URL('../schema/077_durable_sms_messages.sql', import.meta.url);
const runnerPath = new URL('../scripts/production-sms-migration-077.mjs', import.meta.url);
const workflowPath = new URL('../.github/workflows/production-sms-migration-077.yml', import.meta.url);

test('Migration 077 is discoverable under the exact durable SMS name', async () => {
  const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
  assert.ok(migrations.some((migration) => migration.version === 77 && migration.name === '077_durable_sms_messages.sql'));
});

test('Migration 077 is additive, avoids TiDB TEXT defaults/indexes, and grants only the three approved roles', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bREPLACE\s+INTO\b/i);
  assert.doesNotMatch(sql, /TEXT\s+NOT\s+NULL\s+DEFAULT/i);
  assert.match(sql, /message_body\s+TEXT\s+NOT\s+NULL/i);
  assert.match(sql, /selector_json\s+TEXT\s+NOT\s+NULL/i);
  assert.match(sql, /normalized_phone\s+VARCHAR\(20\)/i);
  const grant = sql.slice(sql.indexOf('INSERT IGNORE INTO role_permissions'));
  const roleList = grant.match(/role_key IN \(([^)]+)\)/)?.[1]?.match(/'([A-Z_]+)'/g)?.map((value) => value.slice(1, -1));
  assert.deepEqual(roleList, ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']);
});

test('production runner requires Migration 076, read-only dry-run default, exact token, and backup confirmation', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  assert.match(runner, /const mode = process\.argv\[2\] \?\? 'dry-run'/);
  assert.match(runner, /requiredAppliedVersions:\s*\[76\]/);
  assert.match(runner, /APPLY_DURABLE_SMS_MESSAGES_077/);
  assert.match(runner, /BACKUP_CONFIRMATION !== 'BACKUP_CONFIRMED'/);
  assert.match(runner, /execution:\s*'read-only'/);
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /needs: preflight/);
  assert.match(workflow, /backup_confirmation == 'BACKUP_CONFIRMED'/);
  assert.match(workflow, /SMS_MIGRATION_077_EXECUTION_TOKEN/);
});
