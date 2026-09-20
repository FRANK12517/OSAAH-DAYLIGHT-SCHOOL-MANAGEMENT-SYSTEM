import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createFeeCollectionsRepository } from '../src/fee-collections-repository.js';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { createServer, request as httpRequest } from 'node:http';

const actor = { id: 'accountant-1', schoolId: 'school-a', roleKey: 'ACCOUNTANT_BURSAR', permissions: new Set(['fees.read', 'fees.write', 'finance.read']) };
const classes = ['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3'].map((name, index) => ({ id: `class-${index + 1}`, name }));

function repositoryFixture({ classRows = [{ id: 'class-1' }], studentRows = [{ id: 'student-1', schoolId: 'school-a', classId: 'class-1', status: 'ACTIVE' }] } = {}) {
  const executed = [];
  const adapter = {
    async query(sql, params = []) {
      if (sql.includes('FROM fee_structures')) return params[0] === 'fee-1' ? [{ id: 'fee-1' }] : [];
      if (sql.includes('FROM academic_years')) return params[0] === 'year-1' ? [{ id: 'year-1' }] : [];
      if (sql.includes('FROM terms')) return params[0] === 'term-1' ? [{ id: 'term-1' }] : [];
      if (sql.includes('FROM classes')) return classRows;
      if (sql.includes('FROM students')) return studentRows;
      if (sql.includes('FROM fee_obligations')) return [];
      return [];
    },
    async execute(sql, params) { executed.push({ sql, params }); },
    async transaction(work) { return work(this); }
  };
  adapter.strictValidation = true;
  return { adapter, executed };
}

function http(server, path, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ port: server.address().port, path, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (response) => { let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null })); });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
}

test('Fee Setup uses backend canonical options and represents Nursery 1 through JHS 3 once', async () => {
  const source = await readFile(new URL('../public/fee-setup.html', import.meta.url), 'utf8');
  assert.match(source, /api\/fee-setup\/options/);
  assert.match(source, /classId/);
  assert.doesNotMatch(source, /<option[^>]+value=["']Nursery 1/);
  assert.deepEqual(new Set(classes.map((item) => item.name)).size, 13);
  assert.deepEqual(CORE_LEVELS.length, 13);
});

test('Fee Setup options endpoint is school-scoped and returns canonical classes', async () => {
  const auth = createAuthService();
  const login = auth.login({ username: 'bursar@osaah.edu.gh', password: 'Bursar123!', portal: 'school' });
  const database = { query: async (sql) => {
    if (sql.includes('FROM academic_years')) return [{ id: 'year-1', name: '2026/2027' }];
    if (sql.includes('FROM terms')) return [{ id: 'term-1', name: 'First Term' }];
    if (sql.includes('FROM fee_structures')) return [{ id: 'fee-1', name: 'Tuition' }];
    if (sql.includes('FROM classes c')) return classes;
    return [];
  } };
  const server = createServer(createApp({ auth, database, aiEnabled: false })); await new Promise((resolve) => server.listen(0, resolve));
  try { const result = await http(server, '/api/fee-setup/options', { token: login.token }); assert.equal(result.status, 200); assert.equal(result.body.academicYears[0].id, 'year-1'); assert.equal(result.body.terms[0].id, 'term-1'); assert.equal(result.body.classes.length, 13); assert.equal(result.body.classes[4].name, 'Basic 1'); } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Fee publication validates specific class and whole-school targets without duplicating fee definitions', async () => {
  const specific = repositoryFixture();
  const repo = createFeeCollectionsRepository({ adapter: specific.adapter, strictValidation: true });
  const result = await repo.publishFeeObligations({ scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-1', academicYearId: 'year-1', termId: 'term-1', classId: 'class-1', amountMinor: 12500 }, actor);
  assert.equal(result.created_count, 1); assert.equal(specific.executed.length, 1); assert.equal(specific.executed[0].params[5], 'SPECIFIC_CLASS'); assert.equal(specific.executed[0].params[6], 'class-1');
  const whole = repositoryFixture(); const wholeRepo = createFeeCollectionsRepository({ adapter: whole.adapter, strictValidation: true }); const wholeResult = await wholeRepo.publishFeeObligations({ scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-1', academicYearId: 'year-1', termId: 'term-1', amountMinor: 12500 }, actor); assert.equal(wholeResult.created_count, 1); assert.equal(whole.executed[0].params[5], 'WHOLE_SCHOOL'); assert.equal(whole.executed[0].params[6], null);
});

test('Fee publication rejects malformed amount, missing class, invalid academic period, and cross-school class', async () => {
  const repo = createFeeCollectionsRepository({ adapter: repositoryFixture().adapter, strictValidation: true });
  await assert.rejects(() => repo.publishFeeObligations({ scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-1', academicYearId: 'year-1', termId: 'term-1', classId: 'class-1', amountMinor: 0 }, actor), /Invalid amount/);
  await assert.rejects(() => repo.publishFeeObligations({ scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-1', academicYearId: 'year-1', termId: 'term-1', amountMinor: 100 }, actor), /Class is required/);
  await assert.rejects(() => repo.publishFeeObligations({ scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-1', academicYearId: 'missing', termId: 'term-1', amountMinor: 100 }, actor), /Academic year not found/);
  const otherSchool = createFeeCollectionsRepository({ adapter: repositoryFixture({ classRows: [] }).adapter, strictValidation: true });
  await assert.rejects(() => otherSchool.publishFeeObligations({ scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-1', academicYearId: 'year-1', termId: 'term-1', classId: 'other-school-class', amountMinor: 100 }, actor), /Class not found/);
});

test('Fee Setup and parent Fee Hub routes expose safe errors and retain parent visibility query', async () => {
  const setup = await readFile(new URL('../public/fee-setup.html', import.meta.url), 'utf8');
  const serverSource = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const parentSource = await readFile(new URL('../src/parent-fee-obligations-repository.js', import.meta.url), 'utf8');
  assert.match(setup, /Unable to load Fee Setup data/); assert.match(setup, /Unable to publish this fee/); assert.match(serverSource, /Unable to load Fee Setup data/); assert.doesNotMatch(serverSource, /DATABASE_URL.*error\.message/); assert.match(parentSource, /parent_student_links/); assert.match(parentSource, /permanent_student_id/);
});
