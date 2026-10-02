import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';

const SECRET = 'student-attendance-overview-api-secret-2026';
const PASSWORD = 'OverviewTest!2026';
function user(id, roleKey, permissions) {
  const salt = `${id}-salt`;
  return { id, username: `${id}@example.test`, passwordHash: `${salt}:${scryptSync(PASSWORD, salt, 32).toString('hex')}`, portal: 'school', roleKey, schoolId: 'osaah-school', permissions: new Set(permissions) };
}
async function start(t, options) {
  const server = createServer(createApp({ ...options, aiEnabled: false }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function signIn(auth, username, role) {
  const result = auth.login({ username, password: PASSWORD, portal: 'school', role });
  assert.equal(result.ok, true);
  return result.token;
}

test('GET /api/attendance/students/overview authenticates and forwards validated reporting filters to the server service', async (t) => {
  const reporter = user('overview-headteacher', 'HEADTEACHER', ['attendance.read']);
  const calls = [];
  const service = { async overview(filters, actor) { calls.push({ filters, actor }); return { authoritative: true, source: 'TiDB/student_attendance + student_enrollments', classes: [], summary: {}, filters }; } };
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const base = await start(t, { auth, studentAttendanceOverview: service });
  const token = signIn(auth, reporter.username, reporter.roleKey);
  const response = await fetch(`${base}/api/attendance/students/overview?academicYear=AY-2026&term=T1&classId=C1&week=2026-W39&gender=BOYS&status=PRESENT&asOfDate=2026-09-25`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authoritative, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.id, reporter.id);
  assert.deepEqual(calls[0].filters, { academicYear: 'AY-2026', term: 'T1', classId: 'C1', week: '2026-W39', gender: 'BOYS', status: 'PRESENT', asOfDate: '2026-09-25', month: undefined, startDate: undefined, endDate: undefined });
});

test('the student overview route requires a session and the existing attendance.read permission', async (t) => {
  const headteacher = user('overview-authorized', 'HEADTEACHER', ['attendance.read']);
  const hr = user('overview-hr', 'HR_OFFICER', ['staff.attendance.read']);
  const auth = createAuthService({ users: [headteacher, hr], sessionSecret: SECRET });
  const service = { async overview() { return { authoritative: true }; } };
  const base = await start(t, { auth, studentAttendanceOverview: service });
  let response = await fetch(`${base}/api/attendance/students/overview`);
  assert.equal(response.status, 401);
  const hrToken = signIn(auth, hr.username, hr.roleKey);
  response = await fetch(`${base}/api/attendance/students/overview`, { headers: { authorization: `Bearer ${hrToken}` } });
  assert.equal(response.status, 403, 'staff-attendance access alone cannot expose student records');
});

test('the API returns service errors with their explicit fail-closed HTTP status', async (t) => {
  const reporter = user('overview-calendar-error', 'HEADTEACHER', ['attendance.read']);
  const auth = createAuthService({ users: [reporter], sessionSecret: SECRET });
  const service = { async overview() { throw Object.assign(new Error('Published academic calendar data is unavailable.'), { status: 503 }); } };
  const base = await start(t, { auth, studentAttendanceOverview: service });
  const token = signIn(auth, reporter.username, reporter.roleKey);
  const response = await fetch(`${base}/api/attendance/students/overview`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /calendar data/);
});

test('the existing staff overview route and required student dashboard columns remain present', () => {
  const server = fs.readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../public/attendance-overview.html', import.meta.url), 'utf8');
  assert.match(server, /\/api\/attendance\/staff\/overview/);
  assert.match(server, /\/api\/attendance\/students\/overview/);
  for (const label of ['No.','Class','Total Boys Enrolled','Total Girls Enrolled','Boys Present','Girls Present','Boys Absent','Girls Absent','Total Present','Total Absent','Unmarked Student-Days','Attendance Percentage']) assert.ok(page.includes(`<th>${label}</th>`), `dashboard must include ${label}`);
  assert.match(page, /STAFF ATTENDANCE OVERVIEW/);
  assert.match(page, /STUDENT ATTENDANCE OVERVIEW/);
  assert.match(page, /Recalculate Student Overview/);
  assert.doesNotMatch(page, /Historical student aggregation is unavailable pending Part 3/);
});
