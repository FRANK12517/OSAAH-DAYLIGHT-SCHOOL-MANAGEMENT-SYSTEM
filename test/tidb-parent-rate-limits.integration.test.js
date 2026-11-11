import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import mysql from 'mysql2/promise';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { createAuthService } from '../src/auth.js';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';
import { inspectParentRateLimitSchema } from '../src/auth/parent-rate-limits.js';
import { createProprietorAuthenticationController } from '../src/proprietor-authentication-controller.js';
import { normalizeGhanaPhone } from '../src/utils/normalize-phone.js';

const APPROVAL_VARIABLE = 'OSAAH_TIDB_PARENT_LIMIT_INTEGRATION_APPROVAL';
const APPROVAL_VALUE = 'DISPOSABLE_TIDB_V8_5_3_CI_DATABASE_APPROVED';
const enabled = process.env[APPROVAL_VARIABLE] === APPROVAL_VALUE;
const LEGACY_DDL = `CREATE TABLE parent_auth_rate_limits (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  phone VARCHAR(50) NULL,
  attempts INT NOT NULL DEFAULT 1,
  first_attempt_at DATETIME NOT NULL,
  blocked_until DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY idx_parent_rate_limit_phone (phone),
  KEY idx_parent_rate_limit_blocked (blocked_until)
)`;
const BUCKET_DDL = `CREATE TABLE parent_auth_rate_limits (
  bucket_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at VARCHAR(64) NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  updated_at VARCHAR(64) NOT NULL,
  KEY idx_parent_auth_rate_limits_updated (updated_at)
)`;
const SESSION_SECRET = 'isolated-parent-auth-session-secret-v8.5.3';
const SCHOOL_ID = 'sch_default_01';
const PHONE = '0247293733';

function safeEqualDatabase(database) {
  return database === 'osaah_parent_auth_test' || database === 'osaah_parent_auth_bucket_test';
}

