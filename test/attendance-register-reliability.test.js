import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AttendanceApiError, requestAttendanceJson } from '../public/attendance-api.js';
import { createAttendanceRegisterService, isAttendanceCalendarDate } from '../src/attendance-register-service.js';
import { DEFAULT_PRODUCTION_SCHOOL_ID } from '../src/school-context.js';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { createStudentService } from '../src/students.js';
import { createAttendanceService } from '../src/attendance.js';
import { createServer } from 'node:http';
import { scryptSync } from 'node:crypto';

const PASSWORD = 'AttendanceRegister!2026';
const SECRET = 'attendance-register-reliability-secret';
const YEAR = { yearId: 'ay-2026', yearName: '2026/2027', yearStartsOn: '2026-09-01', yearEndsOn: '2027-08-31', termId: 'term-1', termName: 'First Term', termStartsOn: '2026-09-01', termEndsOn: '2026-12-20' };
const DATE = '2026-10-10';

function mockResponse(status, body, contentType = 'application/json; charset=utf-8') {
  let reads = 0;
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null }, async text() { reads += 1; return body; }, readCount: () => reads };
}
test('attendance client parses a valid response body exactly once', async () => {
  const response = mockResponse(200, JSON.stringify({ success: true, register: [] }));
  assert.deepEqual(await requestAttendanceJson('/api/attendance/register', {}, { fetchImpl: async () => response }), { success: true, register: [] });
  assert.equal(response.readCount(), 1);
});
test('attendance client turns HTML, blank bodies, malformed JSON, and status failures into controlled errors', async () => {
  for (const [status, body, type, code, message] of [
    [200, '<!doctype html><title>Server Error</title>', 'text/html', 'ATTENDANCE_UNEXPECTED_CONTENT_TYPE', /unexpected response/],
    [401, '<html>login</html>', 'text/html', 'ATTENDANCE_AUTH_REQUIRED', /session has expired/],
    [200, '', 'application/json', 'ATTENDANCE_EMPTY_RESPONSE', /empty response/],
    [200, '{not json', 'application/json', 'ATTENDANCE_MALFORMED_JSON', /invalid response/],
    [503, JSON.stringify({ error: 'Database secret must not be shown' }), 'application/json', 'ATTENDANCE_HTTP_503', /temporarily unavailable/]
  ]) {
    await assert.rejects(requestAttendanceJson('/api/attendance/register', {}, { fetchImpl: async () => mockResponse(status, body, type) }), (error) => {
      assert.ok(error instanceof AttendanceApiError);
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /Database secret/);
      return true;
    });
  }
});
test('attendance client reports network failures and request timeouts without losing selected data', async () => {
  await assert.rejects(requestAttendanceJson('/api/attendance/register', {}, { fetchImpl: async () => { throw new Error('offline'); } }), (error) => error.code === 'ATTENDANCE_NETWORK_ERROR');
  await assert.rejects(requestAttendanceJson('/api/attendance/register', {}, { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }), (error) => error.code === 'ATTENDANCE_REQUEST_TIMEOUT');
});
test('calendar validation is strict and the today value uses the configured school timezone', async () => {
  assert.equal(isAttendanceCalendarDate(DATE), true);
  assert.equal(isAttendanceCalendarDate('2026-02-30'), false);
  const previous = process.env.OSAAH_SCHOOL_TIMEZONE;
  delete process.env.OSAAH_SCHOOL_TIMEZONE;
  const service = createAttendanceRegisterService({ schoolSettings: { async read() { return { settings: [{ key: 'schoolInformation', value: { timezone: 'Pacific/Honolulu' } }] }; } }, now: () => new Date('2026-10-10T01:00:00.000Z') });
  try { assert.equal(await service.today({ schoolId: 'school-1' }), '2026-10-09'); }
  finally { if (previous === undefined) delete process.env.OSAAH_SCHOOL_TIMEZONE; else process.env.OSAAH_SCHOOL_TIMEZONE = previous; }
});
test('durable register resolves academic period IDs, enforces term dates, and reads the enrolled database roster', async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('FROM academic_years y JOIN terms t')) return [YEAR];
    if (sql.includes('FROM student_enrollments e')) return [{ studentId: 'profile-1', permanentStudentId: 'OSAAH-100', firstName: 'Ama', middleName: null, surname: 'Mensah', gender: 'FEMALE' }];
    return [];
  } };
  const memoryStudents = { listStudents() { throw new Error('Durable register must not use the in-memory roster.'); } };
  const service = createAttendanceRegisterService({ database, students: memoryStudents });
  const period = await service.resolvePeriod({ schoolId: 'school-1', academicYear: '2026/2027', term: 'First Term', date: DATE });
  assert.equal(period.yearId, 'ay-2026');
  assert.equal(period.termId, 'term-1');
  await assert.rejects(service.resolvePeriod({ schoolId: 'school-1', academicYear: '2026/2027', term: 'First Term', date: '2027-01-10' }), /outside the selected term/);
  const roster = await service.enrolledStudents({ schoolId: 'school-1', classId: 'class-1', className: 'Basic 1', canonicalClassName: 'BASIC1', period, actor: { schoolId: 'school-1' } });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].studentId, 'profile-1');
  assert.deepEqual(calls.at(-1).params, ['school-1', 'class-1', 'ay-2026', 'term-1']);
});
test('sample-mode attendance writes only the dedicated sample fixture repository', async () => {
  const memoryStudents = createStudentService({ schoolId: 'school-1' });
  memoryStudents.seedSampleStudents();
  const sample = memoryStudents.listStudents({ requestedSchoolId: 'school-1', includeTestRecords: true }).find((student) => student.isTestRecord);
  const fixtureCalls = [];
  let fixture = null;
  const sampleFixtureRepository = {
    async getFixture(identity, actor) {
      fixtureCalls.push({ operation: 'read', identity, actor });
      return fixture;
    },
    async ensureFixture(input, actor) {
      fixtureCalls.push({ operation: 'write', input, actor });
      fixture = { fixturePayload: structuredClone(input.fixturePayload) };
      return fixture;
    }
  };
  const forbiddenProductionWrites = { async saveStudentAttendance() { throw new Error('production write attempted'); } };
  const service = createAttendanceRegisterService({ students: memoryStudents, attendance: forbiddenProductionWrites, attendanceRepository: forbiddenProductionWrites, sampleFixtureRepository });
  const period = { ...YEAR, date: DATE };
  const records = await service.saveSampleAttendance([{ studentId: sample.id, classId: 'class-1', status: 'PRESENT', date: DATE }], { id: 'teacher-1', schoolId: 'school-1', permissions: new Set(['attendance.write']) }, period);
  assert.equal(records[0].studentId, sample.id);
  assert.equal(records[0].isTestRecord, true);
  assert.ok(fixtureCalls.some((call) => call.operation === 'write'));
  assert.ok(fixtureCalls.every((call) => call.identity?.fixtureType === 'attendance' || call.input?.fixtureType === 'attendance'));
  assert.equal(fixtureCalls.find((call) => call.operation === 'write').actor.permissions.has('sample.fixtures.write'), true);
});

