import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scripts/production-migration-ledger-inventory.mjs', import.meta.url), 'utf8');
const sqlWriteWords = [
  'INS' + 'ERT', 'UP' + 'DATE', 'DEL' + 'ETE', 'ALT' + 'ER', 'CRE' + 'ATE',
  'DR' + 'OP', 'TRUNC' + 'ATE', 'REPL' + 'ACE', 'C' + 'ALL', 'S' + 'ET'
];

test('production migration ledger inventory is structurally read-only', () => {
  const normalized = source.toUpperCase();
  for (const word of sqlWriteWords) assert.equal(normalized.includes(`${word} `), false, `forbidden SQL keyword found: ${word}`);
  assert.doesNotMatch(source, /migration:(apply|baseline)|migration\.apply|recordBaseline|recordApplied/i);
});
