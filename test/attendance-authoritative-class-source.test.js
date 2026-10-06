import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalClassId } from '../src/student-classes.js';

test('Attendance UI does not own a second hard-coded class taxonomy', async () => {
  const html = await readFile(new URL('../public/attendance.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/attendance-register.js', import.meta.url), 'utf8');
  assert.match(html, /id="attendance-class"/);
  assert.doesNotMatch(html, /<option value="Primary 4">Primary 4<\/option>/);
  assert.match(client, /\/api\/attendance\/options/);
  assert.match(client, /result\.classes/);
  assert.match(client, /value="\$\{escape\(item\.id\)\}"/);
});

test('Basic 4 aliases resolve to the canonical Primary 4 class identity', () => {
  assert.equal(canonicalClassId('Basic 4'), 'Primary 4');
  assert.equal(canonicalClassId('Primary 4'), 'Primary 4');
  assert.equal(canonicalClassId('class_bs4_01'), null, 'durable IDs are resolved by the server class row, not guessed in the client');
});

test('Attendance API exposes authoritative classes and normalizes class scope before enrollment filtering', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /async function attendanceClassOptions\(actor\)/);
  assert.match(server, /SELECT id,name,sort_order AS displayOrder FROM classes WHERE school_id=\?/);
  assert.match(server, /classes: await attendanceClassOptions\(user\)/);
  assert.match(server, /resolveAttendanceClass\(user, requestedClassId\)/);
  assert.match(server, /sameClass\(entry\.classId\)/);
  assert.match(server, /throw Object\.assign\(new Error\('Forbidden\.'\), \{ status: 403 \}\)/);
});
