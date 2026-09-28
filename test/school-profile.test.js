import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';

function request(server, path, token, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => { let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

test('School Profile uses the canonical OSAAH record, shows real metrics, and persists edits', async (t) => {
  const auth = createAuthService();
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school', role: 'PROPRIETOR' });
  assert.equal(proprietor.ok, true);
  const server = createServer(createApp({ auth })); await new Promise((resolve) => server.listen(0, resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const profilePage = await readFile(new URL('../public/school-profile.html', import.meta.url), 'utf8');
  assert.match(profilePage, /School Identity/); assert.match(profilePage, /School Statistics/); assert.doesNotMatch(profilePage, /Module access|School profile information is available/);
  const loaded = await request(server, '/api/school-profile', proprietor.token);
  assert.equal(loaded.status, 200); assert.equal(loaded.body.schoolId, 'school-osaah-daylight'); assert.equal(loaded.body.profile.name, 'OSAAH DAYLIGHT SCH. COM.'); assert.ok(loaded.body.statistics.totalStudents >= 0); assert.ok(Array.isArray(loaded.body.academic.classes));
  const saved = await request(server, '/api/school-profile', proprietor.token, 'PATCH', { schoolInformation: { name: 'OSAAH DAYLIGHT SCHOOL', motto: 'Aim high', vision: 'Every learner thrives', educationalLevels: ['Nursery', 'KG', 'Basic', 'JHS'] } });
  assert.equal(saved.status, 200); assert.equal(saved.body.profile.name, 'OSAAH DAYLIGHT SCHOOL'); assert.equal(saved.body.profile.vision, 'Every learner thrives');
  const reloaded = await request(server, '/api/school-profile', proprietor.token); assert.equal(reloaded.body.profile.name, 'OSAAH DAYLIGHT SCHOOL'); assert.equal(reloaded.body.profile.vision, 'Every learner thrives');
});

test('School Profile denies unauthorized users and keeps one canonical school context', async (t) => {
  const auth = createAuthService();
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school', role: 'TEACHER' });
  const proprietor = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school', role: 'PROPRIETOR' });
  const server = createServer(createApp({ auth })); await new Promise((resolve) => server.listen(0, resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await request(server, '/api/school-profile', teacher.token)).status, 403);
  assert.equal((await request(server, '/api/school-profile', teacher.token, 'PATCH', { schoolInformation: { motto: 'Nope' } })).status, 403);
  const result = await request(server, '/api/school-profile', proprietor.token); assert.equal(result.body.schoolId, 'school-osaah-daylight');
});
