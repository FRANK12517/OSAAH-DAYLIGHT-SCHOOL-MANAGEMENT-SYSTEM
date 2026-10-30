import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createParentSmsAuthService } from '../src/parent-sms-auth.js';
import { createApp } from '../src/server.mjs';

const PHONE = '0247293733';
const PARENT_ID = '97324d93-d2cd-11f1-acd1-4ad4f02e631a';
const SCHOOL_ID = 'sch_default_01';
const SECRET = 'test-only-hmac-secret-with-at-least-32-characters';

function post(app, path, body) {
  const request = new EventEmitter();
  request.url = path; request.method = 'POST'; request.headers = { 'content-type': 'application/json' }; request.socket = { remoteAddress: '127.0.0.1' };
  const response = { writeHead(status, headers) { this.statusCode = status; this.headers = headers; }, end(content) { this.content = content; } };
  const pending = app(request, response);
  request.emit('data', JSON.stringify(body)); request.emit('end');
  return Promise.resolve(pending).then(() => ({ status: response.statusCode, body: JSON.parse(response.content || '{}'), cookie: response.headers?.['Set-Cookie'] }));
}
function fixture({ eligible = true, dialect = 'tidb', failInsert = false } = {}) {
  const state = { challenges: [], buckets: new Map(), sends: [], statements: [], parent: { userId: PARENT_ID, schoolId: SCHOOL_ID, phone: PHONE, phoneMatchCount: 1 } };
  let transactionQueue = Promise.resolve();
  const db = {
    dialect,
    supportsDurableAuthSessions: true,
    async transaction(callback) {
      let release;
      const previous = transactionQueue;
      transactionQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      const before = structuredClone(state);
      const tx = { query: async (sql, params = []) => query(sql, params), execute: async (sql, params = []) => execute(sql, params) };
      try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; } finally { release(); }
    },
    async query(sql, params = []) { return query(sql, params); },
    async execute(sql, params = []) { return execute(sql, params); }
  };
  async function query(sql, params) {
    state.statements.push(sql);
    if (/FROM parent_auth_rate_limits/i.test(sql)) {
      const row = state.buckets.get(params[0]);
      return row ? [{ bucketHash: params[0], ...row }] : [];
    }
    if (/SELECT DISTINCT u\.id AS userId/i.test(sql)) return eligible ? [{ ...state.parent }] : [];
    if (/FROM parent_auth_challenges\s+WHERE school_id=/i.test(sql)) return state.challenges.filter((row) => row.schoolId === params[0] && row.userId === params[1] && row.purpose === params[2] && !row.consumedAt && !row.invalidatedAt && row.expiresAt > params[3]).map(({ id, createdAt }) => ({ id, createdAt }));
    if (/FROM parent_auth_challenges WHERE id=/i.test(sql)) {
      const row = state.challenges.find((item) => item.id === params[0] && item.schoolId === params[1] && item.purpose === params[2]);
      return row ? [{ id: row.id, userId: row.userId, phone: row.phone, codeDigest: row.codeDigest, expiresAt: row.expiresAt, attempts: row.attempts, consumedAt: row.consumedAt, invalidatedAt: row.invalidatedAt }] : [];
    }
    if (/JOIN user_roles/i.test(sql) && /student_profiles/i.test(sql)) return eligible ? [{ userId: state.parent.userId, schoolId: SCHOOL_ID }] : [];
    return [];
  }
  async function execute(sql, params) {
    state.statements.push(sql);
    if (failInsert && /INSERT INTO parent_auth_challenges/i.test(sql)) throw new Error('synthetic database failure');
    if (/INSERT (?:IGNORE INTO|INTO parent_auth_rate_limits)/i.test(sql)) {
      if (!state.buckets.has(params[0])) state.buckets.set(params[0], { windowStartedAt: params[1], requestCount: 0, updatedAt: params[2] });
      return { affectedRows: 1 };
    }
    if (/UPDATE parent_auth_rate_limits SET/i.test(sql)) {
      const row = state.buckets.get(params[3]);
      if (row) Object.assign(row, { windowStartedAt: params[0], requestCount: params[1], updatedAt: params[2] });
      return { affectedRows: row ? 1 : 0 };
    }
    if (/DELETE FROM parent_auth_challenges/i.test(sql)) { state.challenges = state.challenges.filter((row) => row.expiresAt >= params[0]); return { affectedRows: 0 }; }
    if (/DELETE FROM parent_auth_rate_limits/i.test(sql)) return { affectedRows: 0 };
    if (/UPDATE parent_auth_challenges SET invalidated_at=.*WHERE school_id=/i.test(sql)) {
      let count = 0;
      for (const row of state.challenges) if (row.schoolId === params[1] && row.userId === params[2] && row.purpose === params[3] && !row.consumedAt && !row.invalidatedAt) { row.invalidatedAt = params[0]; count += 1; }
      return { affectedRows: count };
    }
    if (/INSERT INTO parent_auth_challenges/i.test(sql)) {
      state.challenges.push({ id: params[0], schoolId: params[1], userId: params[2], phone: params[3], purpose: params[4], codeDigest: params[5], createdAt: params[6], expiresAt: params[7], attempts: 0, consumedAt: null, invalidatedAt: null });
      return { affectedRows: 1 };
    }
    if (/SET attempts=attempts\+1/i.test(sql)) {
      const row = state.challenges.find((item) => item.id === params[0]);
      if (row && row.attempts < params[1] && !row.consumedAt && !row.invalidatedAt) row.attempts += 1;
      return { affectedRows: row ? 1 : 0 };
    }
    if (/SET consumed_at=/i.test(sql)) {
      const row = state.challenges.find((item) => item.id === params[1]);
      if (row && !row.consumedAt && !row.invalidatedAt && row.expiresAt > params[2] && row.attempts < params[3]) { row.consumedAt = params[0]; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (/SET invalidated_at=/i.test(sql)) {
      const row = state.challenges.find((item) => item.id === params[1]);
      if (row && !row.consumedAt && !row.invalidatedAt) row.invalidatedAt = params[0];
      return { affectedRows: row ? 1 : 0 };
    }
    return { affectedRows: 0 };
  }
  const gateway = { configured: true, async send(payload) { state.sends.push(payload); return []; } };
  let now = Date.parse('2026-10-28T12:00:00.000Z');
  const service = createParentSmsAuthService({ database: db, gateway, schoolId: SCHOOL_ID, environment: { OSAAH_PARENT_OTP_HMAC_SECRET: SECRET }, clock: () => now, codeGenerator: () => '123456' });
  return { service, state, gateway, setNow(value) { now = value; } };
}

test('SMS challenge stores only a keyed digest and returns a generic response without the code', async () => {
  const { service, state } = fixture();
  const result = await service.requestCode({ phone: '+233 24 729 3733', ipAddress: '127.0.0.1' });
  assert.equal(result.status, 202);
  assert.match(result.body.message, /If this number is eligible/);
  assert.equal(result.body.challengeId.length, 36);
  assert.equal(JSON.stringify(result).includes('123456'), false);
  assert.notEqual(state.challenges[0].codeDigest, '123456');
  assert.equal(state.challenges[0].codeDigest.length, 64);
  assert.match(state.sends[0].message, /123456/);
});

test('successful verification consumes once and returns only the server-derived identity', async () => {
  const { service } = fixture();
  const requested = await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  const verified = await service.verifyCode({ phone: PHONE, code: '123456', challengeId: requested.body.challengeId, ipAddress: '127.0.0.1' });
  assert.deepEqual(verified, { ok: true, identity: { parentUserId: PARENT_ID, phone: '+233247293733', schoolId: SCHOOL_ID } });
  const replay = await service.verifyCode({ phone: PHONE, code: '123456', challengeId: requested.body.challengeId, ipAddress: '127.0.0.1' });
  assert.equal(replay.ok, false);
});

test('simultaneous redemption produces exactly one successful verification', async () => {
  const { service } = fixture();
  const requested = await service.requestCode({ phone: PHONE });
  const results = await Promise.all([
    service.verifyCode({ phone: PHONE, code: '123456', challengeId: requested.body.challengeId }),
    service.verifyCode({ phone: PHONE, code: '123456', challengeId: requested.body.challengeId })
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
});

test('unknown or ineligible phones get the generic response and no SMS', async () => {
  const { service, state } = fixture({ eligible: false });
  const result = await service.requestCode({ phone: PHONE });
  assert.equal(result.status, 202);
  assert.match(result.body.message, /If this number is eligible/);
  assert.equal(state.sends.length, 0);
  assert.equal(state.challenges.length, 0);
});

test('malformed phone numbers are rejected before database or provider activity', async () => {
  const { service, state } = fixture();
  const result = await service.requestCode({ phone: 'not-a-phone' });
  assert.equal(result.status, 400);
  assert.equal(state.statements.length, 0);
  assert.equal(state.sends.length, 0);
});

test('invalid, malformed, expired and wrong verification codes cannot authenticate', async () => {
  const { service, state, setNow } = fixture();
  assert.equal((await service.verifyCode({ phone: PHONE, code: '12', challengeId: 'not-an-id' })).status, 400);
  const request = await service.requestCode({ phone: PHONE });
  assert.equal((await service.verifyCode({ phone: PHONE, code: '999999', challengeId: request.body.challengeId })).status, 401);
  setNow(Date.parse(state.challenges[0].expiresAt) + 1);
  assert.equal((await service.verifyCode({ phone: PHONE, code: '123456', challengeId: request.body.challengeId })).status, 401);
});

test('verification attempt limit blocks a correct code after five incorrect attempts', async () => {
  const { service } = fixture();
  const request = await service.requestCode({ phone: PHONE });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await service.verifyCode({ phone: PHONE, code: '999999', challengeId: request.body.challengeId })).status, 401);
  assert.equal((await service.verifyCode({ phone: PHONE, code: '123456', challengeId: request.body.challengeId })).status, 401);
});

test('eligibility query enforces school role, active link, and same-school profile/master records', async () => {
  const { service, state } = fixture();
  await service.requestCode({ phone: PHONE });
  const eligibility = state.statements.find((sql) => /SELECT DISTINCT u\.id AS userId/.test(sql));
  assert.match(eligibility, /JOIN user_roles ur/);
  assert.match(eligibility, /r\.school_id=u\.school_id AND r\.role_key='PARENT'/);
  assert.match(eligibility, /psl\.link_status='ACTIVE'/);
  assert.match(eligibility, /sp\.school_id=u\.school_id/);
  assert.match(eligibility, /s\.id=sp\.student_master_id AND s\.school_id=u\.school_id/);
});

test('phone normalization, resend cooldown, and distributed phone throttling are enforced', async () => {
  const { service, state, setNow } = fixture({ dialect: 'tidb' });
  const first = await service.requestCode({ phone: '233247293733', ipAddress: '127.0.0.1' });
  const cooldown = await service.requestCode({ phone: '+233 24 729 3733', ipAddress: '127.0.0.1' });
  assert.equal(first.body.challengeId, cooldown.body.challengeId);
  assert.equal(state.sends.length, 1);
  setNow(Date.parse('2026-10-28T12:01:01.000Z'));
  await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  setNow(Date.parse('2026-10-28T12:16:02.000Z'));
  const third = await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  const fourth = await service.requestCode({ phone: PHONE, ipAddress: '127.0.0.1' });
  assert.equal(third.status, 202);
  assert.equal(fourth.status, 429);
  assert.equal(state.sends.length, 3);
});

test('provider rejection invalidates the challenge and never yields an auth identity', async () => {
  const item = fixture();
  item.gateway.send = async () => { throw new Error('provider details must remain private'); };
  const result = await item.service.requestCode({ phone: PHONE });
  assert.equal(result.status, 202);
  assert.ok(item.state.challenges[0].invalidatedAt);
  assert.equal(JSON.stringify(result).includes('provider details'), false);
  assert.equal((await item.service.verifyCode({ phone: PHONE, code: '123456', challengeId: result.body.challengeId })).ok, false);
});

test('database failure rolls back challenge and rate-limit writes', async () => {
  const { service, state } = fixture({ failInsert: true });
  const result = await service.requestCode({ phone: PHONE });
  assert.equal(result.status, 503);
  assert.equal(state.challenges.length, 0);
  assert.equal(state.buckets.size, 0);
});

test('legacy PostgreSQL parent-auth database configuration is not accepted', async () => {
  let calls = 0;
  const database = { dialect: 'postgres', supportsDurableAuthSessions: true, async query() { calls += 1; return []; }, async execute() { calls += 1; }, async transaction() { calls += 1; } };
  const gateway = { configured: true, async send() { calls += 1; } };
  const service = createParentSmsAuthService({ database, gateway, schoolId: SCHOOL_ID, environment: { OSAAH_PARENT_OTP_HMAC_SECRET: SECRET } });
  assert.equal(service.configured, false);
  assert.equal((await service.requestCode({ phone: PHONE })).status, 503);
  assert.equal(calls, 0);
});
test('parent phone login remains available and OTP routes create a verified parent session', async () => {
  const logins = [];
  const auth = {
    sessionTtlMs: 60_000,
    async loginParentByPhone(input) {
      logins.push(input);
      return { ok: true, token: 'server-issued-token', user: { id: PARENT_ID, portal: 'parent', roleKey: 'PARENT', sessionId: `session-${logins.length}` }, redirectTo: '/', expiresAt: Date.now() + 60_000 };
    },
    async loginByPhoneFromDatabase(input) { return this.loginParentByPhone(input); },
    async logoutSession() {}
  };
  const requested = [];
  const verified = [];
  const parentSmsAuth = {
    async requestCode(input) { requested.push(input); return { status: 202, body: { ok: true, challengeId: 'challenge-1' } }; },
    async verifyCode(input) { verified.push(input); return { ok: true, identity: { parentUserId: PARENT_ID, phone: PHONE, schoolId: SCHOOL_ID } }; }
  };
  const app = createApp({ auth, parentSmsAuth });
  const legacyLogin = await post(app, '/api/auth/login', { portal: 'parent', phone: PHONE, password: 'must-not-be-used', code: '123456', role: 'PROPRIETOR' });
  assert.equal(legacyLogin.status, 200);
  assert.match(legacyLogin.cookie ?? '', /^osaah_session=server-issued-token; HttpOnly/);
  assert.deepEqual(Object.keys(logins[0]).sort(), ['diagnosticContext', 'phone']);

  const requestOtp = await post(app, '/api/auth/parent/request-code', { phone: PHONE });
  assert.equal(requestOtp.status, 202);
  assert.equal(requested[0].phone, PHONE);
  const verifyOtp = await post(app, '/api/auth/parent/verify-code', { phone: PHONE, code: '123456', challengeId: 'challenge-1' });
  assert.equal(verifyOtp.status, 200);
  assert.match(verifyOtp.cookie ?? '', /^osaah_session=server-issued-token; HttpOnly/);
  assert.deepEqual(verified[0], { phone: PHONE, code: '123456', challengeId: 'challenge-1', ipAddress: '127.0.0.1' });
  assert.equal(logins.length, 2);
});
