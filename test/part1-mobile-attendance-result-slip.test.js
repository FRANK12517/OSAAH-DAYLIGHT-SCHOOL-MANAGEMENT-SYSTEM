import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('mobile attendance renders cards while preserving the desktop table and existing attendance', async () => {
  const html = await read('public/attendance.html');
  const client = await read('public/attendance-register.js');
  const css = await read('public/styles.css');
  const server = await read('src/server.mjs');
  const registerService = await read('src/attendance-register-service.js');
  const attendanceRepository = await read('src/attendance-repository.js');
  assert.match(html, /id="attendance-register"/);
  assert.match(html, /id="attendance-mobile-cards"/);
  assert.match(client, /function mobileCard/);
  assert.match(client, /version/);
  assert.match(client, /saving = true/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /\.attendance-mobile-cards\{display:block\}/);
  assert.match(client, /requestAttendanceJson/);
  assert.match(client, /function isReadOnly/);
  assert.match(client, /changedEntries\.push/);
  assert.match(client, /max-width: 1023px/);
  assert.match(server, /attendanceRegister\.enrolledStudents/);
  assert.match(server, /ATTENDANCE_CORRECTION_FORBIDDEN/);
  assert.match(registerService, /FROM student_enrollments e/);
  assert.match(attendanceRepository, /saveStudentAttendanceBatch/);
  assert.match(attendanceRepository, /adapter\.transaction/);
  assert.doesNotMatch(client, /statuses\.map\(\(item\) => `<option>\$\{item\}<\/option>`/);
});

test('automatic result slip loads the default cascade and protects against stale responses', async () => {
  const client = await read('public/result-view.js');
  const page = await read('public/results.html');
  assert.match(page, /name="academicYear"/);
  assert.match(page, /name="term"/);
  assert.match(page, /name="classId"/);
  assert.match(page, /name="studentId"/);
  assert.match(client, /optionId\(classes\.find\(\(item\) => item\.isCurrent\) \|\| classes\[0\]\)/);
  assert.match(client, /studentLoadVersion/);
  assert.match(client, /studentLoadController\?\.abort/);
  assert.match(client, /requestVersion !== studentLoadVersion/);
  assert.match(client, /No students found for the selected class and academic context\./);
  assert.match(client, /Students:/);
  assert.match(client, /student\.name\).*—/);
});
