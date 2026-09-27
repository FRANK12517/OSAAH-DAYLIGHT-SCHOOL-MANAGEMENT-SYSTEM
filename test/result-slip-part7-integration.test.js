import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { GES_ASSESSMENT_LIBRARIES } from '../src/ges-assessment-libraries.js';
import { createResultSlipPdfService } from '../src/result-slip-pdf.js';
import { createSignatureService } from '../src/signatures.js';
import { createApp } from '../src/server.mjs';
import { context, durableGesFixture, schoolId, teacher } from './helpers/durable-ges-fixture.js';

const manager = { id: 'head-user', schoolId, roleKey: 'HEADTEACHER', permissions: new Set(['results.read', 'results.generate', 'signatures.manage', 'academics.read', 'subjects.read']) };
const assessment = Object.freeze({
  conduct: GES_ASSESSMENT_LIBRARIES.conduct.positive[0],
  attitude: GES_ASSESSMENT_LIBRARIES.attitude.positive[0],
  interest: GES_ASSESSMENT_LIBRARIES.interest.positive[0],
  classTeacherRemarks: GES_ASSESSMENT_LIBRARIES.ctRemarks.positive[0],
  headteacherRemarks: GES_ASSESSMENT_LIBRARIES.htRemarks.positive[0]
});

function seedOfficialStaff(db) {
  db.exec(`
    INSERT INTO roles VALUES ('role-teacher','${schoolId}','TEACHER'),('role-head','${schoolId}','HEADTEACHER');
    INSERT INTO users VALUES ('teacher-user','${schoolId}','Ama Teacher','0241234567','ACTIVE'),('head-user','${schoolId}','Efua Headteacher','0247654321','ACTIVE');
    INSERT INTO user_roles VALUES ('teacher-user-role','teacher-user','role-teacher'),('head-user-role','head-user','role-head');
    INSERT INTO staff_profiles VALUES ('staff-teacher','${schoolId}','teacher-user'),('staff-head','${schoolId}','head-user');
    INSERT INTO staff_assignments VALUES ('assignment-class','staff-teacher','class-a','year-a','term-first',NULL);
    INSERT INTO student_attendance VALUES
      ('att-1','${schoolId}','profile-a','class-a','term-first','2026-09-01','PRESENT','OSAAH/2026/0001','2026/2027','First Term','daily'),
      ('att-2','${schoolId}','profile-a','class-a','term-first','2026-09-01','PRESENT','OSAAH/2026/0001','2026/2027','First Term','math'),
      ('att-3','${schoolId}','profile-a','class-a','term-first','2026-09-02','ABSENT','OSAAH/2026/0001','2026/2027','First Term','daily');
  `);
}

