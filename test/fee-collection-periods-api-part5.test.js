import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthenticatedFinanceFixture } from './helpers/authenticated-finance-fixture.js';

function post(port, token, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ port, path: '/api/fees/collections', method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, response => { let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) })); });
    request.on('error', reject); request.end(JSON.stringify(body));
  });
}

test('server rejects Vacation Classes for Canteen Collection', async () => {
  const fixture = createAuthenticatedFinanceFixture();
  const server = createServer(fixture.app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const result = await post(server.address().port, fixture.accountantToken, { collectionType: 'CANTEEN', collectionDate: '2026-09-23', collectionPeriod: 'Vacation Classes', termId: 'Vacation Classes', amountReceivedMinor: 1000 });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /Canteen|term|period/i);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
