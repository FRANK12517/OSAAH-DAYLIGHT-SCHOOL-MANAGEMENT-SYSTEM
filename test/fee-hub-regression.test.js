import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { parsePositiveGhsAmountToMinorUnits } from '../public/fee-amount.js';
import { createFeeCollectionsRepository } from '../src/fee-collections-repository.js';
import { createParentFeeObligationsRepository } from '../src/parent-fee-obligations-repository.js';
import { createApp } from '../src/server.mjs';
import { createStudentService } from '../src/students.js';

const writer = { id: 'accountant-1', schoolId: 'sch_default_01', roleKey: 'ACCOUNTANT_BURSAR', permissions: new Set(['fees.write', 'fees.read']) };
const reader = { ...writer, permissions: new Set(['fees.read']) };

test('Fee Hub amount validation accepts positive Ghana cedi values as exact pesewas', () => {
  for (const [input, expected] of [['100', 10000], ['250.50', 25050], ['1200.75', 120075], ['0.50', 50]]) {
    assert.equal(parsePositiveGhsAmountToMinorUnits(input), expected, input);
  }
});

test('Fee Hub amount validation rejects empty, zero, negative, malformed, over-precision, and unsafe amounts', () => {
  for (const input of ['', ' ', '0', '0.00', '-1', '-0.50', 'abc', '1,000', '1e2', '10.001', '.50', '90071992547409.92']) {
    assert.throws(() => parsePositiveGhsAmountToMinorUnits(input), undefined, input);
  }
});

function publicationAdapter() {
  const obligations = [];
  const statements = [];
  const feeTypes = new Map();
  const adapter = {
    obligations,
    statements,
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes('FROM fee_structures')) return [];
      if (sql.includes('FROM fee_types')) {
        if (sql.includes('code=?')) return [...feeTypes.values()].filter((row) => row.schoolId === params[0] && row.code === params[1] && row.isActive);
        return params[1] === writer.schoolId && (params[0] === 'fee-type-admission' || feeTypes.has(`${params[1]}:${params[0]}`))
          ? [{ id: params[0] === 'fee-type-admission' ? params[0] : feeTypes.get(`${params[1]}:${params[0]}`).id }]
          : [];
      }
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1' }];
      if (sql.includes('FROM classes')) return [{ id: 'class-1' }];
      if (sql.includes('FROM students')) return [{ id: 'student-1', schoolId: writer.schoolId, classId: 'class-1', status: 'ACTIVE' }];
      if (sql.includes('FROM fee_obligations fo')) return obligations.filter((row) => row.schoolId === params[0] && row.status === 'PUBLISHED').map((row) => ({ id: row.feeStructureId, feeType: 'Admission Fee', customFeeTypeName: null, academicYearId: row.academicYearId, termId: row.termId, scope: row.scope, classId: row.classId, amountMinor: row.amountMinor, status: row.status, publishedAt: row.publishedAt, obligationCount: 1 }));
      if (sql.includes('FROM fee_obligations') && sql.includes('fee_structure_id=?')) return obligations.filter((row) => row.schoolId === params[0] && row.feeStructureId === params[1] && row.academicYearId === params[2] && row.termId === params[3] && row.status === 'PUBLISHED');
      if (sql.includes('FROM fee_obligations') && sql.includes('idempotency_key=?')) return obligations.filter((row) => row.schoolId === params[0] && row.idempotency_key === params[1]);
      if (sql.includes('FROM fee_obligations')) return obligations.filter((row) => row.schoolId === params[0]);
      return [];
    },
    async execute(sql, params = []) {
      statements.push({ sql, params });
      if (sql.startsWith('INSERT INTO fee_types')) feeTypes.set(`${params[1]}:${params[2]}`, { id: params[0], schoolId: params[1], code: params[2], name: params[3], isActive: true });
      if (sql.startsWith('INSERT INTO fee_obligations')) obligations.push({ id: params[0], schoolId: params[1], feeStructureId: params[2], academicYearId: params[3], termId: params[4], scope: params[5], classId: params[6], studentId: params[7], student_id: params[7], amountMinor: params[8], status: params[10], publishedAt: params[12], idempotencyKey: params[13], idempotency_key: params[13] });
    },
    async transaction(work) { return work(this); }
  };
  return adapter;
}