function startApp(fixture, tokenActors, pdfService, idSuffix) {
  let nextSignatureId = 0;
  const signatures = createSignatureService({ database: fixture.database, schoolId, idFactory: () => `signature-${idSuffix}-${++nextSignatureId}` });
  const app = createApp({ database: fixture.database, signatures,
    auth: { authenticateAsync: async token => tokenActors[token] ?? null }, resultPdf: pdfService });
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, root: `http://127.0.0.1:${server.address().port}`, signatures })));
}

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test('complete real Result Slip workflow shares durable records across screen, PDF, and app reinitialization', async t => {
  const fixture = await durableGesFixture();
  fixture.migrate();
  seedOfficialStaff(fixture.db);
  const actorMap = {
    teacher, manager,
    assistant: { id: 'assistant-user', schoolId, roleKey: 'ASSISTANT_HEADTEACHER', permissions: new Set(['results.read', 'results.generate']) },
    proprietor: { id: 'owner-user', schoolId, roleKey: 'PROPRIETOR', permissions: new Set(['*']) },
    accountant: { id: 'accountant-user', schoolId, roleKey: 'ACCOUNTANT_BURSAR', permissions: new Set(['students.read', 'fees.read', 'finance.read']) },
    administrator: { id: 'admin-user', schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['students.read', 'academics.read', 'examinations.read']) }
  };
  const realPdf = createResultSlipPdfService();
  let pdfPayload = null;
  const pdfService = {
    async pdf(result) { pdfPayload = structuredClone(result); return realPdf.pdf(result); },
    filename: result => realPdf.filename(result)
  };
  let app = await startApp(fixture, actorMap, pdfService, 'first');
  t.after(async () => { await close(app.server); fixture.db.close(); });
  const request = (path, token = 'teacher', init = {}) => fetch(`${app.root}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });

  const optionsResponse = await request('/api/academic/options');
  assert.equal(optionsResponse.status, 200);
  const options = await optionsResponse.json();
  assert.ok(options.academicYears.some(row => row.id === 'year-a' && row.name === '2026/2027'));
  assert.ok(options.terms.some(row => row.id === 'term-first' && row.name === 'First Term'));
  assert.ok(options.classes.some(row => row.id === 'class-a' && row.name === 'Basic 4'));

  const studentsResponse = await request(`/api/academic/result-students?${new URLSearchParams(context)}`);
  assert.equal(studentsResponse.status, 200);
  const students = (await studentsResponse.json()).students;
  assert.ok(students.some(row => row.id === 'student-a' && row.name === 'Ama Akua Mensah' && row.permanentStudentId === 'OSAAH/2026/0001'));
  assert.ok(students.every(row => row.id !== 'foreign-student' && !row.isTestRecord));
  assert.equal(fixture.db.prepare('SELECT permanent_student_id FROM students WHERE id=?').get('student-a').permanent_student_id, 'OSAAH/2026/0001');

  const subjectsResponse = await request(`/api/subjects?${new URLSearchParams({ classId: context.classId, academicYearId: 'year-a', termId: 'term-first' })}`, 'manager');
  assert.equal(subjectsResponse.status, 200);
  assert.ok((await subjectsResponse.json()).subjects.some(row => row.id === 'subject-a' && row.name === 'English Language'));

  const savedScoreResponse = await request('/api/academic/scores', 'teacher', { method: 'POST', body: JSON.stringify({ ...context, subjectId: 'subject-a', caScore: 42, examScore: 38 }) });
  assert.equal(savedScoreResponse.status, 201);
  const savedScore = await savedScoreResponse.json();
  assert.equal(savedScore.studentId, 'student-a');
  assert.equal(savedScore.totalScore, 80);
  assert.equal(savedScore.permanentStudentId, 'OSAAH/2026/0001');
  for (const invalid of [{ caScore: -1, examScore: 50 }, { caScore: 51, examScore: 20 }, { caScore: 'not-a-score', examScore: 20 }]) {
    const rejected = await request('/api/academic/scores', 'teacher', { method: 'POST', body: JSON.stringify({ ...context, subjectId: 'subject-a', ...invalid }) });
    assert.equal(rejected.status, 400);
  }
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_academic_scores').get().n, 1, 'invalid arithmetic inputs do not alter the durable score');

  const gesResponse = await request('/api/academic/ges-assessment', 'teacher', { method: 'POST', body: JSON.stringify({ ...context, assessment }) });
  assert.equal(gesResponse.status, 200);
  assert.deepEqual((await gesResponse.json()).assessment, assessment);

  const classSignature = await request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify({
    signatoryRole: 'CLASS_TEACHER', classId: context.classId, academicYear: context.academicYear, term: context.term,
    teacherId: 'staff-teacher', mimeType: 'image/png', size: 1024, storageKey: 'signatures/class-teacher.png'
  }) });
  assert.equal(classSignature.status, 201);
  const headSignature = await request('/api/result-signatures', 'manager', { method: 'POST', body: JSON.stringify({
    signatoryRole: 'HEADTEACHER', mimeType: 'image/png', size: 1024, storageKey: 'signatures/headteacher.png'
  }) });
  assert.equal(headSignature.status, 201);

  const resultUrl = `/api/academic/result?${new URLSearchParams(context)}`;
  let screenResponse = await request(resultUrl);
  assert.equal(screenResponse.status, 200);
  let screen = (await screenResponse.json()).result;
  assert.equal(screen.isSample, false);
  assert.equal(screen.studentId, 'student-a');
  assert.equal(screen.studentIndexNumber, 'OSAAH/2026/0001');
  assert.equal(screen.studentName, 'Ama Akua Mensah');
  assert.equal(screen.gender, 'Female');
  assert.deepEqual(screen.classGenderDistribution, { totalBoys: 1, totalGirls: 1, totalStudents: 2 });
  assert.deepEqual({ ca: screen.subjects[0].caScore, exam: screen.subjects[0].examScore, total: screen.subjects[0].totalScore }, { ca: 42, exam: 38, total: 80 });
  assert.equal(screen.subjects[0].grade, 'A');
  assert.equal(screen.subjects[0].remark, 'Excellent');
  assert.equal(screen.totalScore, 80);
  assert.deepEqual(screen.assessment, assessment);
  assert.deepEqual(screen.attendance, { timesPresent: 1, timesAbsent: 1, totalSchoolDays: null, conflictingDays: 0, otherStatusCounts: {} });
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'CLASS_TEACHER').name, 'Ama Teacher');
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'CLASS_TEACHER').phone, '0241234567');
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'HEADTEACHER').name, 'Efua Headteacher');
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'HEADTEACHER').phone, '0247654321');
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'CLASS_TEACHER').signatureUrl, 'signatures/class-teacher.png');
  assert.equal(screen.signatures.find(row => row.signatoryRole === 'HEADTEACHER').signatureUrl, 'signatures/headteacher.png');

  for (const token of ['teacher', 'manager', 'assistant', 'proprietor']) assert.equal((await request(resultUrl, token)).status, 200, `${token} retains its configured result-read permission`);
  for (const token of ['accountant', 'administrator']) assert.equal((await request(resultUrl, token)).status, 403, `${token} remains denied without a result-read permission`);
  for (const token of ['manager', 'assistant', 'accountant', 'administrator']) {
    const deniedScore = await request('/api/academic/scores', token, { method: 'POST', body: JSON.stringify({ ...context, subjectId: 'subject-a', caScore: 10, examScore: 10 }) });
    assert.equal(deniedScore.status, 403, `${token} cannot write scores without marks.write`);
  }
  for (const token of ['manager', 'assistant', 'accountant', 'administrator']) {
    const deniedGes = await request('/api/academic/ges-assessment', token, { method: 'POST', body: JSON.stringify({ ...context, assessment }) });
    assert.equal(deniedGes.status, 403, `${token} cannot write GES without marks.write/results.write`);
  }

  let pdfResponse = await request(`/api/academic/result/pdf?${new URLSearchParams(context)}`);
  assert.equal(pdfResponse.status, 200);
  let pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
  assert.ok(pdf.length > 2500);
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
  assert.deepEqual(pdfPayload, screen, 'PDF service receives the exact screen result payload');

  // Restart only the application/service layer; all authoritative records stay in the same DB.
  await close(app.server);
  app = await startApp(fixture, actorMap, pdfService, 'restarted');
  screenResponse = await request(resultUrl);
  assert.equal(screenResponse.status, 200);
  const afterRestart = (await screenResponse.json()).result;
  assert.deepEqual(afterRestart, screen);
  pdfResponse = await request(`/api/academic/result/pdf?${new URLSearchParams(context)}`);
  pdf = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfResponse.status, 200);
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\.[0-9]/);
  assert.deepEqual(pdfPayload, afterRestart);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_academic_scores').get().n, 1);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_ges_assessments').get().n, 1);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures WHERE is_active=1').get().n, 2);
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM result_signatures').get().n, 2);

  const foreignRequest = await request(`/api/academic/result?${new URLSearchParams({ ...context, studentId: 'foreign-student' })}`);
  assert.equal(foreignRequest.status, 404);
  const anonymous = await fetch(`${app.root}${resultUrl}`);
  assert.equal(anonymous.status, 401);
});
