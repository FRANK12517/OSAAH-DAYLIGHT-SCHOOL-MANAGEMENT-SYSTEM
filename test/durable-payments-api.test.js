import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { createDurableFeeReader } from '../src/durable-fee-reader.js';

const SCHOOL = 'sch_default_01';
const otherPayment = { id: 'payment-other', school_id: 'school-other', paymentReference: 'PAY-OTHER', receiptNumber: 'RCT-OTHER', invoiceNumber: 'INV-OTHER', studentId: 'student-other', permanentStudentId: 'PS-OTHER', classId: 'class-other', academicYearId: '2026', termId: 'TERM1', amount: '9999.99', method: 'BANK', status: 'VALID', paymentDate: '2026-09-02', createdAt: '2026-09-02T10:00:00Z', enteredBy: 'other-user', receiptStatus: 'VALID', previousBalance: '10000.00', newBalance: '0.01' };
const osaahPayment = { id: 'payment-osaah', school_id: SCHOOL, paymentReference: 'PAY-OSAah-001', receiptNumber: 'RCT-OSAah-001', invoiceNumber: 'INV-OSAah-001', studentId: 'student-osaah', permanentStudentId: 'PS-OSAah-001', classId: 'basic-4', academicYearId: '2026', termId: 'TERM1', amount: '125.50', method: 'MOBILE_MONEY', status: 'COMPLETED', paymentDate: '2026-09-01', createdAt: '2026-09-01T10:00:00Z', enteredBy: 'accountant-osaah', receiptStatus: 'VALID', previousBalance: '300.50', newBalance: '175.00' };

function user(id, username, roleKey, schoolId, permissions) { const salt = `${id}-salt`; return { id, username, passwordHash: `${salt}:${scryptSync('Password123!', salt, 32).toString('hex')}`, portal: 'school', roleKey, schoolId, permissions: new Set(permissions) }; }
function database(paymentRows = [osaahPayment, otherPayment]) {
  return {
    supportsDurableAuthSessions: true,
    async query(sql, params = []) { if (sql.includes('student_fee_payments')) return paymentRows.filter((row) => row.school_id === params[0]); return []; },
    async execute() { return { affectedRows: 1 }; },
    async transaction(work) { return work(this); }
  };
}
function request(server, path, token) { return new Promise((resolve, reject) => { const req = fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); req.then(async (response) => resolve({ status: response.status, body: await response.json() })).catch(reject); }); }

test('durable fee reader preserves payment, receipt, invoice, student, and balance relationships', async () => {
  const actor = user('accountant-osaah', 'accountant@osaah.test', 'ACCOUNTANT_BURSAR', SCHOOL, ['fees.read']);
  const result = await createDurableFeeReader({ adapter: database([osaahPayment]) }).listPayments({}, actor);
  assert.deepEqual(result[0], { id: 'payment-osaah', schoolId: SCHOOL, receiptNumber: 'RCT-OSAah-001', transactionReference: 'PAY-OSAah-001', invoiceNumber: 'INV-OSAah-001', studentName: null, className: null, academicYear: '2026', term: 'TERM1', feeType: null, studentId: 'student-osaah', permanentStudentId: 'PS-OSAah-001', classId: 'basic-4', academicYearId: '2026', termId: 'TERM1', amount: 125.5, method: 'MOBILE_MONEY', status: 'COMPLETED', createdAt: '2026-09-01T10:00:00Z', paymentDate: '2026-09-01', providerReference: null, enteredBy: 'accountant-osaah', issuer: null, receiptStatus: 'VALID', previousBalance: 300.5, balance: 175 });
});

test('durable fee reader projects canonical payment year and term without legacy invoice display columns', async () => {
  const queries = [];
  const base = database([osaahPayment]);
  const adapter = { ...base, async query(sql, params) { queries.push(sql); return base.query(sql, params); } };
  const actor = user('accountant-osaah', 'accountant@osaah.test', 'ACCOUNTANT_BURSAR', SCHOOL, ['fees.read']);
  await createDurableFeeReader({ adapter }).listPayments({}, actor);
  assert.match(queries[0], /NULL AS studentName/);
  assert.match(queries[0], /NULL AS className/);
  assert.match(queries[0], /p\.academic_year_id AS academicYear/);
  assert.match(queries[0], /p\.term_id AS term/);
  assert.doesNotMatch(queries[0], /i\.(?:student_name|class_name|academic_year|term)\b/);
});

