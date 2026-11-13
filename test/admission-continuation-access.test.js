import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/server.mjs';

const SCHOOL_ID = 'school-osaah-daylight';
function actor(roleKey, permissions, schoolId = SCHOOL_ID, portal = 'school') { return { id: `test-${roleKey}`, roleKey, portal, schoolId, permissions: new Set(permissions) }; }
async function withServer(t, actors = {}) {
  const auth = { authenticateAsync: async (token) => actors[token] ?? null };
  const server = createServer(createApp({ auth }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections?.(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function session(token) { return { headers: { Cookie: `osaah_session=${token}` } }; }

test('old admission page URLs redirect to the unified registration form without guest sessions', async (t) => {
  const base = await withServer(t);
  for (const path of ['/admissions/apply', '/admission-application.html?applicationNumber=APP-READONLY&step=2', '/admissions.html']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/admissions/register');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('/admissions and /admissions/register serve the new staff registration interface', async (t) => {
  const base = await withServer(t, { staff: actor('HEADTEACHER', ['admissions.read', 'admissions.write']) });
  for (const path of ['/admissions', '/admissions/register']) {
    const response = await fetch(base + path, session('staff'));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Student Admission and Registration/);
  }
});

test('legacy admission mutation endpoints return JSON 410 while historical reads remain available', async (t) => {
  const base = await withServer(t, { staff: actor('HEADTEACHER', ['admissions.read', 'admissions.write', 'admissions.review', 'admissions.accept']) });
  const legacyWrites = [
    ['/api/admission-applications', 'POST'], ['/api/admission-applications/APP-1/update', 'PATCH'],
    ['/api/admission-applications/APP-1/documents', 'POST'], ['/api/admission-applications/APP-1/submit', 'POST'],
    ['/api/admission-applications/APP-1/review', 'POST'], ['/api/admission-applications/APP-1/enroll', 'POST'],
    ['/api/admission-applications/APP-1/offer-acceptance', 'POST'], ['/api/students', 'POST'],
    ['/api/students/link-existing', 'POST'], ['/api/admissions', 'POST'], ['/api/admissions/APP-1/decision', 'POST']
  ];
  for (const [path, method] of legacyWrites) {
    const response = await fetch(base + path, { method, headers: { ...session('staff').headers, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 410, `${method} ${path}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const payload = await response.json();
    assert.equal(payload.code, 'LEGACY_ADMISSION_WORKFLOW_RETIRED');
    assert.equal(payload.registrationUrl, '/admissions/register');
  }
  const historical = await fetch(base + '/api/admission-applications/APP-HISTORICAL', session('staff'));
  assert.equal(historical.status, 404);
  assert.deepEqual(await historical.json(), { error: 'Not found.' });
});

test('legacy admission writes are blocked even without a guest admission session', async (t) => {
  const base = await withServer(t);
  const response = await fetch(base + '/api/admission-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'LEGACY_ADMISSION_WORKFLOW_RETIRED');
});
