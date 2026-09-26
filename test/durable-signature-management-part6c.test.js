import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createApp } from '../src/server.mjs';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { context, durableGesFixture, schoolId, teacher } from './helpers/durable-ges-fixture.js';

const manager = { id: 'head-user', schoolId, roleKey: 'HEADTEACHER', permissions: new Set(['signatures.manage', 'results.generate', 'results.read']) };
const unauthorized = { id: 'teacher-user', schoolId, roleKey: 'TEACHER', permissions: new Set(['results.read']), assignedClassIds: ['class-a'] };

async function prepare() {
  const fixture = await durableGesFixture();
  fixture.migrate();
  fixture.db.exec(`
    INSERT INTO users VALUES('teacher-user','${schoolId}','Assigned Teacher','0241234567','ACTIVE');
    INSERT INTO users VALUES('head-user','${schoolId}','Official Headteacher','0241234568','ACTIVE');
    INSERT INTO users VALUES('foreign-user','school-b','Foreign Teacher','0241234569','ACTIVE');
    INSERT INTO staff_profiles VALUES('staff-teacher','${schoolId}','teacher-user');
    INSERT INTO staff_profiles VALUES('staff-head','${schoolId}','head-user');
    INSERT INTO staff_profiles VALUES('staff-foreign','school-b','foreign-user');
    INSERT INTO roles VALUES('role-teacher','${schoolId}','TEACHER');
    INSERT INTO roles VALUES('role-head','${schoolId}','HEADTEACHER');
    INSERT INTO roles VALUES('role-foreign-teacher','school-b','TEACHER');
    INSERT INTO user_roles VALUES('ur-teacher','teacher-user','role-teacher');
    INSERT INTO user_roles VALUES('ur-head','head-user','role-head');
    INSERT INTO user_roles VALUES('ur-foreign-teacher','foreign-user','role-foreign-teacher');
    INSERT INTO staff_assignments VALUES('assignment-teacher','staff-teacher','class-a','year-a','term-first',NULL);
  `);
  const service = createDurableAcademicService({ database: fixture.database, schoolId });
  await service.saveScore({ ...context, subjectId: 'subject-a', caScore: 42, examScore: 38 }, teacher);
  return fixture;
}

async function start(fixture, t) {
  const actors = { manager, teacher: unauthorized, anonymous: null };
  let latestPdf = null;
  const app = createApp({ database: fixture.database, auth: { authenticateAsync: async (token) => actors[token] ?? null }, resultPdf: {
    async pdf(value) { latestPdf = value; return Buffer.from('%PDF-1.7'); },
    filename() { return 'result.pdf'; }
  } });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const root = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token = 'manager', init = {}) => fetch(`${root}${path}`, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  return { request, getPdfInput: () => latestPdf };
}

const classPayload = (storageKey, overrides = {}) => ({
  signatoryRole: 'CLASS_TEACHER', classId: 'class-a', teacherId: 'staff-teacher',
  academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 128,
  storageKey, fullName: 'Forged Client Name', phone: '0240000000', school_id: 'school-b', ...overrides
});
const headPayload = (storageKey, overrides = {}) => ({
  signatoryRole: 'HEADTEACHER', mimeType: 'image/png', size: 128, storageKey,
  fullName: 'Forged Client Name', phone: '0240000000', school_id: 'school-b', ...overrides
});
const resultPath = '/api/academic/result?studentId=student-a&classId=class-a&academicYear=2026%2F2027&term=First%20Term';

test('signature management page accepts canonical class IDs and displays server-resolved identity/reference', async () => {
  const page = await readFile(new URL('../public/result-signatures.html', import.meta.url), 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /typeof c==='string'\?c:c\.id/);
  assert.match(script, /identity\?\.name/);
  assert.match(script, /s\.signatureUrl\|\|s\.storageKey/);
  assert.match(page, /this page does not transfer image files/);
});