test('Fee Setup canonical fee-type IDs persist idempotent published obligations and survive a fresh read', async () => {
  const db = publicationAdapter();
  const repo = createFeeCollectionsRepository({ adapter: db, strictValidation: true });
  const input = { feeStructureId: 'fee-type-admission', scope: 'WHOLE_SCHOOL', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 25050 };
  assert.deepEqual(await repo.publishFeeObligations(input, writer), { eligible_count: 1, created_count: 1, skipped_count: 0 });
  assert.equal(db.obligations.length, 1);
  assert.deepEqual(await repo.publishFeeObligations(input, writer), { eligible_count: 1, created_count: 0, skipped_count: 1 });
  assert.equal(db.obligations.length, 1);
  assert.equal(db.obligations[0].amountMinor, 25050);
  assert.equal(db.obligations[0].status, 'PUBLISHED');
  assert.ok(db.statements.some(({ sql }) => sql.includes('FROM fee_types')));
});

test('Fee publication rejects overlapping Whole School and Specific Class obligations without changing existing fees', async () => {
  const db = publicationAdapter();
  const repo = createFeeCollectionsRepository({ adapter: db, strictValidation: true });
  const base = { feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 25050 };
  await repo.publishFeeObligations({ ...base, scope: 'SPECIFIC_CLASS', classId: 'class-1' }, writer);
  const existing = structuredClone(db.obligations);
  await assert.rejects(() => repo.publishFeeObligations({ ...base, scope: 'WHOLE_SCHOOL' }, writer), /already exists for this student, fee type, and period/);
  assert.deepEqual(db.obligations, existing);
});

test('Fee Setup accepts a legacy Admission fee ID when the persisted fee-type list is empty', async () => {
  const db = publicationAdapter();
  const repo = createFeeCollectionsRepository({ adapter: db, strictValidation: true });
  const input = { feeStructureId: 'ADMISSION_FEES', scope: 'WHOLE_SCHOOL', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 15000 };

  assert.deepEqual(await repo.publishFeeObligations(input, writer), { eligible_count: 1, created_count: 1, skipped_count: 0 });
  assert.equal(db.obligations[0].feeStructureId, 'ADMISSION');
  assert.equal(db.obligations[0].amountMinor, 15000);
  assert.ok(db.statements.some(({ sql, params }) => sql.startsWith('INSERT INTO fee_types') && params[2] === 'ADMISSION'));

  assert.deepEqual(await repo.publishFeeObligations(input, writer), { eligible_count: 1, created_count: 0, skipped_count: 1 });
  assert.equal(db.obligations.length, 1);
});

test('Fee Structure reads persisted published obligations filtered by exact academic year and term', async () => {
  let observed;
  const db = {
    async query(sql, params) {
      observed = { sql, params };
      return [{ id: 'fee-type-admission', customFeeTypeName: null, academicYearId: 'year-2026', termId: 'term-1', scope: 'WHOLE_SCHOOL', classId: null, amountMinor: 25050, status: 'PUBLISHED', publishedAt: '2026-10-10 12:00:00', obligationCount: 4 }];
    }, async execute() {}, async transaction(work) { return work(this); }
  };
  const rows = await createFeeCollectionsRepository({ adapter: db }).listPublishedFeeStructures({ academicYearId: 'year-2026', termId: 'term-1' }, reader);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountMinor, 25050);
  assert.equal(rows[0].obligationCount, 4);
  assert.deepEqual(observed.params, [writer.schoolId, 'year-2026', 'year-2026', 'term-1', 'term-1']);
  assert.match(observed.sql, /status='PUBLISHED'/);
  assert.match(observed.sql, /GROUP BY fo\.fee_structure_id,fo\.academic_year_id,fo\.term_id,fo\.applicability_type,fo\.class_id,fo\.amount_minor,fo\.status/);
});

test('parent fee reads enforce active parent-child linking and published-only visibility server-side', async () => {
  let observed;
  const database = { query: async (sql, params) => { observed = { sql, params }; return []; } };
  await createParentFeeObligationsRepository(database).listForParent({ id: 'parent-1', schoolId: writer.schoolId, roleKey: 'PARENT', portal: 'parent' });
  assert.ok(observed.params.includes('parent-1'));
  assert.match(observed.sql, /psl\.parent_user_id=\?/);
  assert.match(observed.sql, /psl\.link_status='ACTIVE'/);
  assert.match(observed.sql, /fo\.status='PUBLISHED'/);
  await assert.rejects(() => createParentFeeObligationsRepository(database).listForParent({ id: 'parent-2', schoolId: writer.schoolId, roleKey: 'PARENT', portal: 'school' }), /Parent access required/);
});

