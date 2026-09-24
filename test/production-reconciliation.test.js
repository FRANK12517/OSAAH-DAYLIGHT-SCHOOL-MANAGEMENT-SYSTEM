import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createProductionBaseline, schemaFingerprint, assertNotHistoricalExecution } from '../src/platform/baseline.js';

const sql = await readFile(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url), 'utf8');

test('049 reconciliation is forward-only and contains no destructive data operations', () => {
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|DATABASE|INDEX|COLUMN)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_obligations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fee_collection_records/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS attendance_audit_history/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS staff_attendance_reconciliation_audit/);
  assert.match(sql, /Vacation Classes remains a collection period/);
});

test('production baseline records provenance without asserting historical execution', () => {
  const fingerprint = schemaFingerprint({ tables: ['students', 'classes'], columns: ['students.id'], indexes: ['students.PRIMARY'], foreignKeys: [] });
  const baseline = createProductionBaseline({ canonicalDatabase: 'osaahdaylightschool', baselineAt: '2026-09-24T00:00:00Z', repositoryCommit: '8b331c3e704ac289ab38689028f676bbb03763fd', schemaFingerprint: fingerprint, reconciliationMigration: '049_production_schema_reconciliation.sql', workflowProvenance: 'read-only-baseline-workflow' });
  assert.equal(baseline.baselineType, 'HISTORICAL_BASELINE');
  assert.equal(baseline.historicalMigrationsExecuted, false);
  assert.equal(assertNotHistoricalExecution(baseline), true);
});

test('schema fingerprint is deterministic regardless of input order', () => {
  const first = schemaFingerprint({ tables: ['b', 'a'], columns: ['b.id', 'a.id'] });
  const second = schemaFingerprint({ tables: ['a', 'b'], columns: ['a.id', 'b.id'] });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});