function makeUser(id, permissions = ['attendance.read', 'attendance.write']) {
  const salt = `${id}-salt`;
  return { id, username: `${id}@example.test`, passwordHash: `${salt}:${scryptSync(PASSWORD, salt, 32).toString('hex')}`, portal: 'school', roleKey: 'HEADTEACHER', schoolId: DEFAULT_PRODUCTION_SCHOOL_ID, permissions: new Set(permissions) };
}
async function startApp(t, app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function databaseStub({ periodFailure = false, emptyRoster = false, fixtureStore = new Map() } = {}) {
  const executed = [];
  const rosterQueryParams = [];
  return {
    executed,
    rosterQueryParams,
    async query(sql, params = []) {
      if (sql.includes('SELECT y.id AS yearId')) {
        if (periodFailure) throw new Error('sensitive database diagnostic text');
        return [YEAR];
      }
      if (sql.includes('FROM classes')) return [{ id: 'class-1', name: 'Basic 1', displayOrder: 1 }];
      if (sql.includes('FROM student_enrollments e')) {
        rosterQueryParams.push(params);
        return emptyRoster ? [] : [{ studentId: 'profile-1', permanentStudentId: 'OSAAH-100', firstName: 'Ama', middleName: null, surname: 'Mensah', gender: 'FEMALE' }];
      }
      if (sql.includes('FROM sample_data_fixtures')) {
        const key = params.slice(0, 6).join('|');
        const value = fixtureStore.get(key);
        return value ? [{ fixtureId: value.fixtureId, schoolId: value.schoolId, sampleStudentId: value.sampleStudentId, academicYearId: value.academicYearId, termId: value.termId, classId: value.classId, fixtureType: value.fixtureType, fixturePayload: JSON.stringify(value.fixturePayload), fixtureVersion: value.fixtureVersion, createdAt: value.createdAt, updatedAt: value.updatedAt }] : [];
      }
      return [];
    },
    async execute(sql, params = []) {
      executed.push({ sql, params });
      if (sql.includes('INSERT INTO sample_data_fixtures')) {
        const [fixtureId, schoolId, sampleStudentId, academicYearId, termId, classId, fixtureType, fixturePayload, fixtureVersion, createdAt, updatedAt] = params;
        fixtureStore.set([schoolId, sampleStudentId, academicYearId, termId, classId, fixtureType].join('|'), { fixtureId, schoolId, sampleStudentId, academicYearId, termId, classId, fixtureType, fixturePayload: JSON.parse(fixturePayload), fixtureVersion, createdAt, updatedAt });
      }
      return { affectedRows: 1 };
    }
  };
}

test('HTTP register uses the durable active enrollment roster and returns a consistent JSON response', async (t) => {
  const reporter = makeUser('register-reader');
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const database = databaseStub();
  const schoolSettings = { async read() { return { settings: [] }; } };
  const students = createStudentService({ schoolId: reporter.schoolId });
  const app = createApp({ auth, database, schoolSettings, students, aiEnabled: false });
  const base = await startApp(t, app);
  const token = auth.login({ username: reporter.username, password: PASSWORD, portal: 'school', role: reporter.roleKey }).token;
  const response = await fetch(`${base}/api/attendance/register?classId=class-1&academicYear=2026%2F2027&term=First%20Term&date=${DATE}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.message, 'Register loaded successfully.');
  assert.equal(body.data.date, DATE);
  assert.equal(body.register.length, 1);
  assert.equal(body.register[0].studentId, 'profile-1');
  assert.deepEqual(database.rosterQueryParams[0], [reporter.schoolId, 'class-1', 'ay-2026', 'term-1']);
});
test('HTTP register reports a genuine empty enrollment set as a successful empty register', async (t) => {
  const reporter = makeUser('register-reader-empty', ['attendance.read']);
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const students = createStudentService({ schoolId: reporter.schoolId });
  const app = createApp({ auth, database: databaseStub({ emptyRoster: true }), schoolSettings: { async read() { return { settings: [] }; } }, students, aiEnabled: false });
  const base = await startApp(t, app);
  const token = auth.login({ username: reporter.username, password: PASSWORD, portal: 'school', role: reporter.roleKey }).token;
  const response = await fetch(`${base}/api/attendance/register?classId=class-1&academicYear=2026%2F2027&term=First%20Term&date=${DATE}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.register, []);
  assert.equal(body.date, DATE);
});

test('HTTP register query failures are caught and always returned as safe JSON', async (t) => {
  const reporter = makeUser('register-reader-failure', ['attendance.read']);
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const database = databaseStub({ periodFailure: true });
  const students = createStudentService({ schoolId: reporter.schoolId });
  const app = createApp({ auth, database, schoolSettings: { async read() { return { settings: [] }; } }, students, aiEnabled: false });
  const base = await startApp(t, app);
  const token = auth.login({ username: reporter.username, password: PASSWORD, portal: 'school', role: reporter.roleKey }).token;
  const response = await fetch(`${base}/api/attendance/register?classId=class-1&academicYear=2026%2F2027&term=First%20Term&date=${DATE}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, /temporarily unavailable/);
  assert.doesNotMatch(body.error, /sensitive database diagnostic text/);
});

test('attendance endpoints preserve 401/403 authorization and return documented JSON error payloads', async (t) => {
  const restricted = makeUser('register-reader-restricted', ['students.read']);
  const auth = createAuthService({ users: [restricted], sessionSecret: SECRET });
  const app = createApp({ auth, database: databaseStub(), schoolSettings: { async read() { return { settings: [] }; } }, students: createStudentService({ schoolId: restricted.schoolId }), aiEnabled: false });
  const base = await startApp(t, app);
  const anonymous = await fetch(`${base}/api/attendance/register`);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('content-type'), /application\/json/);
  assert.equal((await anonymous.json()).data, null);
  const token = auth.login({ username: restricted.username, password: PASSWORD, portal: 'school', role: restricted.roleKey }).token;
  const forbidden = await fetch(`${base}/api/attendance/register`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'ATTENDANCE_FORBIDDEN');
  const missing = await fetch(`${base}/api/attendance/not-a-route`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
});

test('attendance batch corrections require attendance.correct and stale rows cannot be recreated', async (t) => {
  const writer = makeUser('register-writer-only');
  const corrector = makeUser('register-authorized-corrector', ['attendance.read', 'attendance.write', 'attendance.correct']);
  const auth = createAuthService({ users: [writer, corrector], sessionSecret: SECRET });
  const database = databaseStub();
  const app = createApp({ auth, database, schoolSettings: { async read() { return { settings: [] }; } }, students: createStudentService({ schoolId: writer.schoolId }), aiEnabled: false });
  const base = await startApp(t, app);
  const body = { sampleMode: false, entries: [{ studentId: 'profile-1', version: 1, classId: 'class-1', academicYear: '2026/2027', term: 'First Term', date: DATE, status: 'PRESENT', method: 'MANUAL' }] };
  const writerToken = auth.login({ username: writer.username, password: PASSWORD, portal: 'school', role: writer.roleKey }).token;
  const forbidden = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers: { authorization: `Bearer ${writerToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'ATTENDANCE_CORRECTION_FORBIDDEN');
  const correctorToken = auth.login({ username: corrector.username, password: PASSWORD, portal: 'school', role: corrector.roleKey }).token;
  const stale = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers: { authorization: `Bearer ${correctorToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'ATTENDANCE_VERSION_CONFLICT');
  assert.equal(database.executed.some(({ sql }) => sql.includes('INSERT INTO student_attendance')), false);
});

test('malformed and oversized attendance request bodies return controlled JSON errors', async (t) => {
  const writer = makeUser('register-json-writer');
  const auth = createAuthService({ users: [writer], sessionSecret: SECRET });
  const app = createApp({ auth, database: databaseStub(), schoolSettings: { async read() { return { settings: [] }; } }, students: createStudentService({ schoolId: writer.schoolId }), aiEnabled: false });
  const base = await startApp(t, app);
  const token = auth.login({ username: writer.username, password: PASSWORD, portal: 'school', role: writer.roleKey }).token;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const malformed = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_JSON');
  const oversized = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers, body: ' '.repeat(100_001) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'REQUEST_BODY_TOO_LARGE');
});

test('HTTP Sample / Test saves use isolated fixtures and do not insert official attendance records', async (t) => {
  const reporter = makeUser('register-sample-writer');
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const database = databaseStub();
  const students = createStudentService({ schoolId: reporter.schoolId });
  students.seedSampleStudents();
  const sample = students.listStudents({ requestedSchoolId: reporter.schoolId, includeTestRecords: true }).find((student) => student.isTestRecord);
  const app = createApp({ auth, database, schoolSettings: { async read() { return { settings: [] }; } }, students, aiEnabled: false });
  const base = await startApp(t, app);
  const token = auth.login({ username: reporter.username, password: PASSWORD, portal: 'school', role: reporter.roleKey }).token;
  const registerResponse = await fetch(`${base}/api/attendance/register?classId=class-1&academicYear=2026%2F2027&term=First%20Term&date=${DATE}&sampleMode=true`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(registerResponse.status, 200);
  const sampleRegister = await registerResponse.json();
  assert.equal(sampleRegister.sampleMode, true);
  assert.ok(sampleRegister.register.length > 0);
  assert.ok(sampleRegister.register.every((record) => record.isTestRecord));
  const response = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sampleMode: true, entries: [{ studentId: sample.id, classId: 'class-1', academicYear: '2026/2027', term: 'First Term', date: DATE, status: 'PRESENT', method: 'MANUAL', source: 'TEST', version: null }] }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.synced[0].isTestRecord, true);
  assert.ok(database.executed.some(({ sql }) => sql.includes('INSERT INTO sample_data_fixtures')));
  assert.equal(database.executed.some(({ sql }) => sql.includes('INSERT INTO student_attendance')), false);
  const duplicate = await fetch(`${base}/api/attendance/students/sync`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sampleMode: true, entries: [{ studentId: sample.id, classId: 'class-1', academicYear: '2026/2027', term: 'First Term', date: DATE, status: 'PRESENT', method: 'MANUAL', source: 'TEST', version: null }] }) });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'ATTENDANCE_VERSION_CONFLICT');
});
test('attendance page keeps semantic controls and shows mobile cards through tablet widths without horizontal overflow', async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/attendance.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/attendance-register.js', import.meta.url), 'utf8')
  ]);
  for (const id of ['attendance-class', 'attendance-academic-year', 'attendance-term', 'attendance-date', 'attendance-sample-mode', 'attendance-mobile-cards', 'attendance-status']) assert.ok(html.includes(id), `expected register element ${id}`);
  assert.match(css, /@media\(max-width:1023px\).*attendance-mobile-cards\{display:block\}/s);
  assert.match(css, /\.attendance-page\{box-sizing:border-box;width:calc\(100% - 32px\);max-width:1220px/);
  assert.match(script, /Changing register mode will discard unsaved attendance marks/);
  assert.match(script, /requestAttendanceJson/);
  assert.match(script, /attendance:save-confirmed/);
});
