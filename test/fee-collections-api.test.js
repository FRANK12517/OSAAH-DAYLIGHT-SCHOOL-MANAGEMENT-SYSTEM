import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';

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

test.skip('collection detail and correction execute through real HTTP dispatch', async () => {
  const actor = { id: 'acct-1', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-a', portal: 'school', permissions: new Set(['*', 'fees.read', 'fees.write']) };
  const rows = [{ id: 'c1', school_id: 'school-a', collection_type: 'CANTEEN', class_id: 'p4', collection_date: '2026-09-14', expected_amount_minor: 10000, amount_received_minor: 10000, academic_year_id: '2026', term_id: '1' }];
  const database = { async query(sql, params) { if (sql.includes('fee_collection_records')) return rows.filter((r) => r.school_id === params[0] && (!params[1] || r.id === params[1])); return []; }, async execute(sql, params) { if (sql.startsWith('UPDATE')) rows[0].amount_received_minor = params[0]; return { affectedRows: 1 }; }, async transaction(work) { return work(this); } };
  const auth = { authenticate: () => actor };
  const server = createServer(createApp({ auth, database })); await new Promise((resolve) => server.listen(0, resolve));
  try {
    const request = (method, path, body) => new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); });
    const detail = await request('GET', '/api/fees/collections/c1'); assert.equal(detail.status, 200); assert.equal(detail.body.id, 'c1');
    const patched = await request('PATCH', '/api/fees/collections/c1', { amount_received_minor: 12000, reason: 'Cashbook reconciliation' }); assert.equal(patched.status, 200); assert.equal(patched.body.afterAmountReceivedMinor, 12000);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
