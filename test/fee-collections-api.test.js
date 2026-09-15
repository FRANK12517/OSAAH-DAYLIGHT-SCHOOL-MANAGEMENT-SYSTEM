import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';
import { createFeeCollectionsRepository } from '../src/fee-collections-repository.js';

test('collection detail and correction routes delegate to scoped repository methods', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname\.startsWith\('\/api\/fees\/collections\/'\).*request\.method === 'GET'/);
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

test('school-scoped correction cannot mutate another school collection', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  try { const result = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-b', method: 'PATCH', headers: { Authorization: `Bearer ${fixture.accountantToken}`, 'Content-Type': 'application/json' } }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.write(JSON.stringify({ amount_received_minor: 12000, reason: 'Cross-school attempt' })); req.end(); }); assert.notEqual(result.status, 200); assert.equal(fixture.rows.find((r) => r.id === 'collection-test-b').amount_received_minor, 99000); assert.equal(fixture.corrections.length, 0); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('teacher, parent, and anonymous users cannot correct collections', async () => {
  const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  const call = (token) => new Promise((resolve, reject) => { const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`; const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-1', method: 'PATCH', headers }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.write(JSON.stringify({ amount_received_minor: 12000, reason: 'Unauthorized attempt' })); req.end(); });
  try { assert.ok(fixture.auth.authenticate(fixture.teacherToken)); assert.ok(fixture.auth.authenticate(fixture.parentToken)); for (const [token, expected] of [[fixture.teacherToken, 400], [fixture.parentToken, 400], [undefined, 401]]) { const before = fixture.rows[0].amount_received_minor; const audits = fixture.corrections.length; const result = await call(token); assert.equal(result.status, expected); assert.equal(fixture.rows[0].amount_received_minor, before); assert.equal(fixture.corrections.length, audits); } } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('correction rejects every forbidden mutation field', async () => {
  for (const field of ['school_id','recorded_by','collection_type','class_id','collection_date','academic_year_id','term_id']) {
    const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
    try { const body = { amount_received_minor: 12000, reason: 'Forbidden field acceptance test', [field]: 'forged' }; const result = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-1', method: 'PATCH', headers: { Authorization: `Bearer ${fixture.accountantToken}`, 'Content-Type': 'application/json' } }, (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: text })); }); req.on('error', reject); req.write(JSON.stringify(body)); req.end(); }); assert.equal(result.status, 400, field); assert.equal(fixture.rows[0].amount_received_minor, 10000, field); assert.equal(fixture.corrections.length, 0, field); } finally { await new Promise((resolve) => server.close(resolve)); }
  }
});

test('correction rejects invalid amounts and reasons without mutation', async () => {
  const cases = [{ amount_received_minor: -1, reason: 'Validation test' }, { amount_received_minor: 12000.5, reason: 'Validation test' }, { amount_received_minor: 'abc', reason: 'Validation test' }, { reason: 'Validation test' }, { amount_received_minor: 12000 }, { amount_received_minor: 12000, reason: '' }, { amount_received_minor: 12000, reason: '   ' }];
  for (const body of cases) { const fixture = createAuthenticatedFinanceFixture(); const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve)); try { const result = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/api/fees/collections/collection-test-1', method: 'PATCH', headers: { Authorization: `Bearer ${fixture.accountantToken}`, 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.write(JSON.stringify(body)); req.end(); }); assert.equal(result, 400); assert.equal(fixture.rows[0].amount_received_minor, 10000); assert.equal(fixture.corrections.length, 0); } finally { await new Promise((resolve) => server.close(resolve)); } }
});
test('authenticated POST persists and can be reloaded', async () => { const f=createAuthenticatedFinanceFixture(); const server=createServer(f.app); await new Promise(r=>server.listen(0,r)); try { const result=await new Promise((resolve,reject)=>{const req=httpRequest({port:server.address().port,path:'/api/fees/collections',method:'POST',headers:{Authorization:`Bearer ${f.accountantToken}`,'Content-Type':'application/json'}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});req.on('error',reject);req.write(JSON.stringify({collectionType:'CANTEEN',classId:'p4',collectionDate:'2026-09-15',expectedAmountMinor:20000,amountReceivedMinor:10000,academicYearId:'2026',termId:'1'}));req.end();}); assert.equal(result.status,201); const id=result.body.id; assert.ok(id); assert.equal(f.rows.some(r=>r.id===id),true); const get=await new Promise((resolve,reject)=>{const req=httpRequest({port:server.address().port,path:`/api/fees/collections/${id}`,headers:{Authorization:`Bearer ${f.accountantToken}`}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});req.on('error',reject);req.end();}); assert.equal(get.status,200); assert.equal(get.body.id,id); const list=await new Promise((resolve,reject)=>{const req=httpRequest({port:server.address().port,path:'/api/fees/collections',headers:{Authorization:`Bearer ${f.accountantToken}`}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});req.on('error',reject);req.end();}); assert.equal(list.status,200); } finally { await new Promise(r=>server.close(r)); } });
test('reports route cannot be captured as a collection id', async () => { const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8'); assert.match(source, /pathname !== '\/api\/fees\/collections\/reports'/); });
test('collection public responses retain snake_case monetary fields', async () => { const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8'); assert.match(source, /amount_received_minor/); });
test('authenticated LIST is tenant-isolated by exact collection IDs', async () => { const f=createAuthenticatedFinanceFixture(); const server=createServer(f.app); await new Promise(r=>server.listen(0,r)); try { const result=await new Promise((resolve,reject)=>{const req=httpRequest({port:server.address().port,path:'/api/fees/collections',headers:{Authorization:`Bearer ${f.accountantToken}`}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});req.on('error',reject);req.end();}); assert.equal(result.status,200); const ids=(Array.isArray(result.body)?result.body:result.body.rows??[]).map(r=>r.id); assert.ok(ids.includes('collection-test-1')); assert.ok(!ids.includes('collection-test-b')); } finally { await new Promise(r=>server.close(r)); } });
test('PATCH state survives a new repository instance', async () => { const f=createAuthenticatedFinanceFixture(); const repo=createFeeCollectionsRepository({adapter:f.database}); await repo.correctCollection('collection-test-1',{amountReceivedMinor:13000,reason:'Reload verification'},f.accountant); const fresh=createFeeCollectionsRepository({adapter:f.database}); const row=await fresh.getCollectionById('collection-test-1',f.accountant); assert.equal(row.amount_received_minor,13000); });
test('unsafe integer correction is rejected without audit', async () => { const f=createAuthenticatedFinanceFixture(); const server=createServer(f.app); await new Promise(r=>server.listen(0,r)); try { const status=await new Promise((resolve,reject)=>{const req=httpRequest({port:server.address().port,path:'/api/fees/collections/collection-test-1',method:'PATCH',headers:{Authorization:`Bearer ${f.accountantToken}`,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({amount_received_minor:Number.MAX_SAFE_INTEGER+1,reason:'Unsafe'}));}); assert.equal(status,400); assert.equal(f.corrections.length,0); } finally { await new Promise(r=>server.close(r)); } });


test('collection detail and correction execute through real HTTP dispatch', async () => {
  const fixture = createAuthenticatedFinanceFixture();
  const server = createServer(fixture.app); await new Promise((resolve) => server.listen(0, resolve));
  try {
    const request = (method, path, body) => new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: `Bearer ${fixture.accountantToken}`, 'Content-Type': 'application/json' } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); });
    const detail = await request('GET', '/api/fees/collections/collection-test-1'); assert.equal(detail.status, 200, JSON.stringify(detail)); assert.equal(detail.body.id, 'collection-test-1');
    const patched = await request('PATCH', '/api/fees/collections/collection-test-1', { amount_received_minor: 12000, reason: 'Cashbook reconciliation' }); assert.equal(patched.status, 200); assert.equal(patched.body.afterAmountReceivedMinor, 12000); assert.equal(fixture.corrections.length, 1); assert.equal(fixture.corrections[0].before, 10000); assert.equal(fixture.corrections[0].after, 12000); const after = await request('GET', '/api/fees/collections/collection-test-1'); assert.equal(after.status, 200); assert.equal(after.body.amount_received_minor, 12000);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