function makeDatabase(pool, { failAfterLimiterUpdate = () => false, connectionIds = null } = {}) {
  async function queryOn(connection, sql, parameters = []) {
    const [rows] = await connection.query(sql, parameters);
    return rows;
  }
  async function executeOn(connection, sql, parameters = []) {
    const [result] = await connection.execute(sql, parameters);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  }
  return {
    dialect: 'tidb',
    supportsDurableAuthSessions: true,
    async query(sql, parameters = []) { const [rows] = await pool.query(sql, parameters); return rows; },
    async execute(sql, parameters = []) { const [result] = await pool.execute(sql, parameters); return { insertId: result.insertId, affectedRows: result.affectedRows }; },
    async transaction(callback) {
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      try {
        if (connectionIds) {
          const [idRows] = await connection.query('SELECT CONNECTION_ID() AS connectionId');
          connectionIds.add(Number(idRows[0].connectionId));
        }
        const tx = {
          query: (sql, parameters = []) => queryOn(connection, sql, parameters),
          async execute(sql, parameters = []) {
            const result = await executeOn(connection, sql, parameters);
            if (/UPDATE parent_auth_rate_limits/i.test(sql) && failAfterLimiterUpdate()) {
              throw Object.assign(new Error('Injected isolated transaction failure after limiter write.'), { code: 'ISOLATED_TEST_FAILPOINT' });
            }
            return result;
          }
        };
        const result = await callback(tx);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally { connection.release(); }
    },
    pool
  };
}

async function createAuthSchema(database) {
  await database.execute(`CREATE TABLE schools (id VARCHAR(64) NOT NULL PRIMARY KEY, name VARCHAR(128) NOT NULL)`);
  await database.execute(`CREATE TABLE users (id VARCHAR(64) NOT NULL PRIMARY KEY, school_id VARCHAR(64) NOT NULL, username VARCHAR(191), email VARCHAR(191), password_hash VARCHAR(255), status VARCHAR(32) NOT NULL)`);
  await database.execute(`CREATE TABLE roles (id VARCHAR(64) NOT NULL PRIMARY KEY, school_id VARCHAR(64) NOT NULL, role_key VARCHAR(64) NOT NULL, oversight_rank INT NOT NULL DEFAULT 0)`);
  await database.execute(`CREATE TABLE user_roles (user_id VARCHAR(64) NOT NULL, role_id VARCHAR(64) NOT NULL, PRIMARY KEY(user_id, role_id))`);
  await database.execute(`CREATE TABLE role_permissions (role_id VARCHAR(64) NOT NULL, permission_id VARCHAR(64) NOT NULL)`);
  await database.execute(`CREATE TABLE permissions (id VARCHAR(64) NOT NULL PRIMARY KEY, permission_key VARCHAR(128) NOT NULL)`);
  await database.execute(`CREATE TABLE students (id VARCHAR(64) NOT NULL PRIMARY KEY, school_id VARCHAR(64) NOT NULL, permanent_student_id VARCHAR(64) NOT NULL, student_status VARCHAR(32) NOT NULL, is_test_record BOOLEAN NOT NULL DEFAULT FALSE)`);
  await database.execute(`CREATE TABLE student_profiles (id VARCHAR(64) NOT NULL PRIMARY KEY, school_id VARCHAR(64) NOT NULL, student_master_id VARCHAR(64) NOT NULL, student_id VARCHAR(64) NOT NULL, class_id VARCHAR(64), enrollment_status VARCHAR(32) NOT NULL)`);
  await database.execute(`CREATE TABLE parent_student_links (parent_user_id VARCHAR(64) NOT NULL, student_id VARCHAR(64) NOT NULL, telephone VARCHAR(50) NOT NULL, link_status VARCHAR(32) NOT NULL, PRIMARY KEY(parent_user_id, student_id))`);
  await database.execute(`CREATE TABLE student_enrollments (id VARCHAR(64) NOT NULL PRIMARY KEY, student_id VARCHAR(64) NOT NULL, school_id VARCHAR(64) NOT NULL, class_id VARCHAR(64), is_current BOOLEAN NOT NULL DEFAULT TRUE, enrolled_at DATETIME, enrollment_status VARCHAR(32))`);
  await database.execute(`CREATE TABLE auth_sessions (id VARCHAR(64) NOT NULL PRIMARY KEY, user_id VARCHAR(64) NOT NULL, school_id VARCHAR(64) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, created_at VARCHAR(64) NOT NULL, expires_at VARCHAR(64) NOT NULL, revoked_at VARCHAR(64) NULL, last_used_at VARCHAR(64) NOT NULL)`);
  await database.execute(`CREATE TABLE staff (id VARCHAR(64) NOT NULL PRIMARY KEY, user_id VARCHAR(64) NOT NULL, school_id VARCHAR(64) NOT NULL)`);
  await database.execute(`CREATE TABLE staff_assignments (staff_id VARCHAR(64) NOT NULL, class_id VARCHAR(64), subject_id VARCHAR(64))`);
  await database.execute(`CREATE TABLE portal_users (id VARCHAR(64) NOT NULL PRIMARY KEY, portal_name VARCHAR(128) NOT NULL, email VARCHAR(191) NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(64) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE)`);
  await database.execute('INSERT INTO schools (id,name) VALUES (?,?)', [SCHOOL_ID, 'Isolated TiDB test school']);
  await database.execute('INSERT INTO roles (id,school_id,role_key) VALUES (?,?,?)', ['parent-role', SCHOOL_ID, 'PARENT']);
}

async function seedParent(database, index, phone, { schoolId = SCHOOL_ID, linkStatus = 'ACTIVE' } = {}) {
  const parentId = `parent-${index}`;
  const studentId = `student-${index}`;
  const profileId = `profile-${index}`;
  const permanentStudentId = `OSAAH/2026/${String(index).padStart(4, '0')}`;
  await database.execute('INSERT INTO users (id,school_id,username,status) VALUES (?,?,?,?)', [parentId, schoolId, `${parentId}@test.invalid`, 'ACTIVE']);
  await database.execute('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)', [parentId, 'parent-role']);
  await database.execute('INSERT INTO students (id,school_id,permanent_student_id,student_status,is_test_record) VALUES (?,?,?,?,FALSE)', [studentId, schoolId, permanentStudentId, 'ACTIVE']);
  await database.execute('INSERT INTO student_profiles (id,school_id,student_master_id,student_id,class_id,enrollment_status) VALUES (?,?,?,?,?,?)', [profileId, schoolId, studentId, permanentStudentId, 'class-1', 'ACTIVE']);
  await database.execute('INSERT INTO parent_student_links (parent_user_id,student_id,telephone,link_status) VALUES (?,?,?,?)', [parentId, profileId, phone, linkStatus]);
  return { parentId, studentId, profileId, permanentStudentId, phone };
}

async function clearLimiter(database) { await database.execute('DELETE FROM parent_auth_rate_limits'); }
async function resetAuthSessions(database) { await database.execute('DELETE FROM auth_sessions'); }
async function makeAuth(database, now = () => Date.now()) {
  return createAuthService({ users: [], database, schoolId: SCHOOL_ID, sessionSecret: SESSION_SECRET, now });
}
async function countRows(database, table) {
  const rows = await database.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
  return Number(rows[0].count);
}

test('real TiDB v8.5.3 verifies legacy and bucket Parent rate limiting, concurrency, transactions, and auth', { skip: !enabled }, async (t) => {
  assert.equal(process.env.CI, 'true', 'real TiDB integration only runs in isolated CI');
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.TIDB_TEST_HOST), 'TiDB target must be loopback');
  assert.equal(process.env.TIDB_TEST_PORT, '4000');
  assert.equal(process.env.TIDB_TEST_USER, 'osaah_ci_parent');
  assert.ok(process.env.TIDB_TEST_PASSWORD, 'ephemeral CI database password required');
  assert.equal(process.env.TIDB_TEST_DATABASE, 'osaah_parent_auth_test');
  assert.equal(process.env.OSAAH_DATABASE_ADAPTER, 'tidb');

  const serverPool = mysql.createPool({
    host: process.env.TIDB_TEST_HOST, port: Number(process.env.TIDB_TEST_PORT),
    user: process.env.TIDB_TEST_USER, password: process.env.TIDB_TEST_PASSWORD,
    database: process.env.TIDB_TEST_DATABASE, connectionLimit: 24, waitForConnections: true,
    connectTimeout: 10_000, timezone: 'Z'
  });
  const bucketPool = mysql.createPool({
    host: process.env.TIDB_TEST_HOST, port: Number(process.env.TIDB_TEST_PORT),
    user: process.env.TIDB_TEST_USER, password: process.env.TIDB_TEST_PASSWORD,
    database: 'osaah_parent_auth_bucket_test', connectionLimit: 12, waitForConnections: true,
    connectTimeout: 10_000, timezone: 'Z'
  });
  let db;
  let bucketDb;
  let failOnce = false;
  const connectionIds = new Set();
  try {
    db = makeDatabase(serverPool, { failAfterLimiterUpdate: () => { if (!failOnce) return false; failOnce = false; return true; }, connectionIds });
    bucketDb = makeDatabase(bucketPool);
    const identity = (await db.query('SELECT VERSION() AS version,DATABASE() AS databaseName,@@transaction_isolation AS isolationLevel,@@tidb_txn_mode AS transactionMode'))[0];
    assert.match(identity.version, /TiDB-v8\.5\.3/i, 'must use the actual TiDB v8.5.3 server');
    assert.equal(identity.databaseName, 'osaah_parent_auth_test');
    assert.equal(String(identity.transactionMode).toLowerCase(), 'pessimistic', 'row-lock verification requires TiDB pessimistic transaction mode');
    process.stdout.write(`REAL_TIDB_VERSION=${identity.version}\nREAL_TIDB_DATABASE=${identity.databaseName}\nREAL_TIDB_TRANSACTION_ISOLATION=${identity.isolationLevel}\n`);
    process.stdout.write(`REAL_TIDB_TRANSACTION_MODE=${identity.transactionMode}\n`);

    for (const database of [db, bucketDb]) {
      await database.execute('DROP TABLE IF EXISTS parent_auth_rate_limits');
      await database.execute('DROP TABLE IF EXISTS auth_sessions');
      await database.execute('DROP TABLE IF EXISTS parent_student_links');
      await database.execute('DROP TABLE IF EXISTS student_enrollments');
      await database.execute('DROP TABLE IF EXISTS student_profiles');
      await database.execute('DROP TABLE IF EXISTS students');
      await database.execute('DROP TABLE IF EXISTS user_roles');
      await database.execute('DROP TABLE IF EXISTS role_permissions');
      await database.execute('DROP TABLE IF EXISTS permissions');
      await database.execute('DROP TABLE IF EXISTS roles');
      await database.execute('DROP TABLE IF EXISTS users');
      await database.execute('DROP TABLE IF EXISTS schools');
      await createAuthSchema(database);
    }
    await db.execute(LEGACY_DDL);
    await bucketDb.execute(BUCKET_DDL);
    assert.equal(await inspectParentRateLimitSchema(db), 'legacy');
    assert.equal(await inspectParentRateLimitSchema(bucketDb), 'bucket');
    process.stdout.write('REAL_TIDB_SCHEMA_DETECTION=legacy,bucket PASS\n');
    assert.equal(await db.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('schema_migrations','schema_migration_runs')").then((rows) => Number(rows[0].count)), 0, 'integration must not create or use a migration ledger');

    const primary = await seedParent(db, 1, PHONE);
    const auth = await makeAuth(db);
    assert.equal(normalizeGhanaPhone(PHONE), '+233247293733');
    assert.equal(normalizeGhanaPhone('+233247293733'), '+233247293733');

    await t.test('phone and IP buckets persist HMAC identities and enforce three phone attempts', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      const outcomes = [];
      for (let index = 0; index < 4; index += 1) outcomes.push(await auth.loginByPhoneFromDatabase({ phone: index % 2 ? '+233247293733' : PHONE, ipAddress: '198.51.100.77' }));
      assert.deepEqual(outcomes.map((item) => item.status), [undefined, undefined, undefined, 429]);
      const rows = await db.query('SELECT id,phone,attempts,first_attempt_at AS firstAttemptAt,blocked_until AS blockedUntil FROM parent_auth_rate_limits ORDER BY phone');
      assert.equal(rows.length, 2);
      const phoneRow = rows.find((row) => row.phone === '+233247293733');
      const ipRow = rows.find((row) => String(row.phone).startsWith('ip:'));
      assert.equal(Number(phoneRow.attempts), 3);
      assert.equal(Number(ipRow.attempts), 3);
      assert.equal(phoneRow.id, createHmac('sha256', SESSION_SECRET).update('parent-phone-login\0+233247293733').digest('hex'));
      assert.equal(ipRow.id, createHmac('sha256', SESSION_SECRET).update(`parent-ip-login\0${'198.51.100.77'}`).digest('hex'));
      assert.match(ipRow.phone, /^ip:[A-Za-z0-9_-]{43}$/);
      assert.doesNotMatch(JSON.stringify(rows), /198\.51\.100\.77/);
      assert.ok(new Date(phoneRow.blockedUntil).getTime() > new Date(phoneRow.firstAttemptAt).getTime());
    });

    await t.test('expired phone and IP windows reset on TiDB DATETIME and remain successful', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      const fixedNow = Date.parse('2026-11-11T12:00:00.000Z');
      const oldAuth = await makeAuth(db, () => fixedNow - 16 * 60_000);
      for (let index = 0; index < 3; index += 1) assert.equal((await oldAuth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'expired-window-ip' })).ok, true);
      const freshAuth = await makeAuth(db, () => fixedNow);
      const result = await freshAuth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'expired-window-ip' });
      assert.equal(result.ok, true);
      const row = (await db.query('SELECT attempts,first_attempt_at AS firstAttemptAt,blocked_until AS blockedUntil FROM parent_auth_rate_limits WHERE phone=?', ['+233247293733']))[0];
      assert.equal(Number(row.attempts), 1);
      assert.ok(new Date(row.firstAttemptAt).getTime() >= fixedNow);
    });

    await t.test('legacy active blocks and active-window attempts are honored without mutating source rows', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      const nowMs = Date.now();
      await db.execute('INSERT INTO parent_auth_rate_limits (id,phone,attempts,first_attempt_at,blocked_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['preexisting-active-block', PHONE, 1, new Date(nowMs - 30_000), new Date(nowMs + 60_000), new Date(nowMs - 30_000), new Date(nowMs - 30_000)]);
      const blocked = await auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'old-block-ip' });
      assert.equal(blocked.status, 429);
      const old = (await db.query('SELECT attempts,blocked_until AS blockedUntil FROM parent_auth_rate_limits WHERE id=?', ['preexisting-active-block']))[0];
      assert.equal(Number(old.attempts), 1);
      assert.ok(new Date(old.blockedUntil).getTime() > nowMs);

      await clearLimiter(db);
      await db.execute('INSERT INTO parent_auth_rate_limits (id,phone,attempts,first_attempt_at,blocked_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['preexisting-attempts', PHONE, 2, new Date(Date.now() - 60_000), null, new Date(), new Date()]);
      assert.equal((await auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'old-attempt-ip' })).ok, true);
      assert.equal((await auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'old-attempt-ip' })).status, 429);
      const source = (await db.query('SELECT attempts FROM parent_auth_rate_limits WHERE id=?', ['preexisting-attempts']))[0];
      assert.equal(Number(source.attempts), 2);
    });

    await t.test('concurrent same-phone requests use independent TiDB connections and cannot exceed three', async () => {
      await clearLimiter(db); await resetAuthSessions(db); connectionIds.clear();
      const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) => auth.loginByPhoneFromDatabase({ phone: index % 2 ? PHONE : '+233247293733', ipAddress: `parallel-phone-${index}` })));
      assert.ok(connectionIds.size > 1, 'parallel test must use independent TiDB connections');
      assert.equal(outcomes.filter((item) => item.ok).length, 3);
      assert.equal(outcomes.filter((item) => item.status === 429).length, 9);
      const row = (await db.query('SELECT attempts FROM parent_auth_rate_limits WHERE phone=?', ['+233247293733']))[0];
      assert.equal(Number(row.attempts), 3);
    });

    await t.test('concurrent same-IP requests cannot exceed ten across distinct phone buckets', async () => {
      await clearLimiter(db); await resetAuthSessions(db); connectionIds.clear();
      const accounts = [];
      for (let index = 2; index <= 13; index += 1) accounts.push(await seedParent(db, index, `+23320${String(index).padStart(7, '0')}`));
      const outcomes = await Promise.all(accounts.map((account, index) => auth.loginByPhoneFromDatabase({ phone: account.phone, ipAddress: 'shared-parallel-ip' })));
      assert.ok(connectionIds.size > 1, 'parallel test must use independent TiDB connections');
      assert.equal(outcomes.filter((item) => item.ok).length, 10);
      assert.equal(outcomes.filter((item) => item.status === 429).length, 2);
      const ipRow = (await db.query("SELECT attempts FROM parent_auth_rate_limits WHERE phone LIKE 'ip:%'")).at(-1);
      assert.equal(Number(ipRow.attempts), 10);
    });

    await t.test('simultaneous creation resolves duplicate primary-key conflicts without excess counts', async () => {
      await clearLimiter(db); await resetAuthSessions(db); connectionIds.clear();
      const outcomes = await Promise.all(Array.from({ length: 16 }, () => auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'simultaneous-first-bucket-ip' })));
      assert.ok(connectionIds.size > 1);
      assert.equal(outcomes.filter((item) => item.ok).length, 3);
      assert.equal(await countRows(db, 'parent_auth_rate_limits'), 2);
      const counts = await db.query('SELECT phone,attempts FROM parent_auth_rate_limits');
      assert.ok(counts.every((row) => Number(row.attempts) === 3));
    });

    await t.test('SELECT FOR UPDATE blocks a concurrent writer until the locking transaction commits', async () => {
      await clearLimiter(db);
      const lockId = 'for-update-lock-contract';
      await db.execute('INSERT INTO parent_auth_rate_limits (id,phone,attempts,first_attempt_at,blocked_until,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?)', [lockId, '+233200000001', 1, new Date(), new Date(), new Date()]);
      const first = await serverPool.getConnection();
      const second = await serverPool.getConnection();
      try {
        const [firstId] = await first.query('SELECT CONNECTION_ID() AS id');
        const [secondId] = await second.query('SELECT CONNECTION_ID() AS id');
        assert.notEqual(Number(firstId[0].id), Number(secondId[0].id));
        await first.beginTransaction();
        const [locked] = await first.query('SELECT id FROM parent_auth_rate_limits WHERE id=? FOR UPDATE', [lockId]);
        assert.equal(locked.length, 1);
        await second.beginTransaction();
        let secondUpdateFinished = false;
        const update = second.execute('UPDATE parent_auth_rate_limits SET attempts=attempts+1 WHERE id=?', [lockId]).then(() => { secondUpdateFinished = true; });
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(secondUpdateFinished, false, 'TiDB must keep the writer blocked by the row lock');
        await first.commit();
        await update;
        await second.commit();
        const row = (await db.query('SELECT attempts FROM parent_auth_rate_limits WHERE id=?', [lockId]))[0];
        assert.equal(Number(row.attempts), 2);
      } catch (error) {
        try { await first.rollback(); } catch { /* transaction may already be committed */ }
        try { await second.rollback(); } catch { /* transaction may already be committed */ }
        throw error;
      } finally { first.release(); second.release(); }
    });

    await t.test('actual TiDB transaction rolls back limiter inserts and updates after a partial failure', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      failOnce = true;
      const failed = await auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'rollback-ip' });
      assert.equal(failed.status, 503);
      assert.equal(await countRows(db, 'parent_auth_rate_limits'), 0);
      assert.equal(await countRows(db, 'auth_sessions'), 0);
      const success = await auth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'rollback-ip' });
      assert.equal(success.ok, true);
      assert.equal(await countRows(db, 'parent_auth_rate_limits'), 2);
    });

    await t.test('parent session restores across auth instances and linked-student authorization remains scoped', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      const result = await auth.loginByPhoneFromDatabase({ phone: '+233247293733', ipAddress: 'session-test-ip' });
      assert.equal(result.ok, true);
      assert.equal(result.user.roleKey, 'PARENT');
      assert.equal(result.redirectTo, '/parent-dashboard');
      const restored = await (await makeAuth(db)).authenticateAsync(result.token);
      assert.equal(restored.id, primary.parentId);
      assert.equal(restored.schoolId, SCHOOL_ID);
      const enrollment = createAdmissionEnrollmentService({ database: db });
      const linked = await enrollment.authorizeParentStudent({ parentUserId: primary.parentId, schoolId: SCHOOL_ID, permanentStudentId: primary.permanentStudentId });
      assert.equal(linked.permanentStudentId, primary.permanentStudentId);
      await assert.rejects(() => enrollment.authorizeParentStudent({ parentUserId: primary.parentId, schoolId: SCHOOL_ID, permanentStudentId: 'OSAAH/2026/9999' }), (error) => error.status === 403);
      const sessions = await db.query('SELECT token_hash,revoked_at FROM auth_sessions');
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].revoked_at, null);
      assert.notEqual(sessions[0].token_hash, result.token);
    });

    await t.test('all school roles retain TiDB-backed login, role routing, and durable session restoration', async () => {
      await resetAuthSessions(db);
      const roles = [
        ['PROPRIETOR', '/dashboard'], ['SCHOOL_ADMIN', '/dashboard'],
        ['HEADTEACHER', '/dashboard'], ['ASSISTANT_HEADTEACHER', '/dashboard'],
        ['ACCOUNTANT_BURSAR', '/dashboard'], ['TEACHER', '/academics']
      ];
      const passwords = new Map();
      for (let index = 0; index < roles.length; index += 1) {
        const [roleKey] = roles[index];
        const userId = `staff-user-${index}`;
        const roleId = `staff-role-${index}`;
        const password = `CI-only-${roleKey}-password`;
        passwords.set(roleKey, password);
        await db.execute('INSERT INTO users (id,school_id,username,email,password_hash,status) VALUES (?,?,?,?,?,?)', [userId, SCHOOL_ID, `${roleKey.toLowerCase()}@test.invalid`, `${roleKey.toLowerCase()}@test.invalid`, await bcrypt.hash(password, 4), 'ACTIVE']);
        await db.execute('INSERT INTO roles (id,school_id,role_key,oversight_rank) VALUES (?,?,?,?)', [roleId, SCHOOL_ID, roleKey, 10 - index]);
        await db.execute('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)', [userId, roleId]);
        if (roleKey === 'TEACHER') await db.execute('INSERT INTO staff (id,user_id,school_id) VALUES (?,?,?)', ['teacher-staff-id', userId, SCHOOL_ID]);
      }
      const schoolAuth = await makeAuth(db);
      for (const [roleKey, route] of roles) {
        const login = await schoolAuth.loginFromDatabase({ username: `${roleKey.toLowerCase()}@test.invalid`, password: passwords.get(roleKey), portal: 'school', role: roleKey });
        assert.equal(login.ok, true, `${roleKey} database authentication`);
        assert.equal(login.user.roleKey, roleKey);
        assert.equal(login.redirectTo, route);
        const restored = await (await makeAuth(db)).authenticateAsync(login.token);
        assert.equal(restored.roleKey, roleKey);
        assert.equal(restored.schoolId, SCHOOL_ID);
      }

      const proprietorPassword = 'CI-only-dedicated-proprietor-password';
      await db.execute('INSERT INTO portal_users (id,portal_name,email,password_hash,role,is_active) VALUES (?,?,?,?,?,TRUE)', ['dedicated-proprietor', 'CI Proprietor', 'proprietor@test.invalid', await bcrypt.hash(proprietorPassword, 4), 'PROPRIETOR']);
      const proprietor = await createProprietorAuthenticationController({ database: db })({ email: 'proprietor@test.invalid', password: proprietorPassword });
      assert.equal(proprietor.status, 200);
      assert.equal(proprietor.body.user.role, 'PROPRIETOR');
      process.stdout.write('REAL_TIDB_SCHOOL_ROLE_AUTH=6/6 PASS; REAL_TIDB_DEDICATED_PROPRIETOR=PASS\n');
    });

    await t.test('unknown, missing, and incomplete legacy schemas fail closed before authentication', async () => {
      await clearLimiter(db); await resetAuthSessions(db);
      await db.execute('DROP TABLE parent_auth_rate_limits');
      const missingAuth = await makeAuth(db);
      assert.equal((await missingAuth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'missing-table' })).status, 503);
      await db.execute('CREATE TABLE parent_auth_rate_limits (id VARCHAR(191) NOT NULL PRIMARY KEY, phone VARCHAR(50) NOT NULL, attempts INT NOT NULL DEFAULT 1, first_attempt_at DATETIME NOT NULL, created_at DATETIME NULL, updated_at DATETIME NULL, KEY idx_parent_rate_limit_phone (phone))');
      const incompleteAuth = await makeAuth(db);
      assert.equal((await incompleteAuth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'incomplete-table' })).status, 503);
      await db.execute('DROP TABLE parent_auth_rate_limits');
      await db.execute(LEGACY_DDL);
      assert.equal(await inspectParentRateLimitSchema(db), 'legacy');
    });

    await t.test('bucket schema uses real TiDB storage and the same phone-only throttle', async () => {
      const bucketParent = await seedParent(bucketDb, 101, PHONE);
      const bucketAuth = await makeAuth(bucketDb);
      assert.equal(await inspectParentRateLimitSchema(bucketDb), 'bucket');
      const outcomes = [];
      for (let index = 0; index < 4; index += 1) outcomes.push(await bucketAuth.loginByPhoneFromDatabase({ phone: PHONE, ipAddress: 'bucket-layout-ip' }));
      assert.deepEqual(outcomes.map((item) => item.status), [undefined, undefined, undefined, 429]);
      const rows = await bucketDb.query('SELECT bucket_hash,window_started_at,request_count,updated_at FROM parent_auth_rate_limits');
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => Number(row.request_count) === 3));
      assert.equal(bucketParent.parentId, 'parent-101');
    });

    process.stdout.write('REAL_TIDB_PARENT_LIMITS=PASS\n');
  } finally {
    try {
      for (const database of [db, bucketDb]) {
        if (!database) continue;
        for (const table of ['parent_auth_rate_limits','auth_sessions','parent_auth_challenges','parent_student_links','student_enrollments','student_profiles','students','staff_assignments','staff','user_roles','role_permissions','permissions','roles','portal_users','users','schools']) {
          try { await database.execute(`DROP TABLE IF EXISTS \`${table}\``); } catch { /* CI teardown removes both disposable databases. */ }
        }
      }
    } finally {
      await Promise.all([serverPool.end(), bucketPool.end()]);
    }
  }
});