test('signature management persists both roles; reinitialization, Result Slip, and PDF read the same rows', async (t) => {
  const fixture = await prepare();
  try {
    const firstApp = await start(fixture, t);
    const classUpload = await firstApp.request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify(classPayload('signatures/teacher-a.png')) });
    assert.equal(classUpload.status, 201);
    const classRecord = await classUpload.json();
    assert.equal(classRecord.staffId, 'staff-teacher');
    assert.equal(classRecord.fullName, 'Assigned Teacher');
    assert.equal(classRecord.phone, '0241234567');
    assert.equal(classRecord.schoolId, schoolId);
    assert.equal(fixture.db.prepare('SELECT signature_type FROM result_signatures WHERE id=?').get(classRecord.id).signature_type, 'CLASS_TEACHER');

    const headUpload = await firstApp.request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify(headPayload('signatures/head-a.png')) });
    assert.equal(headUpload.status, 201);
    const headRecord = await headUpload.json();
    assert.equal(headRecord.staffId, 'staff-head');
    assert.equal(headRecord.fullName, 'Official Headteacher');
    assert.equal(headRecord.phone, '0241234568');
    assert.equal(fixture.db.prepare('SELECT signature_type FROM result_signatures WHERE id=?').get(headRecord.id).signature_type, 'HEADTEACHER');
    const managementResponse = await firstApp.request('/api/result-signatures', 'manager');
    assert.equal(managementResponse.status, 200);
    const management = await managementResponse.json();
    assert.equal(management.signatures.length, 2);
    assert.ok(management.options.classes.some((item) => item.id === 'class-a' && item.name === 'Basic 4'));
    assert.ok(management.options.teachers.some((item) => item.id === 'staff-teacher' && item.name === 'Assigned Teacher'));
    assert.equal(management.options.headteacher.id, 'staff-head');

    // A new app/service instance has no access to an upload Map; it reads rows from the database.
    const restartedApp = await start(fixture, t);
    const slipResponse = await restartedApp.request(resultPath, 'teacher');
    assert.equal(slipResponse.status, 200);
    const result = (await slipResponse.json()).result;
    assert.deepEqual(result.signatures.map(({ signatoryRole, name, phone, signatureUrl }) => ({ signatoryRole, name, phone, signatureUrl })), [
      { signatoryRole: 'CLASS_TEACHER', name: 'Assigned Teacher', phone: '0241234567', signatureUrl: 'signatures/teacher-a.png' },
      { signatoryRole: 'HEADTEACHER', name: 'Official Headteacher', phone: '0241234568', signatureUrl: 'signatures/head-a.png' }
    ]);
    const pdfResponse = await restartedApp.request(resultPath.replace('/api/academic/result?', '/api/academic/result/pdf?'), 'teacher');
    assert.equal(pdfResponse.status, 200);
    assert.deepEqual(restartedApp.getPdfInput().signatures, result.signatures);
  } finally { fixture.db.close(); }
});