test('durable fee reader falls back when legacy payments lack optional created_at and provider_reference columns', async () => {
  const queries = [];
  const actor = user('accountant-osaah', 'accountant@osaah.test', 'ACCOUNTANT_BURSAR', SCHOOL, ['fees.read']);
  const adapter = { async query(sql) {
    queries.push(sql);
    if (sql.includes('p.created_at')) throw Object.assign(new Error("Unknown column 'p.created_at' in 'order clause'"), { code: 'ER_BAD_FIELD_ERROR' });
    if (sql.includes('p.provider_reference')) throw Object.assign(new Error("Unknown column 'p.provider_reference' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' });
    return [{ ...osaahPayment, createdAt: osaahPayment.paymentDate, providerReference: null }];
  } };
  const reader = createDurableFeeReader({ adapter });
  const payments = await reader.listPayments({}, actor);
  assert.equal(payments[0].createdAt, osaahPayment.paymentDate);
  assert.equal(payments[0].providerReference, null);
  assert.equal(queries.length, 3);
  assert.match(queries[2], /p\.payment_date AS createdAt/);
  assert.match(queries[2], /NULL AS providerReference/);
  assert.match(queries[2], /ORDER BY p\.payment_date DESC, p\.id DESC/);
  await reader.listPayments({}, actor);
  assert.equal(queries.length, 4);
  assert.doesNotMatch(queries[3], /p\.created_at|p\.provider_reference/);
});


test('durable receipt detail preserves canonical identity, balances, and school isolation', async () => {
  const accountant = user('accountant-osaah', 'accountant@osaah.test', 'ACCOUNTANT_BURSAR', SCHOOL, ['fees.read']);
  const reader = createDurableFeeReader({ adapter: database([osaahPayment, otherPayment]) });
  const receipt = await reader.getReceipt('RCT-OSAah-001', accountant);
  assert.equal(receipt.schoolId, SCHOOL);
  assert.equal(receipt.permanentStudentId, 'PS-OSAah-001');
  assert.equal(receipt.amount, 125.5);
  assert.equal(receipt.balance, 175);
  assert.equal(receipt.transactionReference, 'PAY-OSAah-001');
  assert.equal(await reader.getReceipt('RCT-OTHER', accountant), null);
  assert.equal(await reader.getReceipt('RCT-OSAah-001', { ...accountant, schoolId: 'school-other' }), null);
});

test('authenticated accountant reads only persisted OSAAH Payments and empty data is a valid response', async () => {
  const accountant = user('accountant-osaah', 'accountant@osaah.test', 'ACCOUNTANT_BURSAR', SCHOOL, ['fees.read']);
  const teacher = user('teacher-osaah', 'teacher@osaah.test', 'TEACHER', SCHOOL, ['students.read']);
  const auth = createAuthService({ users: [accountant, teacher], sessionSecret: 'test-only-session-secret-0123456789012345' });
  const accountantToken = auth.login({ username: accountant.username, password: 'Password123!', portal: 'school' }).token;
  const teacherToken = auth.login({ username: teacher.username, password: 'Password123!', portal: 'school' }).token;
  const app = createApp({ auth, database: database() });
  const server = createServer(app); await new Promise((resolve) => server.listen(0, resolve));
  try {
    const payments = await request(server, '/api/fees/payments', accountantToken);
    assert.equal(payments.status, 200);
    assert.deepEqual(payments.body.payments.map((row) => row.id), ['payment-osaah']);
    assert.equal(payments.body.payments[0].amount, 125.5);
    const receipt = await request(server, '/api/fees/receipts/RCT-OSAah-001', accountantToken);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.receipt.permanentStudentId, 'PS-OSAah-001');
    assert.equal(receipt.body.receipt.amount, 125.5);
    const preview = await fetch(`http://127.0.0.1:${server.address().port}/api/fees/receipts/RCT-OSAah-001/preview`, { headers: { Authorization: `Bearer ${accountantToken}` } });
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /RCT-OSAah-001/);
    assert.equal((await request(server, '/api/fees/payments?studentId=student-other', accountantToken)).body.payments.length, 0);
    assert.equal((await request(server, '/api/fees/payments?schoolId=school-other', accountantToken)).body.payments.length, 1);
    assert.equal((await request(server, '/api/fees/payments', teacherToken)).status, 403);
    assert.equal((await request(server, '/api/fees/receipts/RCT-OSAah-001', teacherToken)).status, 403);
    assert.equal((await request(server, '/api/fees/payments')).status, 401);
    assert.equal((await request(server, '/api/fees/receipts/RCT-OSAah-001')).status, 401);
    const emptyApp = createApp({ auth, database: database([]) });
    const emptyServer = createServer(emptyApp); await new Promise((resolve) => emptyServer.listen(0, resolve));
    try { const empty = await request(emptyServer, '/api/fees/payments', accountantToken); assert.equal(empty.status, 200); assert.deepEqual(empty.body, { payments: [] }); } finally { await new Promise((resolve) => emptyServer.close(resolve)); }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
