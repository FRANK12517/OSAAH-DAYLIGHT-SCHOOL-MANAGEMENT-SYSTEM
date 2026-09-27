import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { GES_ASSESSMENT_LIBRARIES } from '../src/ges-assessment-libraries.js';
import { createApp } from '../src/server.mjs';
import { context, durableGesFixture, schoolId, teacher } from './helpers/durable-ges-fixture.js';

const selected = Object.freeze({
  conduct: GES_ASSESSMENT_LIBRARIES.conduct.positive[0],
  attitude: GES_ASSESSMENT_LIBRARIES.attitude.positive[0],
  interest: GES_ASSESSMENT_LIBRARIES.interest.positive[0],
  classTeacherRemarks: GES_ASSESSMENT_LIBRARIES.ctRemarks.positive[0],
  headteacherRemarks: GES_ASSESSMENT_LIBRARIES.htRemarks.positive[0]
});

function makeService(database, idFactory = randomUUID) {
  return createDurableAcademicService({ database, schoolId, idFactory, clock: () => '2026-09-26T00:00:00.000Z' });
}

async function seedScore(service, input = context) {
  return service.saveScore({ ...input, subjectId: 'subject-a', caScore: 42, examScore: 38 }, teacher);
}

async function withServer(t, fixture, actors, resultPdf) {
  const app = createApp({ database: fixture.database, auth: { authenticateAsync: async (token) => actors[token] ?? null }, resultPdf });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const root = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token = 'teacher', init = {}) => fetch(`${root}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  return { request };
}

test('Part 5 migration is additive, repeat-safe, and has one canonical academic-scope row', async () => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate(); fixture.db.exec(fixture.migration056);
    const columns = fixture.db.prepare('PRAGMA table_info(canonical_ges_assessments)').all().map((item) => item.name);
    assert.deepEqual(columns, ['id','school_id','student_id','class_id','academic_year_id','term_id','conduct','attitude','interest','class_teacher_remarks','headteacher_remarks','created_at','updated_at']);
    const fks = fixture.db.prepare('PRAGMA foreign_key_list(canonical_ges_assessments)').all().map((item) => item.table);
    assert.deepEqual(new Set(fks), new Set(['schools','students','classes','academic_years','terms']));
    fixture.db.prepare(`INSERT INTO canonical_ges_assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('first',schoolId,'student-a','class-a','year-a','term-first',null,null,null,null,null,'now','now');
    assert.throws(() => fixture.db.prepare(`INSERT INTO canonical_ges_assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('duplicate',schoolId,'student-a','class-a','year-a','term-first',null,null,null,null,null,'now','now'), /UNIQUE constraint failed/);
    assert.equal(fixture.db.prepare('SELECT score FROM academic_score_records WHERE id=?').get('legacy-score').score, 72);
    assert.doesNotMatch(fixture.migration056, /\b(DROP|TRUNCATE|DELETE|RENAME)\b/i);
  } finally { fixture.db.close(); }
});

test('all five approved GES fields save and survive a new repository instance and repeat update', async () => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate();
    const first = await makeService(fixture.database).saveGesAssessment({ ...context, schoolId: 'school-b', assessment: selected }, teacher);
    assert.equal(first.schoolId, schoolId, 'school is derived from the authenticated actor/service');
    for (const key of ['conduct','attitude','interest','classTeacherRemarks','headteacherRemarks']) assert.equal(first.assessment[key], selected[key]);
    const updatedValues = { ...selected, conduct: GES_ASSESSMENT_LIBRARIES.conduct.negative[0] };
    const updated = await makeService(fixture.database, () => 'unexpected-second-id').saveGesAssessment({ ...context, assessment: updatedValues }, teacher);
    assert.equal(updated.id, first.id);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_ges_assessments').get().n, 1);
    const afterRestart = await makeService(fixture.database).assessmentFor(context, teacher);
    assert.equal(afterRestart.conduct, updatedValues.conduct);
    assert.equal(afterRestart.attitude, selected.attitude);
    assert.equal(afterRestart.interest, selected.interest);
    assert.equal(afterRestart.classTeacherRemarks, selected.classTeacherRemarks);
    assert.equal(afterRestart.headteacherRemarks, selected.headteacherRemarks);
  } finally { fixture.db.close(); }
});

test('GES rejects foreign school/student/class/year/term, unauthorized writes, unassigned classes, samples, and unapproved text', async () => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate();
    const service = makeService(fixture.database);
    const invalid = [
      [{ ...context, studentId: 'foreign-student' }, teacher],
      [{ ...context, studentId: 'TEST-OSAAH-0001' }, teacher],
      [{ ...context, classId: 'foreign-class' }, teacher],
      [{ ...context, classId: 'class-next' }, teacher],
      [{ ...context, academicYear: '2024/2025' }, teacher],
      [{ ...context, academicYear: '2026/2027', term: 'No Such Term' }, teacher],
      [{ ...context, assessment: { ...selected, conduct: 'invented comment' } }, teacher],
      [{ ...context, assessment: selected }, { ...teacher, schoolId: 'school-b' }],
      [{ ...context, assessment: selected }, { ...teacher, roleKey: 'ASSISTANT_HEADTEACHER', permissions: new Set(['results.read','results.generate']) }],
      [{ ...context, assessment: selected }, { ...teacher, roleKey: 'HEADTEACHER', permissions: new Set(['results.read','results.generate']) }],
      [{ ...context, assessment: selected }, { ...teacher, roleKey: 'TEACHER', permissions: new Set(['marks.write']), assignedClassIds: ['class-next'] }]
    ];
    for (let index=0; index<invalid.length; index++) { const [input, actor] = invalid[index]; await assert.rejects(service.saveGesAssessment({ ...input, assessment: input.assessment ?? selected }, actor), undefined, `unexpectedly allowed case ${index}: ${JSON.stringify(input)} role=${actor.roleKey}`); }
    const proprietor = { id: 'owner', schoolId, roleKey: 'PROPRIETOR', permissions: new Set(['*']) };
    const allowed = await service.saveGesAssessment({ ...context, assessment: selected }, proprietor);
    assert.equal(allowed.saved, true);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_ges_assessments').get().n, 1);
  } finally { fixture.db.close(); }
});

test('GES values isolate term, year, and historical class for the same canonical student', async () => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate();
    const service = makeService(fixture.database);
    const contexts = [
      { ...context, classId: 'class-a', academicYear: '2026/2027', term: 'First Term' },
      { ...context, classId: 'class-a', academicYear: '2026/2027', term: 'Second Term' },
      { ...context, classId: 'class-a', academicYear: '2025/2026', term: 'First Term' },
      { ...context, classId: 'class-next', academicYear: '2026/2027', term: 'First Term' }
    ];
    const values = contexts.map((_, index) => ({ ...selected, conduct: GES_ASSESSMENT_LIBRARIES.conduct.positive[index] }));
    for (let index=0; index<contexts.length; index++) await service.saveGesAssessment({ ...contexts[index], assessment: values[index] }, { ...teacher, assignedClassIds: ['class-a','class-next'] });
    for (let index=0; index<contexts.length; index++) {
      const read = await makeService(fixture.database).assessmentFor(contexts[index], { ...teacher, assignedClassIds: ['class-a','class-next'] });
      assert.equal(read.conduct, values[index].conduct);
    }
    const otherStudent = await service.assessmentFor({ ...context, studentId:'student-b' }, teacher);
    assert.deepEqual(otherStudent, { conduct:null, attitude:null, interest:null, classTeacherRemarks:null, headteacherRemarks:null });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_ges_assessments').get().n, 4);
    assert.equal((await service.assessmentFor({ ...context, term: 'Second Term' }, teacher)).conduct, values[1].conduct);
  } finally { fixture.db.close(); }
});

test('Generate Result and PDF return the same durable GES values; absent rows stay not recorded', async (t) => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate();
    const service = makeService(fixture.database);
    await seedScore(service);
    const actors = { teacher, proprietor: { id:'owner', schoolId, roleKey:'PROPRIETOR', permissions:new Set(['*']) }, headteacher: { id:'head', schoolId, roleKey:'HEADTEACHER', permissions:new Set(['results.read','results.generate']) }, assistant: { id:'assistant', schoolId, roleKey:'ASSISTANT_HEADTEACHER', permissions:new Set(['results.read','results.generate']) } };
    let pdfInput = null;
    const api = await withServer(t, fixture, actors, { pdf: async (value) => { pdfInput = value; return Buffer.from('%PDF-1.7'); }, filename: () => 'result.pdf' });
    const query = new URLSearchParams(context);
    let generated = await api.request(`/api/academic/result?${query}`);
    assert.equal(generated.status, 200);
    let result = (await generated.json()).result;
    assert.equal(result.gesAssessmentDurable, true);
    assert.deepEqual(result.assessment, { conduct:null, attitude:null, interest:null, classTeacherRemarks:null, headteacherRemarks:null });
    const pdf = await api.request(`/api/academic/result/pdf?${query}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdfInput.assessment.conduct, null);
    await api.request('/api/academic/ges-assessment', 'teacher', { method:'POST', body:JSON.stringify({ ...context, assessment:selected }) });
    generated = await api.request(`/api/academic/result?${query}`);
    result = (await generated.json()).result;
    assert.deepEqual({ ...result.assessment }, selected);
    const downloaded = await api.request(`/api/academic/result/pdf?${query}`);
    assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(pdfInput.assessment, result.assessment);
    const deniedHeadSave = await api.request('/api/academic/ges-assessment', 'headteacher', { method:'POST', body:JSON.stringify({ ...context, assessment:selected }) });
    const deniedAssistantSave = await api.request('/api/academic/ges-assessment', 'assistant', { method:'POST', body:JSON.stringify({ ...context, assessment:selected }) });
    assert.equal(deniedHeadSave.status, 403);
    assert.equal(deniedAssistantSave.status, 403);
    const notFoundStudent = await api.request(`/api/academic/result?${new URLSearchParams({ ...context, studentId:'student-b' })}`);
    assert.equal(notFoundStudent.status, 404);
    for (const token of ['proprietor','headteacher','assistant']) assert.equal((await api.request(`/api/academic/result?${query}`, token)).status, 200);
  } finally { fixture.db.close(); }
});

