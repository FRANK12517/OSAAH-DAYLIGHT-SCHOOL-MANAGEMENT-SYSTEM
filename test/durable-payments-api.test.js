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
  assert.deepEqual(result[0], { id: 'payment-osaah', receiptNumber: 'RCT-OSAah-001', transactionReference: 'PAY-OSAah-001', invoiceNumber: 'INV-OSAah-001', studentId: 'student-osaah', permanentStudentId: 'PS-OSAah-001', classId: 'basic-4', academicYearId: '2026', termId: 'TERM1', amount: 125.5, method: 'MOBILE_MONEY', status: 'COMPLETED', createdAt: '2026-09-01T10:00:00Z', paymentDate: '2026-09-01', providerReference: null, enteredBy: 'accountant-osaah', receiptStatus: 'VALID', previousBalance: 300.5, balance: 175 });
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
    assert.equal((await request(server, '/api/fees/payments?studentId=student-other', accountantToken)).body.payments.length, 0);
    assert.equal((await request(server, '/api/fees/payments?schoolId=school-other', accountantToken)).body.payments.length, 1);
    assert.equal((await request(server, '/api/fees/payments', teacherToken)).status, 403);
    assert.equal((await request(server, '/api/fees/payments')).status, 401);
    const emptyApp = createApp({ auth, database: database([]) });
    const emptyServer = createServer(emptyApp); await new Promise((resolve) => emptyServer.listen(0, resolve));
    try { const empty = await request(emptyServer, '/api/fees/payments', accountantToken); assert.equal(empty.status, 200); assert.deepEqual(empty.body, { payments: [] }); } finally { await new Promise((resolve) => emptyServer.close(resolve)); }
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