test('replacement is idempotent for retries and transactionally retains/deactivates old signature history', async (t) => {
  const fixture = await prepare();
  try {
    const app = await start(fixture, t);
    const upload = async (key) => app.request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify(classPayload(key)) });
    const firstResponse = await upload('signatures/teacher-a.png');
    const first = await firstResponse.json();
    fixture.db.prepare(`INSERT INTO result_signatures (id,school_id,staff_id,signature_type,class_id,academic_year,signature_url,is_active,uploaded_by,uploaded_at,deactivated_by,deactivated_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?,NULL,NULL,?,?)`).run('legacy-duplicate-active', schoolId, 'staff-teacher', 'CLASS_TEACHER', 'class-a', '2026/2027', 'signatures/legacy.png', manager.id, '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z');
    const retry = await upload('signatures/teacher-a.png');
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).id, first.id);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures').get().n, 2);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures WHERE is_active=1').get().n, 1);

    const replacementResponse = await upload('signatures/teacher-b.png');
    assert.equal(replacementResponse.status, 201);
    const replacement = await replacementResponse.json();
    const records = fixture.db.prepare('SELECT id,is_active,deactivated_by,deactivated_at FROM result_signatures WHERE school_id=? ORDER BY created_at,id').all(schoolId);
    assert.equal(records.length, 3);
    assert.equal(records.find((item) => item.id === first.id).is_active, 0);
    assert.equal(records.find((item) => item.id === first.id).deactivated_by, manager.id);
    assert.ok(records.find((item) => item.id === first.id).deactivated_at);
    assert.equal(records.find((item) => item.id === 'legacy-duplicate-active').is_active, 0);
    assert.equal(records.find((item) => item.id === replacement.id).is_active, 1);
    const resultResponse = await app.request(resultPath, 'teacher');
    const result = (await resultResponse.json()).result;
    assert.equal(result.signatures.find((item) => item.signatoryRole === 'CLASS_TEACHER').signatureUrl, 'signatures/teacher-b.png');
    await app.request(resultPath.replace('/api/academic/result?', '/api/academic/result/pdf?'), 'teacher');
    assert.equal(app.getPdfInput().signatures.find((item) => item.signatoryRole === 'CLASS_TEACHER').signatureUrl, 'signatures/teacher-b.png');

    const deactivated = await app.request(`/api/result-signatures/${replacement.id}`, 'manager', { method: 'DELETE' });
    assert.equal(deactivated.status, 200);
    assert.equal(fixture.db.prepare('SELECT is_active FROM result_signatures WHERE id=?').get(replacement.id).is_active, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures').get().n, 3);
    const afterDeactivation = await (await app.request(resultPath, 'teacher')).json();
    assert.equal(afterDeactivation.result.signatures.find((item) => item.signatoryRole === 'CLASS_TEACHER').id, undefined);
  } finally { fixture.db.close(); }
});

test('signature management preserves RBAC, validates staff scope/assets, and isolates Sample Mode', async (t) => {
  const fixture = await prepare();
  try {
    const app = await start(fixture, t);
    assert.equal((await app.request('/api/result-signatures', null, { method: 'POST', body: JSON.stringify(headPayload('signatures/head.png')) })).status, 401);
    assert.equal((await app.request('/api/result-signatures', 'teacher', { method: 'POST', body: JSON.stringify(headPayload('signatures/head.png')) })).status, 403);
    const invalid = [
      classPayload('signatures/../secret.png'),
      classPayload('signatures/teacher.jpg'),
      classPayload('signatures/teacher.png', { mimeType: 'image/gif' }),
      classPayload('signatures/teacher.png', { size: 0 }),
      classPayload('signatures/teacher.png', { size: 2 * 1024 * 1024 + 1 }),
      classPayload('signatures/teacher.png', { data: 'data:image/png;base64,AAAA' }),
      classPayload('signatures/teacher.png', { classId: 'foreign-class' }),
      classPayload('signatures/teacher.png', { teacherId: 'staff-foreign' })
    ];
    for (const body of invalid) assert.equal((await app.request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    const accepted = await app.request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify(classPayload('signatures/teacher.png')) });
    assert.equal(accepted.status, 201);
    const stored = (await accepted.json());
    assert.equal(stored.schoolId, schoolId, 'client school_id is ignored');
    assert.equal(fixture.db.prepare('SELECT school_id FROM result_signatures WHERE id=?').get(stored.id).school_id, schoolId);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM result_signatures WHERE school_id='school-b'").get().n, 0);

    const beforeSample = fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures').get().n;
    const sampleResponse = await app.request('/api/academic/sample/generate', 'manager', { method: 'POST', body: JSON.stringify({ classId: 'class-a', academicYear: '2026/2027', term: 'First Term' }) });
    assert.equal(sampleResponse.status, 201);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures').get().n, beforeSample);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures WHERE is_active=1').get().n, 1);
  } finally { fixture.db.close(); }
});