test('sample writes stay isolated and the production GES table contains no sample row', async (t) => {
  const fixture = await durableGesFixture();
  try {
    fixture.migrate();
    const api = await withServer(t, fixture, { teacher }, { pdf: async () => Buffer.from('%PDF'), filename: () => 'result.pdf' });
    const body = { ...context, assessment:selected, isSample:true };
    const response = await api.request('/api/academic/ges-assessment', 'teacher', { method:'POST', body:JSON.stringify(body) });
    assert.equal(response.status, 403);
    await assert.rejects(makeService(fixture.database).saveGesAssessment({ ...context, studentId:'TEST-OSAAH-0001', assessment:selected }, teacher));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM canonical_ges_assessments').get().n, 0);
  } finally { fixture.db.close(); }
});

test('approved Positive/Negative libraries and Result Slip stale-context guards remain in place', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/edutrack-ges-assessment-libraries.json', import.meta.url), 'utf8'));
  const browserLibraries = await readFile(new URL('../public/ges-assessment-libraries.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/result-view.js', import.meta.url), 'utf8');
  assert.match(browserLibraries, /OSAAH_GES_ASSESSMENT_LIBRARIES/);
  for (const [key, fixtureKey] of [['conduct','conduct'],['attitude','attitude'],['interest','interest'],['classTeacherRemarks','ctRemarks'],['headteacherRemarks','htRemarks']]) {
    assert.equal(fixture[fixtureKey].positive.length, 30);
    assert.equal(fixture[fixtureKey].negative.length, 30);
    assert.match(client, new RegExp(`assessmentField\\('[^']+','${key}'`));
  }
  assert.match(client, /api\('\/api\/academic\/ges-assessment'/);
  assert.match(client, /if \(x\.gesAssessmentDurable\) return \{\}/);
  assert.match(client, /if \(contextVersion !== resultContextVersion\) return/);
  assert.match(client, /form\.elements\.studentId\.addEventListener\('change'/);
  assert.match(client, /form\.elements\.academicYear\.addEventListener\('change'/);
  assert.match(client, /form\.elements\.term\.addEventListener\('change'/);
  assert.match(client, /form\.elements\.sampleMode\.addEventListener\('change'/);
  assert.match(client, /resetStudentContext\(\)/);
  const pdf = await readFile(new URL('../src/result-slip-pdf.js', import.meta.url), 'utf8');
  for (const label of ['Conduct','Attitude','Interest','Class Teacher Remarks','Headteacher Remarks']) assert.ok(pdf.includes(`line('${label}'`));
  assert.doesNotMatch(pdf, /Positive|Negative/);
});
