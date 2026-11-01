import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
<<<<<<< Updated upstream
import { tidbInsertIfAbsent } from './tidb-conflict.js';
=======
>>>>>>> Stashed changes

const PURPOSE = 'PARENT_LOGIN';
const SCHOOL_ID = 'sch_default_01';
const CHALLENGE_TTL_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const RATE_WINDOW_MS = 15 * 60_000;
const MAX_REQUESTS_PHONE = 3;
const MAX_REQUESTS_IP = 10;
const MAX_VERIFY_PHONE = 20;
const MAX_VERIFY_ATTEMPTS = 5;
const safeRows = (value) => Array.isArray(value) ? value : [];
const countResult = (result) => Number(result?.affectedRows ?? result?.rowCount ?? result?.changes ?? 0);
const timestamp = (value) => new Date(value).toISOString();
const sqlPhoneValues = (phone) => [phone.slice(1), `0${phone.slice(4)}`, phone];
const normalizeIp = (value) => String(value ?? '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'unknown';

function phoneMatchSql(column = 'u.phone') {
  return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${column},''),' ',''),'-',''),'(',''),')',''),'+','') IN (?,?,?)`;
}

function digest(secret, values) {
  return createHmac('sha256', secret).update(values.join('\0')).digest('hex');
}

function equalDigest(a, b) {
  const left = Buffer.from(String(a ?? ''), 'hex');
  const right = Buffer.from(String(b ?? ''), 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function createParentSmsAuthService({ database, gateway, schoolId = SCHOOL_ID, environment = process.env, clock = () => Date.now(), codeGenerator = () => String(randomInt(0, 1_000_000)).padStart(6, '0') } = {}) {
  const secret = String(environment.OSAAH_PARENT_OTP_HMAC_SECRET ?? '');
<<<<<<< Updated upstream
  const configured = Boolean(database?.dialect === 'tidb' && database?.query && database?.execute && database?.transaction && database?.supportsDurableAuthSessions && gateway?.configured && typeof gateway.send === 'function' && secret.length >= 32 && schoolId === SCHOOL_ID);
  const nowIso = () => timestamp(clock());
  const makeBucketId = (scope, value) => createHash('sha256').update(`${scope}\0${value}`).digest('hex');
  const upsertBucket = async (tx, id, now) => tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO parent_auth_rate_limits (bucket_hash,window_started_at,request_count,updated_at) VALUES (?,?,0,?)', insertParameters: [id, now, now], conflictSql: 'SELECT bucket_hash FROM parent_auth_rate_limits WHERE bucket_hash=?', conflictParameters: [id] });
=======
  const configured = Boolean(database?.query && database?.execute && database?.transaction && database?.supportsDurableAuthSessions && gateway?.configured && typeof gateway.send === 'function' && secret.length >= 32 && schoolId === SCHOOL_ID);
  const nowIso = () => timestamp(clock());
  const makeBucketId = (scope, value) => createHash('sha256').update(`${scope}\0${value}`).digest('hex');
  const upsertBucket = async (tx, id, now) => {
    if (database.dialect === 'postgres') await tx.execute('INSERT INTO parent_auth_rate_limits (bucket_hash,window_started_at,request_count,updated_at) VALUES (?,?,0,?) ON CONFLICT (bucket_hash) DO NOTHING', [id, now, now]);
    else if (database.dialect === 'tidb') await tx.execute('INSERT IGNORE INTO parent_auth_rate_limits (bucket_hash,window_started_at,request_count,updated_at) VALUES (?,?,0,?)', [id, now, now]);
    else throw Object.assign(new Error('Database dialect is unavailable.'), { code: 'AUTH_DATABASE_DIALECT_UNAVAILABLE' });
  };
>>>>>>> Stashed changes
  async function takeRateLimits(tx, buckets, nowMs) {
    const now = timestamp(nowMs);
    for (const bucket of buckets) await upsertBucket(tx, bucket.id, now);
    let allowed = true;
    for (const bucket of buckets) {
      const rows = safeRows(await tx.query('SELECT bucket_hash AS bucketHash,window_started_at AS windowStartedAt,request_count AS requestCount FROM parent_auth_rate_limits WHERE bucket_hash=? FOR UPDATE', [bucket.id]));
      if (rows.length !== 1) throw new Error('Rate limit storage is unavailable.');
      const row = rows[0];
      const started = Date.parse(row.windowStartedAt);
      const expired = !Number.isFinite(started) || nowMs - started >= RATE_WINDOW_MS;
      const count = expired ? 0 : Number(row.requestCount ?? 0);
      if (count >= bucket.limit) allowed = false;
      await tx.execute('UPDATE parent_auth_rate_limits SET window_started_at=?,request_count=?,updated_at=? WHERE bucket_hash=?', [expired ? now : row.windowStartedAt, count + (count < bucket.limit ? 1 : 0), now, bucket.id]);
    }
    return allowed;
  }
  function eligibleParentQuery(tx, phone) {
    const values = sqlPhoneValues(phone);
    return tx.query(`SELECT DISTINCT u.id AS userId,u.school_id AS schoolId,u.phone AS phone,
        (SELECT COUNT(DISTINCT p.id) FROM users p WHERE ${phoneMatchSql('p.phone')}) AS phoneMatchCount
      FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
      JOIN parent_student_links psl ON psl.parent_user_id=u.id AND psl.link_status='ACTIVE'
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=u.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=u.school_id
      WHERE ${phoneMatchSql('u.phone')} AND u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'
        AND r.school_id=u.school_id AND r.role_key='PARENT'
        AND COALESCE(s.student_status,'ACTIVE') NOT IN ('WITHDRAWN','TRANSFERRED','COMPLETED','GRADUATED')`, [...values, ...values, SCHOOL_ID]);
  }
  async function requestCode({ phone: rawPhone, ipAddress = 'unknown' } = {}) {
    let challengeId = randomUUID();
    const phone = normalizeGhanaPhone(rawPhone);
    if (!phone) return { ok: false, status: 400, body: { error: 'Enter a valid Ghanaian phone number.' } };
    if (!configured) return { ok: false, status: 503, body: { error: 'Parent sign-in is temporarily unavailable.' } };
    const nowMs = clock(), now = timestamp(nowMs), ip = normalizeIp(ipAddress);
    const buckets = [
      { id: makeBucketId('request-phone', phone), limit: MAX_REQUESTS_PHONE },
      { id: makeBucketId('request-ip', ip), limit: MAX_REQUESTS_IP }
    ];
    let parent = null, shouldSend = false, rateLimited = false;
    try {
      await database.transaction(async (tx) => {
        if (!await takeRateLimits(tx, buckets, nowMs)) { rateLimited = true; return; }
        const matches = safeRows(await eligibleParentQuery(tx, phone));
        const parents = [...new Map(matches.map((row) => [String(row.userId), row])).values()];
        if (parents.length !== 1 || Number(parents[0].phoneMatchCount) !== 1 || normalizeGhanaPhone(parents[0].phone) !== phone) return;
        parent = parents[0];
        await tx.execute('DELETE FROM parent_auth_challenges WHERE expires_at<?', [timestamp(nowMs - 30 * 24 * 60 * 60_000)]);
        await tx.execute('DELETE FROM parent_auth_rate_limits WHERE updated_at<?', [timestamp(nowMs - 30 * 24 * 60 * 60_000)]);
        const pending = safeRows(await tx.query(`SELECT id,created_at AS createdAt FROM parent_auth_challenges
          WHERE school_id=? AND user_id=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>? FOR UPDATE`, [SCHOOL_ID, parent.userId, PURPOSE, now]));
        const recent = pending.filter((row) => nowMs - Date.parse(row.createdAt) < RESEND_COOLDOWN_MS);
        if (recent.length) { challengeId = recent[0].id; return; }
        await tx.execute(`UPDATE parent_auth_challenges SET invalidated_at=?
          WHERE school_id=? AND user_id=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL`, [now, SCHOOL_ID, parent.userId, PURPOSE]);
        const code = codeGenerator();
        if (!/^\d{6}$/.test(code)) throw new Error('Code generator returned an invalid code.');
        const codeDigest = digest(secret, [SCHOOL_ID, parent.userId, phone, PURPOSE, challengeId, code]);
        await tx.execute(`INSERT INTO parent_auth_challenges
          (id,school_id,user_id,normalized_phone,purpose,code_digest,created_at,expires_at,attempts,consumed_at,invalidated_at)
          VALUES (?,?,?,?,?,?,?,?,0,NULL,NULL)`, [challengeId, SCHOOL_ID, parent.userId, phone, PURPOSE, codeDigest, now, timestamp(nowMs + CHALLENGE_TTL_MS)]);
        parent = { ...parent, _code: code };
        shouldSend = true;
      });
      if (shouldSend) {
        const code = parent._code;
        delete parent._code;
        try {
          await gateway.send({ message: `OSAAH Daylight Parent Portal verification code: ${code}. It expires in 5 minutes. Do not share this code.`, recipients: [phone] });
        } catch {
          await database.execute('UPDATE parent_auth_challenges SET invalidated_at=? WHERE id=? AND consumed_at IS NULL AND invalidated_at IS NULL', [nowIso(), challengeId]);
        }
      }
      if (rateLimited) return { ok: false, status: 429, body: { error: 'Too many code requests. Try again later.' } };
      return { ok: true, status: 202, body: { ok: true, challengeId, retryAfterSeconds: 60, message: 'If this number is eligible, a verification code may arrive shortly.' } };
    } catch {
      return { ok: false, status: 503, body: { error: 'Parent sign-in is temporarily unavailable.' } };
    }
  }
  async function verifyCode({ phone: rawPhone, code, challengeId, ipAddress = 'unknown' } = {}) {
    const phone = normalizeGhanaPhone(rawPhone);
    if (!configured) return { ok: false, status: 503, body: { error: 'Parent sign-in is temporarily unavailable.' } };
    if (!phone || typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(challengeId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return { ok: false, status: 400, body: { error: 'Enter a valid verification code.' } };
    const nowMs = clock(), now = timestamp(nowMs), buckets = [
      { id: makeBucketId('verify-phone', phone), limit: MAX_VERIFY_PHONE },
      { id: makeBucketId('verify-ip', normalizeIp(ipAddress)), limit: MAX_REQUESTS_IP * 2 }
    ];
    try {
      const verified = await database.transaction(async (tx) => {
        if (!await takeRateLimits(tx, buckets, nowMs)) return { rateLimited: true };
        const rows = safeRows(await tx.query(`SELECT id,user_id AS userId,normalized_phone AS phone,code_digest AS codeDigest,
            expires_at AS expiresAt,attempts,consumed_at AS consumedAt,invalidated_at AS invalidatedAt
          FROM parent_auth_challenges WHERE id=? AND school_id=? AND purpose=? FOR UPDATE`, [challengeId, SCHOOL_ID, PURPOSE]));
        const challenge = rows[0];
        if (!challenge || challenge.phone !== phone || challenge.consumedAt || challenge.invalidatedAt || Date.parse(challenge.expiresAt) <= nowMs || Number(challenge.attempts) >= MAX_VERIFY_ATTEMPTS) return null;
        const expected = digest(secret, [SCHOOL_ID, String(challenge.userId), phone, PURPOSE, challengeId, code]);
        if (!equalDigest(expected, challenge.codeDigest)) {
          await tx.execute('UPDATE parent_auth_challenges SET attempts=attempts+1 WHERE id=? AND attempts<? AND consumed_at IS NULL AND invalidated_at IS NULL', [challengeId, MAX_VERIFY_ATTEMPTS]);
          return null;
        }
        const eligible = safeRows(await tx.query(`SELECT u.id AS userId,u.school_id AS schoolId FROM users u
          JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
          JOIN parent_student_links psl ON psl.parent_user_id=u.id AND psl.link_status='ACTIVE'
          JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=u.school_id
          JOIN students s ON s.id=sp.student_master_id AND s.school_id=u.school_id
          WHERE u.id=? AND ${phoneMatchSql('u.phone')} AND u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'
            AND r.role_key='PARENT' AND r.school_id=u.school_id
            AND COALESCE(s.student_status,'ACTIVE') NOT IN ('WITHDRAWN','TRANSFERRED','COMPLETED','GRADUATED')`, [challenge.userId, ...sqlPhoneValues(phone), SCHOOL_ID]));
        if (!eligible.length) return null;
        const consumed = await tx.execute(`UPDATE parent_auth_challenges SET consumed_at=?
          WHERE id=? AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>? AND attempts<?`, [now, challengeId, now, MAX_VERIFY_ATTEMPTS]);
        if (countResult(consumed) !== 1) return null;
        return { parentUserId: String(challenge.userId), phone, schoolId: SCHOOL_ID };
      });
      if (!verified) return { ok: false, status: 401, body: { error: 'The verification code is invalid or expired.' } };
      if (verified.rateLimited) return { ok: false, status: 429, body: { error: 'Too many verification attempts. Try again later.' } };
      return { ok: true, identity: verified };
    } catch {
      return { ok: false, status: 503, body: { error: 'Parent sign-in is temporarily unavailable.' } };
    }
  }
  return Object.freeze({ configured, requestCode, verifyCode });
}
<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