test('Fee Structure API returns durable published rows and rejects invalid academic context', async () => {
  const calls = [];
  let failStructureRead = false;
  let emptyStructureRead = false;
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years WHERE id=?')) return params[0] === 'year-2026' ? [{ id: 'year-2026' }] : [];
      if (sql.includes('FROM terms WHERE id=?')) return params[0] === 'term-1' && params[1] === 'year-2026' ? [{ id: 'term-1' }] : [];
      if (sql.includes('FROM fee_obligations fo')) {
        if (failStructureRead) throw new Error('database host and SQL details must not reach the client');
        if (emptyStructureRead) return [];
        return [{ id: 'fee-type-admission', feeType: 'Admission Fee', academicYearId: 'year-2026', termId: 'term-1', scope: 'WHOLE_SCHOOL', classId: null, amountMinor: 25050, status: 'PUBLISHED', publishedAt: '2026-10-10 12:00:00', obligationCount: 3 }];
      }
      return [];
    },
    async execute() {},
    async transaction(work) { return work(this); }
  };
  const auth = { authenticateAsync: async () => ({ ...reader, roleKey: 'ACCOUNTANT_BURSAR' }) };
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const get = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const valid = await get('/api/fees/structures?status=PUBLISHED&academicYearId=year-2026&termId=term-1');
    assert.equal(valid.status, 200);
    assert.equal(valid.body.structures[0].feeType, 'Admission Fee');
    assert.equal(valid.body.structures[0].amountMinor, 25050);
    assert.ok(calls.some(({ sql }) => sql.includes('FROM fee_obligations fo')));
    const invalid = await get('/api/fees/structures?status=PUBLISHED&academicYearId=missing&termId=term-1');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_ACADEMIC_CONTEXT');
    emptyStructureRead = true;
    const empty = await get('/api/fees/structures?status=PUBLISHED');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.structures, []);
    emptyStructureRead = false;
    failStructureRead = true;
    const failed = await get('/api/fees/structures?status=PUBLISHED');
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error, 'Fee service is temporarily unavailable.');
    assert.doesNotMatch(failed.body.error, /database host|SQL details/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Fee Setup HTTP publication reaches durable storage and the Fee Structure read API', async () => {
  const db = publicationAdapter();
  const auth = { authenticateAsync: async (token) => token === 'test-accountant' ? { ...writer, roleKey: 'ACCOUNTANT_BURSAR' } : null };
  const server = createServer(createApp({ auth, database: db, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const request = (path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: 'Bearer test-accountant', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const publish = await request('/api/fees/obligations/publish', { method: 'POST', body: { scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: parsePositiveGhsAmountToMinorUnits('250.50') } });
    assert.equal(publish.status, 200);
    assert.equal(publish.body.created_count, 1);
    assert.equal(db.obligations.length, 1);
    assert.equal(db.obligations[0].amountMinor, 25050);
    assert.equal(db.obligations[0].scope, 'WHOLE_SCHOOL');
    const invalidAmount = await request('/api/fees/obligations/publish', { method: 'POST', body: { scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 0 } });
    assert.equal(invalidAmount.status, 400);
    assert.equal(invalidAmount.body.error, 'Invalid amount.');
    const overlappingTarget = await request('/api/fees/obligations/publish', { method: 'POST', body: { scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 25050, classId: 'class-1' } });
    assert.equal(overlappingTarget.status, 409);
    assert.match(overlappingTarget.body.error, /already exists for this student, fee type, and period/);
    assert.equal(db.obligations.length, 1);
    const freshRead = await request('/api/fees/structures?status=PUBLISHED&academicYearId=year-2026&termId=term-1');
    assert.equal(freshRead.status, 200);
    assert.equal(freshRead.body.structures[0].academicYearId, 'year-2026');
    assert.equal(freshRead.body.structures[0].termId, 'term-1');
    assert.equal(freshRead.body.structures[0].scope, 'WHOLE_SCHOOL');
    assert.equal(freshRead.body.structures[0].amountMinor, 25050);

    const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../public/fee-setup.html', import.meta.url), 'utf8'));
    const client = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../public/fee-setup.js', import.meta.url), 'utf8'));
    assert.match(client, /form\.addEventListener\('submit'/);
    assert.match(source, /type="submit" disabled/);
    assert.match(client, /parsePositiveGhsAmountToMinorUnits\(data\.get\('amount'\)\)/);
    assert.match(client, /\/api\/fees\/obligations\/publish/);
    assert.match(source, /GH₵/);
    assert.match(client, /published-fee list could not refresh/);
    assert.match(client, /SPECIFIC_CLASS/);
    assert.match(client, /WHOLE_SCHOOL/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('the displayed Admission Fee setup values publish, refresh, and appear in the linked Parent Portal', async () => {
  const db = publicationAdapter();
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (sql.includes('FROM parent_student_links psl')) {
      assert.equal(params[1], 'parent-1');
      assert.match(sql, /fo\.status='PUBLISHED'/);
      return db.obligations.map((row) => ({
        studentId: 'profile-1', permanentStudentId: 'OSAAH/2026/001', firstName: 'Ama', middleName: null, surname: 'Mensah',
        classId: 'class-1', schoolId: writer.schoolId, obligationId: row.id, feeStructureId: row.feeStructureId,
        academicYearId: row.academicYearId, academicYearName: '2026/2027 Academic Year', termId: row.termId,
        termName: '1st Term', amountMinor: row.amountMinor, customFeeTypeName: null, publishedAt: row.publishedAt,
        targetClassId: null, feeTypeName: 'Admission Fee', status: row.status
      }));
    }
    return originalQuery(sql, params);
  };
  const auth = { authenticateAsync: async (token) => token === 'parent-token'
    ? { id: 'parent-1', schoolId: writer.schoolId, roleKey: 'PARENT', portal: 'parent' }
    : token === 'test-accountant' ? { ...writer, roleKey: 'ACCOUNTANT_BURSAR' } : null };
  const server = createServer(createApp({ auth, database: db, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const request = (path, { method = 'GET', token = 'test-accountant', body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const options = await request('/api/fee-setup/options');
    assert.equal(options.status, 200);
    assert.ok(Array.isArray(options.body.academicYears));
    assert.ok(Array.isArray(options.body.terms));
    assert.ok(Array.isArray(options.body.feeTypes));
    assert.ok(Array.isArray(options.body.classes));
    assert.equal(options.body.canPublish, true);
    const beforePublish = await request('/api/fees/obligations');
    assert.equal(beforePublish.status, 200);
    assert.deepEqual(beforePublish.body, []);

    // These are the IDs behind the displayed labels: 2026/2027 Academic Year, 1st Term, Admission Fee, Whole School.
    const payload = { academicYearId: 'year-2026', termId: 'term-1', feeStructureId: 'ADMISSION', amountMinor: parsePositiveGhsAmountToMinorUnits('150'), scope: 'WHOLE_SCHOOL' };
    const published = await request('/api/fees/obligations/publish', { method: 'POST', body: payload });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual({ created: published.body.created_count, skipped: published.body.skipped_count }, { created: 1, skipped: 0 });

    const refreshed = await request('/api/fees/obligations');
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.length, 1);
    assert.equal(refreshed.body[0].amountMinor, 15000);
    assert.equal(refreshed.body[0].scope, 'WHOLE_SCHOOL');

    const parentView = await request('/api/parent/fee-obligations', { token: 'parent-token' });
    assert.equal(parentView.status, 200);
    assert.equal(parentView.body.children[0].student.permanentStudentId, 'OSAAH/2026/001');
    assert.equal(parentView.body.children[0].obligations[0].feeTypeName, 'Admission Fee');
    assert.equal(parentView.body.children[0].obligations[0].amountMinor, 15000);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('unexpected fee publish database errors do not become misleading HTTP 400 validation responses', async () => {
  const db = publicationAdapter();
  const originalExecute = db.execute.bind(db);
  db.execute = async (sql, params) => {
    if (sql.startsWith('INSERT INTO fee_obligations')) throw Object.assign(new Error('private SQL details must not reach the response'), { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22' });
    return originalExecute(sql, params);
  };
  const auth = { authenticateAsync: async () => ({ ...writer, roleKey: 'ACCOUNTANT_BURSAR' }) };
  const server = createServer(createApp({ auth, database: db, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const body = { scope: 'WHOLE_SCHOOL', feeStructureId: 'ADMISSION', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 15000 };
  let safeLog;
  const originalConsoleError = console.error;
  try {
    console.error = (label, metadata) => { if (label === 'Fee service operation failed') safeLog = metadata; else originalConsoleError(label, metadata); };
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest({ port: server.address().port, path: '/api/fees/obligations/publish', method: 'POST', headers: { Authorization: 'Bearer test-accountant', 'Content-Type': 'application/json' } }, (res) => {
        let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'Fee service is temporarily unavailable.');
    assert.equal(result.body.code, 'ER_BAD_FIELD_ERROR');
    assert.doesNotMatch(JSON.stringify(result.body), /private SQL details/);
    assert.deepEqual(safeLog, { status: 503, code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', validationReason: null });
    assert.doesNotMatch(JSON.stringify(safeLog), /private SQL details/);
  } finally { console.error = originalConsoleError; await new Promise((resolve) => server.close(resolve)); }
});

test('Fee Setup publish API authorizes only the designated school publishing roles', async () => {
  const db = publicationAdapter();
  const roles = new Map(['PROPRIETOR', 'SCHOOL_ADMIN', 'ADMINISTRATOR', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'].map((roleKey) => [`token-${roleKey}`, { ...reader, roleKey }]));
  const auth = { authenticateAsync: async (token) => roles.get(token) ?? (token === 'token-assistant' ? { ...reader, roleKey: 'ASSISTANT_HEADTEACHER' } : null) };
  const server = createServer(createApp({ auth, database: db, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const publish = (token) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path: '/api/fees/obligations/publish', method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 15000 }));
  });
  try {
    for (const roleKey of roles.keys()) assert.equal((await publish(roleKey)).status, 200, `${roleKey} should publish`);
    assert.equal((await publish('token-assistant')).status, 403, 'Assistant Headteacher remains read-only');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Specific Class HTTP publication persists the canonical class target for Fee Structure reads', async () => {
  const db = publicationAdapter();
  const auth = { authenticateAsync: async (token) => token === 'test-accountant' ? { ...writer, roleKey: 'ACCOUNTANT_BURSAR' } : null };
  const server = createServer(createApp({ auth, database: db, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const request = (path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: 'Bearer test-accountant', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const published = await request('/api/fees/obligations/publish', { method: 'POST', body: { scope: 'SPECIFIC_CLASS', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 25050, classId: 'class-1' } });
    assert.equal(published.status, 200);
    assert.equal(published.body.created_count, 1);
    assert.equal(published.body.classId, 'class-1');
    assert.equal(db.obligations[0].scope, 'SPECIFIC_CLASS');
    assert.equal(db.obligations[0].classId, 'class-1');
    const freshRead = await request('/api/fees/structures?status=PUBLISHED&academicYearId=year-2026&termId=term-1');
    assert.equal(freshRead.status, 200);
    assert.equal(freshRead.body.structures[0].scope, 'SPECIFIC_CLASS');
    assert.equal(freshRead.body.structures[0].classId, 'class-1');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Fee publication remains successful when post-commit parent notification lookup fails', async () => {
  const db = publicationAdapter();
  const students = createStudentService({ schoolId: writer.schoolId });
  const auth = { authenticateAsync: async () => ({ ...writer, roleKey: 'ACCOUNTANT_BURSAR' }) };
  const server = createServer(createApp({ auth, database: db, students, aiEnabled: false }));
  students.listStudents = () => { throw new Error('notification lookup is unavailable'); };
  await new Promise((resolve) => server.listen(0, resolve));
  const request = (path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: 'Bearer test-accountant', ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const published = await request('/api/fees/obligations/publish', { method: 'POST', body: { scope: 'WHOLE_SCHOOL', feeStructureId: 'fee-type-admission', academicYearId: 'year-2026', termId: 'term-1', amountMinor: 25050 } });
    assert.equal(published.status, 200);
    assert.equal(published.body.created_count, 1);
    assert.equal(db.obligations.length, 1);
    const listed = await request('/api/fees/obligations');
    assert.equal(listed.status, 200);
    assert.equal(listed.body[0].amountMinor, 25050);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
