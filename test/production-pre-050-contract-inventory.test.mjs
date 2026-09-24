import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/production-pre-050-contract-inventory.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-pre-050-contract-inventory.yml', import.meta.url), 'utf8');
const forbiddenSql = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME'];

test('pre-050 production contract diagnostic is structurally read-only', () => {
  const executableSql = source.split('\n').filter((line) => line.includes("pool.query('") || line.includes('pool.query(`')).join('\n').toUpperCase();
  for (const word of forbiddenSql) assert.doesNotMatch(executableSql, new RegExp(`\\b${word}\\b`), `forbidden SQL keyword found: ${word}`);
  assert.doesNotMatch(source, /migration:(apply|baseline)|migration\.apply|recordBaseline|recordApplied|acquireLock|releaseLock/i);
  assert.match(source, /SELECT DATABASE\(\)/);
  assert.match(source, /information_schema\.(TABLES|COLUMNS|STATISTICS|TABLE_CONSTRAINTS|KEY_COLUMN_USAGE)/);
  assert.doesNotMatch(source, /console\.log\(.*DATABASE_URL/i);
});

test('pre-050 workflow is manually dispatched and does not apply migrations', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /secrets\.DATABASE_URL/);
  assert.match(workflow, /production-pre-050-contract-inventory\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /migration:(apply|baseline)|DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE /i);
});

test('diagnostic explicitly reports no production writes', () => {
  assert.match(source, /NO PRODUCTION DATABASE WRITES PERFORMED/);
  assert.match(source, /OUTPUT_DIR/);
  assert.match(source, /part5fe1-050-contract-matrix\.json/);
  assert.match(source, /part5fe1-051-contract-matrix\.json/);
  assert.match(source, /part5fe1-ledger-state\.json/);
  assert.match(source, /part5fe1-repair-classification\.json/);
  assert.match(source, /PART-5FE1-PRODUCTION-CONTRACT-REPORT\.md/);
});
