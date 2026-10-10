import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { visibleSidebar } from '../src/sidebar-registry.js';
import { createAttendanceService, ACADEMIC_YEAR_OPTIONS, TERM_OPTIONS } from '../src/attendance.js';
import { createStaffService } from '../src/staff.js';
import { DEMO_SCHOOL_ID, DEFAULT_PRODUCTION_SCHOOL_ID } from '../src/school-context.js';

const PASSWORD = 'StaffAttendance!2026';
const SECRET = 'test-staff-attendance-session-secret-2026';

function passwordHash(password, salt) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function roleUser(id, roleKey, schoolId = DEMO_SCHOOL_ID, permissions = []) {
  return {
    id,
    username: `${id}@osaah.test`,
    passwordHash: passwordHash(PASSWORD, `${id}-salt`),
    portal: 'school',
    roleKey,
    schoolId,
    permissions: new Set(permissions)
  };
}

async function startTestServer(t, options) {
  const server = createServer(createApp(options));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function login(auth, roleKey, username) {
  const result = auth.login({ username, password: PASSWORD, portal: 'school', role: roleKey });
  assert.equal(result.ok, true);
  return result.token;
}

async function request(base, token, pathname, body, extraHeaders = {}) {
  return fetch(`${base}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test('Headteacher and Assistant Headteacher see one Staff Attendance link in Staff Management', () => {
  for (const roleKey of ['HEADTEACHER', 'ASSISTANT_HEADTEACHER']) {
    const auth = createAuthService({ users: [roleUser(`user-${roleKey}`, roleKey)], sessionSecret: SECRET });
    const token = auth.login({ username: `user-${roleKey}@osaah.test`, password: PASSWORD, portal: 'school', role: roleKey }).token;
    const user = auth.authenticate(token);
    assert.ok(user.permissions.has('staff.attendance.read'));
    assert.ok(user.permissions.has('staff.attendance.write'));
    assert.equal(user.permissions.has('attendance.read'), false, 'the role-scoped Staff Attendance grant must not add student-attendance access');
    const sidebar = visibleSidebar(user);
    const attendanceLinks = sidebar.flatMap((group) => group.modules.map((module) => ({ group, module })))
      .filter(({ module }) => module.moduleKey === 'staff-attendance' || module.moduleKey === 'staff-attendance-hr');
    assert.equal(attendanceLinks.length, 1, `${roleKey} should not receive duplicate Staff Attendance links`);
    assert.equal(attendanceLinks[0].module.moduleKey, 'staff-attendance-hr');
    assert.equal(attendanceLinks[0].group.category, 'STAFF MANAGEMENT');
    assert.equal(attendanceLinks[0].module.route, '/staff/attendance');
  }
});

test('Headteacher and Assistant Headteacher can load, create, and update the same authorized staff attendance record', async (t) => {
  const headteacher = roleUser('headteacher-user', 'HEADTEACHER');
  const assistant = roleUser('assistant-user', 'ASSISTANT_HEADTEACHER');
  const reportHeadteacher = roleUser('report-headteacher-user', 'HEADTEACHER', DEMO_SCHOOL_ID, ['attendance.read']);
  const teacher = roleUser('classroom-teacher-user', 'TEACHER', DEMO_SCHOOL_ID, ['attendance.read', 'attendance.write']);
  const auth = createAuthService({ users: [headteacher, assistant, reportHeadteacher, teacher], sessionSecret: SECRET });
  let timestampMinute = 0;
  const now = () => `2026-10-01T08:${String(timestampMinute++).padStart(2, '0')}:00.000Z`;
  const staff = createStaffService({ schoolId: DEMO_SCHOOL_ID, now });
  const member = staff.createProfile({ fullName: 'Ama Mensah', employeeId: 'EMP-AMA', roleKey: 'TEACHER' });
  const attendance = createAttendanceService({ schoolId: DEMO_SCHOOL_ID, now });
  const auditEvents = [];
  const reportData = (filters) => ({ reportType: filters.reportType, title: 'STAFF ATTENDANCE REPORT', school: { name: 'OSAAH TEST SCHOOL' }, period: { label: filters.period ?? 'WEEKLY' }, filters, rows: [{ staffId: 'EMP-AMA', staffName: 'Ama Mensah' }], generatedAt: '2026-10-01T10:00:00.000Z', source: 'isolated-test' });
  const attendanceReports = { report: async (filters) => reportData(filters), exportReport: async (filters, _actor, format) => ({ content: Buffer.from('%PDF-test'), contentType: format === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'staff-report.pdf' }) };
  const base = await startTestServer(t, { auth, staff, attendance, attendanceReports, audit: (event) => auditEvents.push(event), aiEnabled: false });
  const headToken = await login(auth, 'HEADTEACHER', headteacher.username);
  const assistantToken = await login(auth, 'ASSISTANT_HEADTEACHER', assistant.username);
  const reportToken = await login(auth, 'HEADTEACHER', reportHeadteacher.username);
  const teacherToken = await login(auth, 'TEACHER', teacher.username);
  const query = '?academicYear=2026%2F2027&term=1st%20Term&date=2026-10-01';
  let response;

  for (const token of [headToken, assistantToken]) {
    response = await request(base, token, '/staff/attendance', undefined, { 'sec-fetch-mode': 'navigate' });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Staff Attendance Register/);
  }

  response = await request(base, headToken, `/api/attendance/staff${query}`);
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.deepEqual(data.staff.map(({ id, employeeId }) => ({ id, employeeId })), [{ id: member.id, employeeId: 'EMP-AMA' }]);
  assert.deepEqual(data.records, []);
  assert.deepEqual(data.attendanceOptions.map(({ status }) => status), ['PRESENT', 'ABSENT', 'LATE', 'CHECKED_IN', 'CHECKED_OUT', 'ON_LEAVE', 'EXCUSED']);
  assert.deepEqual(data.attendanceOptions.map(({ label }) => label), ['Present', 'Absent', 'Late', 'Checked In', 'Checked Out', 'On Leave', 'Excused']);

  response = await request(base, headToken, '/api/attendance/options');
  assert.equal(response.status, 200);
  data = await response.json();
  assert.deepEqual(data.academicYears.map(({ name }) => name), ACADEMIC_YEAR_OPTIONS);
  assert.deepEqual(data.terms.map(({ name }) => name), TERM_OPTIONS);

  for (const invalid of [
    { date: '2026-02-30', academicYear: '2026/2027', term: '1st Term' },
    { date: '2026-10-01', academicYear: '1900/1901', term: '1st Term' },
    { date: '2026-10-01', academicYear: '2026/2027', term: '4th Term' }
  ]) {
    response = await request(base, headToken, '/api/attendance/staff', {
      staffId: member.id,
      academicYear: invalid.academicYear,
      term: invalid.term,
      date: invalid.date,
      type: 'PRESENT',
      status: 'PRESENT'
    });
    assert.equal(response.status, 400);
  }
  assert.equal(attendance.listStaffRecords().length, 0, 'invalid date or academic scope must not create records');

  response = await request(base, teacherToken, `/api/attendance/staff${query}`);
  assert.equal(response.status, 403, 'student-attendance access alone must not expose the staff register');
  response = await request(base, teacherToken, '/api/attendance/staff/overview');
  assert.equal(response.status, 403, 'student-attendance access alone must not expose the staff overview');
  response = await request(base, teacherToken, '/api/attendance/staff', { staffId: member.id, academicYear: '2026/2027', term: '1st Term', date: '2026-10-01', type: 'PRESENT', status: 'PRESENT' });
  assert.equal(response.status, 403, 'student-attendance write access alone must not create staff records');
  assert.equal(attendance.listStaffRecords().length, 0);

  response = await request(base, headToken, '/api/attendance/staff', {
    staffId: member.id,
    academicYear: '2026/2027',
    term: '1st Term',
    date: '2026-10-01',
    type: 'PRESENT',
    status: 'PRESENT',
    time: '08:00',
    note: 'Arrived on time',
    source: 'LEAVE_RECONCILIATION'
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.source, 'MANUAL', 'the server must derive provenance, not trust the browser');
  assert.equal(created.recordedBy, headteacher.id);
  assert.equal(created.time, '08:00');
  assert.equal(created.note, 'Arrived on time');
  assert.equal(auditEvents.find((event) => event.entity === 'StaffAttendance' && event.action === 'CREATE')?.newValue.actorRoleKey, 'HEADTEACHER');

  response = await request(base, assistantToken, `/api/attendance/staff${query}`);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].id, created.id);

  response = await request(base, assistantToken, '/api/attendance/staff', {
    id: created.id,
    staffId: member.id,
    academicYear: '2026/2027',
    term: '1st Term',
    date: '2026-10-01',
    type: 'LATE',
    status: 'LATE',
    time: '08:25',
    note: 'Missing version token'
  });
  assert.equal(response.status, 409, 'user-driven updates must carry the last-seen record version');

  response = await request(base, assistantToken, '/api/attendance/staff', {
    id: created.id,
    expectedUpdatedAt: created.updatedAt,
    staffId: member.id,
    academicYear: '2026/2027',
    term: '1st Term',
    date: '2026-10-01',
    type: 'LATE',
    status: 'LATE',
    time: '08:25',
    note: 'Delayed by transport'
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.id, created.id, 'updating a record must preserve its canonical id');
  assert.equal(updated.status, 'LATE');
  assert.equal(updated.time, '08:25');
  assert.equal(updated.note, 'Delayed by transport');
  assert.equal(updated.recordedAt, created.recordedAt);
  assert.equal(updated.recordedBy, headteacher.id);
  assert.equal(updated.updatedBy, assistant.id);
  assert.equal(auditEvents.find((event) => event.entity === 'StaffAttendance' && event.action === 'UPDATE')?.newValue.actorRoleKey, 'ASSISTANT_HEADTEACHER');
  assert.ok(updated.recordedAt);
  assert.ok(updated.updatedAt);

  response = await request(base, headToken, '/api/attendance/staff', {
    id: created.id,
    expectedUpdatedAt: created.updatedAt,
    staffId: member.id,
    academicYear: '2026/2027',
    term: '1st Term',
    date: '2026-10-01',
    type: 'ABSENT',
    status: 'ABSENT',
    time: '08:40',
    note: 'Stale correction'
  });
  assert.equal(response.status, 409, 'an edit based on a superseded update timestamp must not overwrite a newer record');

  response = await request(base, headToken, `/api/attendance/staff${query}`);
  assert.equal(response.status, 200);
  data = await response.json();
  assert.equal(data.records.length, 1, 'revising a mark must not add a duplicate record');
  assert.equal(data.records[0].status, 'LATE');

  for (const path of [
    '/api/attendance/reports/canonical?reportType=STAFF&period=WEEKLY',
    '/api/attendance/reports/export?reportType=STAFF&period=WEEKLY&format=PDF',
    '/api/attendance/reports/print?reportType=STAFF&period=WEEKLY'
  ]) {
    response = await request(base, teacherToken, path);
    assert.equal(response.status, 403, 'student-attendance permission alone must not disclose staff report/export data');
  }
  response = await request(base, headToken, '/api/attendance/reports/canonical?reportType=CLASS&period=WEEKLY');
  assert.equal(response.status, 403, 'staff-only roles must not gain student or class attendance reports');
  response = await request(base, headToken, '/api/attendance/reports/canonical?reportType=STAFF&period=WEEKLY');
  assert.equal(response.status, 403, 'staff register access alone must not bypass the Attendance Reports module permission');
  response = await request(base, reportToken, '/api/attendance/reports/canonical?reportType=STAFF&period=WEEKLY');
  assert.equal(response.status, 200, `authorized report roles with staff.read retain the STAFF-only report: ${await response.clone().text()}`);
  const staffReport = await response.json();
  assert.equal(staffReport.reportType, 'STAFF');
  assert.ok(staffReport.rows.some((row) => row.staffId === 'EMP-AMA'));
  response = await request(base, reportToken, '/api/attendance/reports/export?reportType=STAFF&period=WEEKLY&format=PDF');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  response = await request(base, reportToken, '/api/attendance/reports/print?reportType=STAFF&period=WEEKLY');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /STAFF ATTENDANCE REPORT/);
});

test('database-backed Staff Attendance uses school-scoped canonical staff IDs from the staff table', async (t) => {
  const staffRows = [{ id: 'staff-db-001', employeeId: 'EMP-001', fullName: 'Kofi Mensah', roleKey: 'Teacher', schoolId: DEFAULT_PRODUCTION_SCHOOL_ID }];
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM staff s WHERE s\.school_id=\?/i.test(sql)) return staffRows;
      if (/SELECT id FROM staff WHERE id=\?/i.test(sql)) return [{ id: 'staff-db-001' }];
      return [];
    }
  };
  const auth = createAuthService({ users: [roleUser('db-headteacher', 'HEADTEACHER', DEFAULT_PRODUCTION_SCHOOL_ID)], sessionSecret: SECRET });
  const token = await login(auth, 'HEADTEACHER', 'db-headteacher@osaah.test');
  const base = await startTestServer(t, { auth, database, aiEnabled: false });
  const response = await request(base, token, '/api/attendance/staff?academicYear=2026%2F2027&term=1st%20Term&date=2026-10-01');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.staff, staffRows);
  assert.match(queries[0].sql, /FROM staff s WHERE s\.school_id=\?/i);
  assert.deepEqual(queries[0].params, [DEFAULT_PRODUCTION_SCHOOL_ID]);
});
