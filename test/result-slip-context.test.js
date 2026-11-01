import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';

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
  assert.match(html, /id="retry-options"/);
  assert.match(html, /id="retry-students"/);
  assert.match(client, /\/api\/academic\/result-students/);
  assert.match(client, /\/api\/academic\/options/);
  assert.match(client, /Academic years unavailable/);
  assert.match(client, /Terms unavailable/);
  assert.match(client, /Classes unavailable/);
  assert.match(html, /Retry loading academic options/);
  assert.match(html, /Retry loading students/);
  assert.match(client, /Your session has expired/);
  assert.match(client, /not authorized to access this academic data/);
  assert.match(client, /\[result-slip\] request failed/);
  assert.doesNotMatch(client, /console\.(?:warn|error)\([^\n]*(?:token|cookie|password|secret)/i);
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

test('durable sample APIs remain available when fixture mode is disabled and generate from stored scores', async () => {
  const durableActor = { ...actor, permissions: new Set(['*']) };
  const deniedActor = { ...actor, id: 'unauthorized-result-viewer', permissions: new Set([]) };
  const calls = [];
  let writes = 0;
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', name: 'First Term', academicYearId: 'year-2026', isCurrent: 1 }];
      if (sql.includes('FROM classes c JOIN levels')) return [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'LOWER_PRIMARY' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM demo_student_class_assignments d')) return [{ studentId: 'demo-master-001', permanentStudentId: 'OSAAH/DEMO/001', firstName: 'OSAAH Demo', surname: 'Student One', classId: 'class-basic-1', schoolId }];
      if (sql.includes('FROM academic_score_records r JOIN student_profiles')) return [{ subjectId: 'subject-math', subjectName: 'Mathematics', caScore: 40, examScore: 45, totalScore: 85 }];
      if (sql.includes('FROM academic_result_records')) return [];
      return [];
    },
    async execute() { writes += 1; return { affectedRows: 1 }; }
  };
  const auth = { authenticateAsync: async (token) => token === 'durable-sample' ? durableActor : token === 'unauthorized' ? deniedActor : null };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  const previousFixtures = process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = 'false';
  const app = createApp({ auth, students: createStudentService({ schoolId }), database });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer durable-sample', 'Content-Type': 'application/json' };
    const rosterQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'class-basic-1', sampleMode: 'true' });
    const rosterResponse = await fetch(`${base}/api/academic/result-students?${rosterQuery}`, { headers });
    assert.equal(rosterResponse.status, 200);
    assert.deepEqual((await rosterResponse.json()).students.map((student) => student.permanentStudentId), ['OSAAH/DEMO/001']);

    const generateResponse = await fetch(`${base}/api/academic/sample/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({ studentId: 'demo-master-001', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' })
    });
    assert.equal(generateResponse.status, 201);
    const result = (await generateResponse.json()).result;
    assert.equal(result.isSample, true);
    assert.equal(result.studentIndexNumber, 'OSAAH/DEMO/001');
    assert.deepEqual(result.subjects.map(({ caScore, examScore, totalScore }) => ({ caScore, examScore, totalScore })), [{ caScore: 40, examScore: 45, totalScore: 85 }]);
    assert.ok(calls.some(({ sql }) => sql.includes('FROM academic_score_records')));
    assert.ok(calls.some(({ sql, params }) => sql.includes('FROM academic_score_records') && params.includes('class-basic-1')), 'durable score reads must keep the resolved database class ID');
    assert.equal(writes, 0, 'generating the same sample Result Slip repeatedly must remain read-only');

    const repeated = await fetch(`${base}/api/academic/sample/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({ studentId: 'demo-master-001', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' })
    });
    assert.equal(repeated.status, 201);
    assert.equal((await repeated.json()).result.subjects[0].totalScore, 85);
    assert.equal(writes, 0, 'repeated generation must not insert duplicate records or alter scores');

    const unauthorized = await fetch(`${base}/api/academic/sample/generate`, {
      method: 'POST', headers: { Authorization: 'Bearer unauthorized', 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'demo-master-001', classId: 'class-basic-1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' })
    });
    assert.equal(unauthorized.status, 403, 'durable mode must retain endpoint permission checks');

    const fixtureEndpoint = await fetch(`${base}/api/academic/sample/state?classId=class-basic-1`, { headers });
    assert.equal(fixtureEndpoint.status, 403, 'fixture-only sample APIs must remain disabled');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
    if (previousFixtures === undefined) delete process.env.OSAAH_ENABLE_SAMPLE_FIXTURES;
    else process.env.OSAAH_ENABLE_SAMPLE_FIXTURES = previousFixtures;
  }
});

test('Result Slip student API scopes real students and returns only existing samples in Test Mode', async () => {
  const students = createStudentService({ schoolId });
  const real = students.createStudent({ firstName: 'Real', surname: 'Learner', classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  students.createStudent({ firstName: 'Other', surname: 'Year', classId: 'Primary 1', academicYearId: '2025/2026', termId: 'First Term' });
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
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
    const sampleQuery = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'Primary 1', sampleMode: 'true' });
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
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
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
