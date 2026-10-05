import test from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer as createHttpServer } from 'node:http';
import vm from 'node:vm';
import { createResultSlipPdfService, resultPdfFilename } from '../src/result-slip-pdf.js';
import { createApp } from '../src/server.mjs';

const baseResult = (overrides = {}) => ({
  resultType: 'TERMINAL', studentId: 'student-1', studentName: 'Ama Mensah',
  studentIndexNumber: 'OSAAH/2026/0001', classId: 'JHS 2', academicYear: '2026/2027', term: 'First Term',
  subjects: [{ subjectName: 'English Language', totalScore: 84, grade: '1', subjectPosition: '1st', remark: 'Excellent' }],
  totalScore: 84, aggregate: 1, classPosition: '1st', subjectsSat: 1, average: 84,
  assessment: { conduct: 'Shows excellent conduct.', attitude: 'Maintains a positive attitude.', interest: 'Shows keen interest.', classTeacherRemarks: 'Excellent progress.', headteacherRemarks: 'Keep improving.' },
  attendance: { timesPresent: 90, timesAbsent: 2, totalSchoolDays: 92 },
  signatures: [{ signatoryRole: 'CLASS_TEACHER', name: 'Teacher A', phone: '0241234567' }, { signatoryRole: 'HEADTEACHER', name: 'Headteacher One', phone: '0241234569' }],
  ...overrides
});

test('server PDF generator creates branded A4 PDFs for JHS, Primary, KG, and Nursery terminal results', async () => {
  const service = createResultSlipPdfService();
  for (const classId of ['JHS 2', 'Primary 1', 'KG1', 'Nursery 1']) {
    const buffer = await service.pdf(baseResult({ classId }));
    assert.match(buffer.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
    assert.ok(buffer.length > 2500);
  }
});

test('server PDF generator creates Mock PDFs only for eligible JHS results and marks sample filenames', async () => {
  const service = createResultSlipPdfService();
  for (const classId of ['JHS 1', 'JHS 2', 'JHS 3']) {
    const buffer = await service.pdf(baseResult({ resultType: 'MOCK', mockLabel: '1st Mock', classId }));
    assert.match(buffer.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
    assert.ok(buffer.length > 2500);
  }
  assert.match(resultPdfFilename(baseResult({ resultType: 'MOCK', mockLabel: '1st Mock', studentIndexNumber: 'OSAAH-DEMO-J3-001' })), /^OSAAH_1st-Mock_Result_OSAAH-DEMO-J3-001_/);
  assert.match(resultPdfFilename(baseResult({ isSample: true, studentIndexNumber: 'OSAAH-DEMO-001' })), /^OSAAH_SAMPLE_End-of-Term_Result_OSAAH-DEMO-001_/);
});

test('PDF maps generated sample GES assessments and always renders both signature slots', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../src/result-slip-pdf.js', import.meta.url), 'utf8');
  assert.match(source, /result\.assessment \?\? result\.assessments \?\? \{\}/);
  assert.match(source, /\['CLASS_TEACHER', 'Class Teacher'\], \['HEADTEACHER', 'Headteacher'\]/);
  assert.match(source, /\$\{label\} Signature/);
  assert.match(source, /Signature not uploaded/);
});

test('PDF client controls and both result pages use real download endpoints without exposing edit controls', async () => {
  const fs = await import('node:fs/promises');
  const terminal = await fs.readFile(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const mock = await fs.readFile(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  const helper = await fs.readFile(new URL('../public/result-pdf.js', import.meta.url), 'utf8');
  const pages = (await fs.readFile(new URL('../public/results.html', import.meta.url), 'utf8')) + (await fs.readFile(new URL('../public/mock-results.html', import.meta.url), 'utf8'));
  for (const source of [terminal, mock]) {
    assert.match(source, /EXPORT \/ DOWNLOAD PDF/);
    assert.match(source, /downloadResultPdf/);
  }
  assert.match(helper, /application\/pdf/);
  assert.match(helper, /URL\.createObjectURL/);
  assert.match(helper, /result\?\.isSample === true/);
  assert.match(helper, /\/api\/academic\/sample\/result\/pdf/);
  assert.match(helper, /sampleStudentId/);
  assert.match(pages, /result-pdf\.js/);
  assert.doesNotMatch(helper, /window\.print/);
});

test('sample PDF downloader sends only the configured sample ID to the isolated endpoint', async () => {
  const fs = await import('node:fs/promises');
  const helper = await fs.readFile(new URL('../public/result-pdf.js', import.meta.url), 'utf8');
  let request;
  const link = { click() {}, remove() {} };
  const sandbox = {
    window: {},
    URLSearchParams,
    URL: { createObjectURL: () => 'blob:sample', revokeObjectURL: () => {} },
    fetch: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        headers: { get: () => 'attachment; filename="OSAAH_SAMPLE.pdf"' },
        blob: async () => Buffer.from('%PDF-1.4')
      };
    },
    document: { createElement: () => link, body: { appendChild() {} } },
    setTimeout: () => 1
  };
  vm.runInNewContext(helper, sandbox);
  await sandbox.window.downloadResultPdf({
    isSample: true, studentId: 'STD-000001', permanentStudentId: 'OSAAH-DEMO-001', studentIndexNumber: 'OSAAH-DEMO-001',
    classId: 'Basic 1', academicYear: '2026/2027 Academic Year', term: 'First Term'
  });
  assert.equal(request.url, '/api/academic/sample/result/pdf');
  assert.equal(request.init.method, 'POST');
  const body = JSON.parse(request.init.body);
  assert.equal(body.sampleStudentId, 'OSAAH-DEMO-001');
  assert.equal('studentId' in body, false);
  assert.equal(body.resultType, 'TERMINAL');
});

test('sample PDF server normalizes display class labels before durable context lookup', async () => {
  const fs = await import('node:fs/promises');
  const server = await fs.readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /const options = await durableAcademic\.options\(actor\);/);
  assert.match(server, /canonicalClassId\(item\.name\) === requestedClass/);
  assert.match(server, /contextInput = \{ \.\.\.input, classId: classRow\.id \}/);
});

test('PDF export routes are protected before any client-provided student lookup', async () => {
  const server = createHttpServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const request = (path) => new Promise((resolve, reject) => {
    const req = http.get({ port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
  assert.equal(await request('/api/academic/result/pdf?studentId=student-1&classId=Primary%201'), 401);
  assert.equal(await request('/api/academic/mock-result/pdf?studentId=student-1&classId=JHS%203&mockLabel=1st%20Mock'), 401);
  assert.equal(await request('/api/academic/sample/result/pdf'), 401);
  await new Promise((resolve) => server.close(resolve));
});
