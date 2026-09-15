import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';

test('collection detail and correction routes delegate to scoped repository methods', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname\.startsWith\('\/api\/fees\/collections\/'\) && request\.method === 'GET'/);
  assert.match(source, /feeCollections\.getCollectionById\(pathname\.split\('\/'\)\.pop\(\),user\)/);
  assert.match(source, /pathname\.startsWith\('\/api\/fees\/collections\/'\) && request\.method === 'PATCH'/);
  assert.match(source, /feeCollections\.correctCollection\(pathname\.split\('\/'\)\.pop\(\),\{amountReceivedMinor:body\.amount_received_minor,reason:body\.reason\},user\)/);
  assert.match(source, /Unsupported correction field/);
});

test('collection correction route rejects ownership and metadata mutation fields', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /new Set\(\['amount_received_minor','reason'\]\)/);
});

test('unknown collection detail returns not-found for authenticated accountant', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  try { const result = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/missing', headers: { Authorization: `Bearer ${fixture.accountantToken}` } }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null })); }); req.on('error', reject); req.end(); }); assert.equal(result.status, 404); assert.equal(result.body.error, 'Not found.'); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('school-scoped detail hides another school collection', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  try { const result = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-b', headers: { Authorization: `Bearer ${fixture.accountantToken}` } }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); }); assert.equal(result.status, 404); assert.doesNotMatch(result.body, /99000|school-test-b/); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('teacher, parent, and anonymous users cannot correct collections', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  const call = (token) => new Promise((resolve, reject) => { const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`; const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-1', method: 'PATCH', headers }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.write(JSON.stringify({ amount_received_minor: 12000, reason: 'Unauthorized attempt' })); req.end(); });
  try { for (const token of [fixture.teacherToken, fixture.parentToken, undefined]) { const result = await call(token); assert.notEqual(result.status, 200); } } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('collection detail and correction execute through real HTTP dispatch', async () => {
  const fixture = createAuthenticatedFinanceFixture();
  const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  try {
    const request = (method, path, body) => new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: `Bearer ${fixture.accountantToken}`, 'Content-Type': 'application/json' } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); });
    const detail = await request('GET', '/api/fees/collections/collection-test-1'); assert.equal(detail.status, 200, JSON.stringify(detail)); assert.equal(detail.body.id, 'collection-test-1');
    const patched = await request('PATCH', '/api/fees/collections/collection-test-1', { amount_received_minor: 12000, reason: 'Cashbook reconciliation' }); assert.equal(patched.status, 200); assert.equal(patched.body.afterAmountReceivedMinor, 12000);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
