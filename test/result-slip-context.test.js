import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { sampleFixturesEnabled } from '../src/test-parent-fixture.js';

const schoolId = 'sch_default_01';
const actor = { id: 'result-teacher', userId: 'result-teacher', roleKey: 'PROPRIETOR', portal: 'school', schoolId, assignedClassIds: [], permissions: new Set(['*']) };

test('Result Slip keeps the existing double border and uses canonical single-select context controls', () => {
  const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const pdfClient = fs.readFileSync(new URL('../public/result-pdf.js', import.meta.url), 'utf8');
  assert.match(html, /result-slip::after/);
  assert.match(html, /<select name="academicYear" required>/);
  assert.match(html, /<select name="term" required>/);
  assert.match(html, /<select name="classId" required>/);
  assert.match(html, /<select name="studentId" required>/);
  assert.match(html, /name="sampleMode"/);
  assert.match(client, /\/api\/academic\/result-students/);
  assert.match(client, /permanentStudentId/);
  assert.match(client, /isTestRecord/);
  assert.match(client, /No students found for the selected class and academic context\./);
  assert.match(client, /x\.isSample \? '' : `<button class=/);
  assert.match(client, /const saveButton = host\.querySelector\('#save-result'\); if \(saveButton\)/);
  assert.match(client, /\/api\/academic\/sample\/generate/);
  assert.match(client, /form\.elements\.sampleMode\.checked\) values\.classId = form\.elements\.classId\.selectedOptions\[0\]\?\.textContent\.trim\(\)/);
  assert.match(client, /\/api\/academic\/result\?/);
  assert.match(pdfClient, /result\?\.isSample === true/);
  assert.match(pdfClient, /\/api\/academic\/sample\/result\/pdf/);
  assert.match(pdfClient, /sampleStudentId/);
});

test('Result Slip student API scopes real students and returns only existing samples in Test Mode', async () => {
  const students = createStudentService({ schoolId });
  const real = students.createStudent({ firstName: 'Real', surname: 'Learner', classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  students.createStudent({ firstName: 'Other', surname: 'Year', classId: 'Primary 1', academicYearId: '2025/2026', termId: 'First Term' });
  const readOnlyActor = { ...actor, roleKey: 'TEACHER', assignedClassIds: ['Primary 1'], permissions: new Set(['results.read']) };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : token === 'read-only' ? readOnlyActor : null };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousFixtureFlag = process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  process.env.VERCEL_ENV = 'production';
  process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = 'false';
  assert.equal(sampleFixturesEnabled(), false, 'the QA-parent fixture provider stays disabled in production');
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
    const sampleQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', isTestMode: 'true' });
    const sampleResponse = await fetch(`${base}/api/academic/result-students?${sampleQuery}`, { headers });
    assert.equal(sampleResponse.status, 200);
    const sampleBody = await sampleResponse.json();
    assert.equal(sampleBody.students.length, 2);
    assert.ok(sampleBody.students.every((item) => item.isTestRecord === true));
    assert.deepEqual(sampleBody.students.map((item) => item.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
    assert.ok(sampleBody.students.every((item) => item.id !== real.id), 'Test Mode must not leak the real roster when the class has enrolled students');

    const officialCountBefore = students.counts().students;
    const generatedResponse = await fetch(`${base}/api/academic/sample/generate`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: sampleBody.students[0].id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' })
    });
    assert.equal(generatedResponse.status, 201);
    const generated = (await generatedResponse.json()).result;
    assert.equal(generated.isSample, true);
    assert.equal(generated.classId, 'Primary 1');
    assert.equal(generated.studentIndexNumber, 'OSAAH/DEMO/001');
    assert.ok(generated.subjects.length > 0);
    assert.equal(students.counts().students, officialCountBefore, 'sample generation must not alter official student counts');

    const sampleStateQuery = new URLSearchParams({ permanentStudentId: 'OSAAH/DEMO/001', classId: 'Basic 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' });
    const sampleStateResponse = await fetch(`${base}/api/academic/sample/state?${sampleStateQuery}`, { headers });
    assert.equal(sampleStateResponse.status, 200, 'production sample state must remain available to authorized school users');
    assert.equal((await sampleStateResponse.json()).sample.isSample, true);
    for (const endpoint of ['/api/academic/sample/publish', '/api/academic/sample/reset']) {
      const denied = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { Authorization: 'Bearer read-only', 'Content-Type': 'application/json' }, body: JSON.stringify({ permanentStudentId: 'OSAAH/DEMO/001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }) });
      assert.equal(denied.status, 403, `${endpoint} requires publication permission`);
    }
    const stateAfterDeniedActions = await fetch(`${base}/api/academic/sample/state?${sampleStateQuery}`, { headers });
    assert.equal((await stateAfterDeniedActions.json()).sample.publicationStatus, 'UNPUBLISHED', 'unauthorized actions must not mutate sample state');
    const samplePublishResponse = await fetch(`${base}/api/academic/sample/publish`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permanentStudentId: 'OSAAH/DEMO/001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' })
    });
    assert.equal(samplePublishResponse.status, 200, 'production sample publication should not be blocked by the non-production fixture guard');
    const samplePublication = await samplePublishResponse.json();
    assert.equal(samplePublication.isSample, true);
    assert.equal(samplePublication.status, 'PUBLISHED');
    const publishedStateResponse = await fetch(`${base}/api/academic/sample/state?${sampleStateQuery}`, { headers });
    assert.equal(publishedStateResponse.status, 200);
    const publishedState = (await publishedStateResponse.json()).sample;
    assert.equal(publishedState.publicationStatus, 'PUBLISHED');
    assert.equal(publishedState.publication.id, samplePublication.id);
    const sampleResetResponse = await fetch(`${base}/api/academic/sample/reset`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permanentStudentId: 'OSAAH/DEMO/001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' })
    });
    assert.equal(sampleResetResponse.status, 200, 'production sample reset should operate on the isolated in-memory sample workflow');
    assert.equal((await sampleResetResponse.json()).publicationRemoved, true);
    const resetStateResponse = await fetch(`${base}/api/academic/sample/state?${sampleStateQuery}`, { headers });
    assert.equal(resetStateResponse.status, 200);
    assert.equal((await resetStateResponse.json()).sample, null, 'reset sample state should remain cleared on a subsequent read');
    const publicationQuery = new URLSearchParams({ studentId: generated.studentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', isSample: 'true' });
    const publicationAfterReset = await fetch(`${base}/api/academic/results/publication?${publicationQuery}`, { headers });
    assert.equal(publicationAfterReset.status, 200);
    assert.equal((await publicationAfterReset.json()).publication, null, 'sample reset must remove the matching published-result marker');
    assert.equal(students.counts().students, officialCountBefore, 'sample lifecycle actions must not modify official student counts');

    const samplePdfResponse = await fetch(`${base}/api/academic/sample/result/pdf`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/pdf' },
      body: JSON.stringify({ sampleStudentId: 'OSAAH/DEMO/001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', resultType: 'TERMINAL' })
    });
    assert.equal(samplePdfResponse.status, 200);
    assert.match(samplePdfResponse.headers.get('content-type') || '', /application\/pdf/i);
    assert.match(samplePdfResponse.headers.get('content-disposition') || '', /OSAAH_SAMPLE_/);
    const samplePdf = Buffer.from(await samplePdfResponse.arrayBuffer());
    assert.match(samplePdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
    assert.ok(samplePdf.length > 2500);
    assert.equal(students.counts().students, officialCountBefore, 'sample PDF generation must not alter official student counts');
    const sampleMockPdfResponse = await fetch(`${base}/api/academic/sample/result/pdf`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/pdf' },
      body: JSON.stringify({ sampleStudentId: 'OSAAH/DEMO/001', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', resultType: 'MOCK', mockLabel: '1st Mock' })
    });
    assert.equal(sampleMockPdfResponse.status, 200);
    assert.match(sampleMockPdfResponse.headers.get('content-disposition') || '', /OSAAH_SAMPLE_1st-Mock_Result_/);
    assert.match(Buffer.from(await sampleMockPdfResponse.arrayBuffer()).subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
    assert.equal(students.counts().students, officialCountBefore, 'sample Mock PDF generation must not alter official student counts');
    const rejectedPdfResponse = await fetch(`${base}/api/academic/sample/result/pdf`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleStudentId: 'STD-000001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', resultType: 'TERMINAL' })
    });
    assert.equal(rejectedPdfResponse.status, 400, 'sample PDF route must reject non-configured IDs');

    for (const classId of CORE_LEVELS) {
      const classSampleQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId, sampleMode: 'true' });
      const classSampleResponse = await fetch(`${base}/api/academic/result-students?${classSampleQuery}`, { headers });
      assert.equal(classSampleResponse.status, 200, `${classId} sample roster should load`);
      const classSamples = (await classSampleResponse.json()).students;
      assert.deepEqual(classSamples.map((item) => item.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
      const classResultResponse = await fetch(`${base}/api/academic/sample/generate`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: classSamples[0].id, classId, academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' })
      });
      assert.equal(classResultResponse.status, 201, `${classId} sample Result Slip should generate`);
      const classResult = (await classResultResponse.json()).result;
      assert.equal(classResult.isSample, true);
      assert.equal(classResult.classId, classId);
      assert.ok(classResult.subjects.length > 0);
      assert.equal(classResult.subjects.every((subject) => Number(subject.totalScore) === Number(subject.caScore) + Number(subject.examScore)), true);
      assert.equal(students.counts().students, officialCountBefore);
      const modeFlag = CORE_LEVELS.indexOf(classId) % 2 === 0 ? 'sampleMode' : 'isTestMode';
      const broadsheetResponse = await fetch(`${base}/api/academic/broadsheet?${new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: 'mathematics', [modeFlag]: 'true' })}`, { headers });
      assert.equal(broadsheetResponse.status, 200, `${classId} sample Broadsheet should load in production runtime`);
      const broadsheetRows = (await broadsheetResponse.json()).rows;
      assert.deepEqual(broadsheetRows.map((row) => row.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
      assert.ok(broadsheetRows.every((row) => row.isSample));
    }
    const mockResultResponse = await fetch(`${base}/api/academic/sample/mock-generate`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'OSAAH/DEMO/002', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' })
    });
    assert.equal(mockResultResponse.status, 201, 'Mock Result Slip generation must work in production runtime');
    assert.equal((await mockResultResponse.json()).result.isSample, true);
    const mockStateQuery = new URLSearchParams({ permanentStudentId: 'OSAAH/DEMO/002', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'MOCK', mockLabel: '1st Mock' });
    const deniedMockReset = await fetch(`${base}/api/academic/sample/mock-reset`, { method: 'POST', headers: { Authorization: 'Bearer read-only', 'Content-Type': 'application/json' }, body: JSON.stringify({ permanentStudentId: 'OSAAH/DEMO/002', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }) });
    assert.equal(deniedMockReset.status, 403, 'Mock reset requires sample score write permission');
    const mockStateBeforeReset = await fetch(`${base}/api/academic/sample/state?${mockStateQuery}`, { headers });
    assert.equal((await mockStateBeforeReset.json()).sample.isSample, true, 'unauthorized Mock reset must preserve generated state');
    const sampleMockResetResponse = await fetch(`${base}/api/academic/sample/mock-reset`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permanentStudentId: 'OSAAH/DEMO/002', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' })
    });
    assert.equal(sampleMockResetResponse.status, 200, 'production sample Mock reset should remain available for authorized school users');
    assert.equal((await sampleMockResetResponse.json()).isSample, true);
    const mockStateAfterReset = await fetch(`${base}/api/academic/sample/state?${mockStateQuery}`, { headers });
    assert.equal(mockStateAfterReset.status, 200);
    assert.equal((await mockStateAfterReset.json()).sample, null, 'Mock reset is visible on the subsequent state read');
    const mockScoreRosterResponse = await fetch(`${base}/api/academic/mock-scores/roster?${new URLSearchParams({ classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', isTestMode: 'true' })}`, { headers });
    assert.equal(mockScoreRosterResponse.status, 200);
    assert.deepEqual((await mockScoreRosterResponse.json()).students.map((student) => student.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
    const mockBroadsheetResponse = await fetch(`${base}/api/academic/mock-broadsheet?${new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', mockLabel: '1st Mock', sampleMode: 'true' })}`, { headers });
    assert.equal(mockBroadsheetResponse.status, 200);
    assert.deepEqual((await mockBroadsheetResponse.json()).rows.map((row) => row.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
    assert.equal(students.counts().students, officialCountBefore, 'sample Mock results and broadsheets must not alter official student counts');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
    if (previousFixtureFlag === undefined) delete process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
    else process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = previousFixtureFlag;
  }
});


test('Mock Results-only permission loads the Mock roster without granting terminal-result roster access', async () => {
  const students = createStudentService({ schoolId });
  const real = students.createStudent({ firstName: 'Mock', surname: 'Learner', classId: 'JHS 1', academicYearId: '2026/2027', termId: 'First Term' });
  const mockReader = { id: 'mock-reader', roleKey: 'TEACHER', portal: 'school', schoolId, assignedClassIds: ['JHS 1'], permissions: new Set(['mock.results.read']) };
  const auth = { authenticateAsync: async (token) => token === 'mock-reader-token' ? mockReader : null };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  const app = createApp({ auth, students });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer mock-reader-token' };
    const optionsResponse = await fetch(`${base}/api/academic/options`, { headers });
    assert.equal(optionsResponse.status, 200, 'Mock-only permission must load the class and exam selectors');
    assert.ok((await optionsResponse.json()).classes.length > 0);
    const terminalQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', sampleMode: 'false', resultType: 'TERMINAL' });
    const terminalResponse = await fetch(`${base}/api/academic/result-students?${terminalQuery}`, { headers });
    assert.equal(terminalResponse.status, 403, 'Mock-only permission must not grant terminal-result roster access');

    const mockQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', sampleMode: 'false', resultType: 'MOCK' });
    const mockResponse = await fetch(`${base}/api/academic/result-students?${mockQuery}`, { headers });
    assert.equal(mockResponse.status, 200);
    assert.deepEqual((await mockResponse.json()).students.map((student) => student.id), [real.id]);

    mockQuery.set('sampleMode', 'true');
    const sampleResponse = await fetch(`${base}/api/academic/result-students?${mockQuery}`, { headers });
    assert.equal(sampleResponse.status, 200);
    const sampleStudents = (await sampleResponse.json()).students;
    assert.deepEqual(sampleStudents.map((student) => student.permanentStudentId), ['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  }
});
