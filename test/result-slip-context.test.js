import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { createStudentService } from '../src/students.js';

const schoolId = 'sch_default_01';
const actor = { id: 'result-teacher', userId: 'result-teacher', roleKey: 'PROPRIETOR', portal: 'school', schoolId, assignedClassIds: [], permissions: new Set(['*']) };

test('Result Slip keeps the existing double border and uses canonical single-select context controls', () => {
  const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  assert.match(html, /result-slip::after/);
  assert.match(html, /<select name="academicYear" required>/);
  assert.match(html, /<select name="term" required>/);
  assert.match(html, /<select name="classId" required>/);
  assert.match(html, /<select name="studentId" required>/);
  assert.match(html, /name="sampleMode"/);
  assert.match(client, /\/api\/academic\/result-students/);
  assert.match(client, /permanentStudentId/);
  assert.match(client, /isTestRecord/);
  assert.match(client, /\/api\/academic\/sample\/generate/);
  assert.match(client, /\/api\/academic\/result\?/);
});

test('Result Slip student API scopes by selected academic context and falls back to two samples only in test mode', async () => {
  const students = createStudentService({ schoolId });
  const real = students.createStudent({ firstName: 'Real', surname: 'Learner', classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  students.createStudent({ firstName: 'Other', surname: 'Year', classId: 'Primary 1', academicYearId: '2025/2026', termId: 'First Term' });
  students.seedSampleStudents();
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const app = createApp({ auth, students });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer authorized' };
    const realQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', sampleMode: 'false' });
    const realResponse = await fetch(`${base}/api/academic/result-students?${realQuery}`, { headers });
    assert.equal(realResponse.status, 200);
    const realBody = await realResponse.json();
    assert.deepEqual(realBody.students.map((item) => item.id), [real.id]);
    assert.equal(realBody.students[0].permanentStudentId, real.permanentStudentId);
    const sampleQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'KG1', sampleMode: 'true' });
    const sampleResponse = await fetch(`${base}/api/academic/result-students?${sampleQuery}`, { headers });
    assert.equal(sampleResponse.status, 200);
    const sampleBody = await sampleResponse.json();
    assert.equal(sampleBody.students.length, 2);
    assert.ok(sampleBody.students.every((item) => item.isTestRecord === true));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
