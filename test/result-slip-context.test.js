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
  assert.match(client, /\/api\/academic\/result-students/);
  assert.match(client, /permanentStudentId/);
  assert.match(client, /isTestRecord/);
  assert.match(client, /No students found for the selected class and academic context\./);
  assert.match(client, /x\.isSample \? '' : `<button class=/);
  assert.match(client, /const saveButton = host\.querySelector\('#save-result'\); if \(saveButton\)/);
  assert.match(client, /\/api\/academic\/sample\/generate/);
  assert.match(client, /\/api\/academic\/result\?/);
  assert.match(pdfClient, /result\?\.isSample === true/);
  assert.match(pdfClient, /\/api\/academic\/sample\/result\/pdf/);
  assert.match(pdfClient, /sampleStudentId/);
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
    assert.deepEqual(sampleBody.students.map((item) => item.permanentStudentId), ['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);
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
    assert.equal(generated.studentIndexNumber, 'OSAAH-DEMO-001');
    assert.ok(generated.subjects.length > 0);
    assert.equal(students.counts().students, officialCountBefore, 'sample generation must not alter official student counts');

    const samplePdfResponse = await fetch(`${base}/api/academic/sample/result/pdf`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/pdf' },
      body: JSON.stringify({ sampleStudentId: 'OSAAH-DEMO-001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', resultType: 'TERMINAL' })
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
      body: JSON.stringify({ sampleStudentId: 'OSAAH-DEMO-001', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', resultType: 'MOCK', mockLabel: '1st Mock' })
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
      assert.deepEqual(classSamples.map((item) => item.permanentStudentId), ['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);
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
