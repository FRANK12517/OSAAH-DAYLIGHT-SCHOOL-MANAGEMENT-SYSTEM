import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createFeeService } from '../src/fees.js';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';
import { createApp } from '../src/server.mjs';

const pagePath = new URL('../public/finance-canonical.html', import.meta.url);

function get(port, path, token) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ port, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: body ? JSON.parse(body) : null }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('canonical finance page declares supported modules and never contains the removed generic fallback', async () => {
  const source = await readFile(pagePath, 'utf8');
  assert.doesNotMatch(source, /Authorized financial view/);
  assert.doesNotMatch(source, /server-backed data[^<]*card/);
  for (const route of ['/finance', '/fees', '/fees/students', '/fees/payments', '/fees/receipts', '/finance/receipts', '/fees/statements', '/fees/invoices', '/fees/structure', '/fees/arrears']) assert.match(source, new RegExp(`'${route.replaceAll('/', '\\/')}'`));
  assert.match(source, /loader:'deferred'/);
  assert.match(source, /data-functional-module/);
  assert.match(source, /data-state=\"\$\{type \|\| 'info'\}\"/);
  assert.match(source, /'empty'/);
});

test('receipt aliases use one canonical loader and preserve both routes', async () => {
  const source = await readFile(pagePath, 'utf8');
  const routeMatches = [...source.matchAll(/'\/(?:fees|finance)\/receipts': \{[^}]*loader:'receipts'/g)];
  assert.equal(routeMatches.length, 2);
  assert.equal((source.match(/async function loadReceipts\(/g) || []).length, 1);
  assert.match(source, /api\/fees\/receipts\/\$\{encodeURIComponent\(row\.receiptNumber\)\}\/pdf/);
});

test('fee service exposes school-scoped published structures without creating another data source', () => {
  const fees = createFeeService({ schoolId: 'school-a' });
  const actor = { id: 'accountant-a', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-a', permissions: new Set(['fees.read', 'fees.configure']) };
  const created = fees.addFee({ type: 'TUITION', amount: 1200, academicYearId: '2026', termId: '1' }, { ...actor, permissions: new Set(['fees.write']) });
  fees.publishFee(created.id, { ...actor, permissions: new Set(['fees.read', 'fees.write', 'fees.configure', '*']) });
  assert.equal(fees.listStructures(actor).length, 1);
  assert.throws(() => fees.listStructures({ ...actor, schoolId: 'school-b' }), /Cross-school/);
});

test('supported financial read APIs enforce authorization and authenticated school scope', async () => {
  const fixture = createAuthenticatedFinanceFixture();
  const financeFees = createFeeService({ schoolId: fixture.schoolA });
  const invoice = financeFees.invoice({ studentId: 'student-a', permanentStudentId: 'PSID-A', lineItems: [{ type: 'TUITION', amount: 1200 }] }, fixture.accountant);
  financeFees.pay({ invoiceNumber: invoice.invoiceNumber, amount: 300, method: 'BANK' }, fixture.accountant);
  const app = createApp({ auth: fixture.auth, fees: financeFees });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    for (const path of ['/api/fees/invoices', '/api/fees/payments', '/api/fees/receipts', '/api/fees/structures']) {
      const result = await get(port, path, fixture.accountantToken);
      assert.equal(result.status, 200, path);
      const records = result.body[path.endsWith('invoices') ? 'invoices' : path.endsWith('payments') ? 'payments' : path.endsWith('receipts') ? 'receipts' : 'structures'];
      assert.equal(records.length, path.endsWith('invoices') || path.endsWith('payments') || path.endsWith('receipts') ? 1 : 0, path);
    }
    for (const path of ['/api/fees/invoices', '/api/fees/payments', '/api/fees/receipts', '/api/fees/structures']) {
      const result = await get(port, path, fixture.teacherToken);
      assert.equal(result.status, 403, path);
    }
    assert.equal((await get(port, '/api/fees/invoices?studentId=student-from-another-school', fixture.accountantToken)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('logout and unauthenticated direct access remain protected for the new finance endpoints', async () => {
  const fixture = createAuthenticatedFinanceFixture();
  const server = createServer(fixture.app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    for (const path of ['/api/fees/invoices', '/api/fees/payments', '/api/fees/receipts', '/api/fees/structures']) assert.equal((await get(port, path)).status, 401, path);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
