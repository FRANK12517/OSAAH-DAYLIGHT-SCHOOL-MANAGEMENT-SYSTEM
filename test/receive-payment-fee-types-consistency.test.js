import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createFeeTypeRegistry } from '../src/fee-types.js';

const SCHOOL_ID = 'sch_default_01';
const accountant = {
  id: 'accountant-production',
  schoolId: SCHOOL_ID,
  roleKey: 'ACCOUNTANT_BURSAR',
  portal: 'school',
  permissions: new Set(['fees.read', 'finance.read'])
};

function request(server, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

function databaseFixture() {
  return {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'ay-1', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', name: 'First Term', academicYearId: 'ay-1' }];
      if (sql.includes('FROM fee_types')) return [];
      if (sql.includes('FROM classes c')) return [{ id: 'class-1', name: 'Basic 1', level: '1' }];
      return [];
    }
  };
}

test('Fee options preserve configured year-specific terms and reuse the canonical fee-type source when database rows are empty', async () => {
  const auth = { authenticateAsync: async () => accountant };
  const feeTypes = createFeeTypeRegistry({ schoolId: SCHOOL_ID });
  const server = createServer(createApp({ auth, database: databaseFixture(), feeTypes, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const options = await request(server, '/api/fee-setup/options');
    const canonical = await request(server, '/api/fees/types');
    assert.equal(options.status, 200);
    assert.equal(canonical.status, 200);
    assert.deepEqual(options.body.terms.map((item) => item.name), ['1st Term']);
    assert.equal(options.body.terms[0].id, 'term-1');
    assert.equal(options.body.terms[0].academicYearId, 'ay-1');
    assert.equal(options.body.canPublish, false);
    assert.equal(options.body.feeTypes.length, 39);
    assert.equal(canonical.body.feeTypes.length, 39);
    assert.deepEqual(new Set(options.body.feeTypes.map((item) => item.id)), new Set(canonical.body.feeTypes.map((item) => item.id)));
    assert.ok(options.body.feeTypes.some((item) => item.id === 'TUITION'));
    assert.ok(options.body.feeTypes.some((item) => item.id === 'EXAMINATION'));
    assert.ok(options.body.feeTypes.some((item) => item.id === 'TRANSPORT'));
    assert.ok(options.body.feeTypes.some((item) => item.id === 'HOSTEL'));

    const createAttempt = await request(server, '/api/fees/types', { method: 'POST', body: { code: 'NEW_TYPE', name: 'Should Not Be Created' } });
    assert.equal(createAttempt.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
