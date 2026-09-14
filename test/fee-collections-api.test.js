import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('collection detail and correction routes delegate to scoped repository methods', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname\.startsWith\('\/api\/fees\/collections\/'\) && request\.method === 'GET'/);
  assert.match(source, /feeCollections\.getCollectionById\(pathname\.split\('\/'\)\.pop\(\),user\)/);
  assert.match(source, /pathname\.startsWith\('\/api\/fees\/collections\/'\) && request\.method === 'PATCH'/);
  assert.match(source, /feeCollections\.correctCollection\(pathname\.split\('\/'\)\.pop\(\),body,user\)/);
  assert.match(source, /Unsupported correction field/);
});

test('collection correction route rejects ownership and metadata mutation fields', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /new Set\(\['amount_received_minor','reason'\]\)/);
});
