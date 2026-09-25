import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createApp } from '../src/server.mjs';
import { createStudentService, CORE_LEVELS } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { SCHOOL_CLASS_CATALOGUE } from '../public/class-catalogue.js';

const schoolId = 'sch_default_01';
const teacher = { id: 'score-teacher', roleKey: 'TEACHER', portal: 'school', schoolId, assignedClassIds: [...CORE_LEVELS], permissions: new Set(['academics.read', 'subjects.read', 'marks.write', 'results.read']) };

function eligibleStudent(students, classId, surname, context = {}) {
  return students.createStudent({ firstName: 'Ama', surname, classId, academicYearId: context.academicYear ?? '2026/2027', termId: context.term ?? 'First Term' });
}

function scoreFixture() {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const resultService = createAcademicResultsService({ schoolId, students, subjects });
  return { students, subjects, resultService };
}

test('canonical Score Entry class catalogue presents school labels and preserves canonical backend values', () => {
  assert.deepEqual(SCHOOL_CLASS_CATALOGUE.map(({ id }) => id), CORE_LEVELS);
  assert.deepEqual(SCHOOL_CLASS_CATALOGUE.map(({ label }) => label), ['Nursery', 'Nursery 2', 'KG 1', 'KG 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  assert.match(html, /<select name="classId" required>/);
  assert.doesNotMatch(html, /<select name="classId"[^>]*multiple/);
  assert.match(html, /Select Class/);
});

test('subject configuration filters by the selected class and honors configured level/class assignments', () => {
  const { subjects } = scoreFixture();
  const admin = { ...teacher, roleKey: 'HEADTEACHER', permissions: new Set(['*']) };
  const mappings = [
    ['Nursery subjects', ['Nursery 1', 'Nursery 2']],
    ['KG subjects', ['KG1', 'KG2']],
    ['Lower Primary subjects', ['Primary 1', 'Primary 2', 'Primary 3']],
    ['Upper Primary subjects', ['Primary 4', 'Primary 5', 'Primary 6']],
    ['JHS subjects', ['JHS 1', 'JHS 2', 'JHS 3']],
  ];
  const configured = mappings.map(([name, classIds]) => subjects.create({ name, classIds }, admin));
  const cases = [
    ['Nursery 1', 'Nursery subjects'], ['Nursery 2', 'Nursery subjects'], ['KG1', 'KG subjects'], ['KG2', 'KG subjects'],
    ['Primary 1', 'Lower Primary subjects'], ['Primary 2', 'Lower Primary subjects'], ['Primary 3', 'Lower Primary subjects'],
    ['Primary 4', 'Upper Primary subjects'], ['Primary 5', 'Upper Primary subjects'], ['Primary 6', 'Upper Primary subjects'],
    ['JHS 1', 'JHS subjects'], ['JHS 2', 'JHS subjects'], ['JHS 3', 'JHS subjects'],
  ];
  for (const [classId, expectedName] of cases) {
    const actual = subjects.list({ classId }, teacher).filter((item) => configured.some((entry) => entry.id === item.id));
    assert.deepEqual(actual.map((item) => item.name), [expectedName], `${classId} must use its configured level group`);
  }
  assert.throws(() => subjects.list({ classId: 'JHS 1' }, { ...teacher, schoolId: 'another-school' }), /Forbidden/);
});

test('score roster requires every academic selection and returns only the selected enrollment with canonical student ID and saved score', () => {
  const { students, subjects, resultService } = scoreFixture();
  const classId = 'Primary 1';
  const enrolled = eligibleStudent(students, classId, 'Enrolled');
  eligibleStudent(students, 'Primary 2', 'DifferentClass');
  eligibleStudent(students, classId, 'DifferentTerm', { term: 'Second Term' });
  eligibleStudent(students, classId, 'DifferentYear', { academicYear: '2025/2026' });
  const subject = subjects.list({ classId }, teacher)[0];
  for (const missing of ['academicYear', 'term', 'classId', 'subjectId']) {
    const filters = { academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id };
    delete filters[missing];
    const label = missing === 'academicYear' ? 'Academic year' : missing === 'classId' ? 'Class' : missing === 'subjectId' ? 'Subject' : 'Term';
    assert.throws(() => resultService.scoreEntryRoster(filters, teacher), new RegExp(`${label} is required`));
  }
  assert.throws(() => resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: 'not-for-class' }, teacher), /Subject is invalid for this class/);
  const initial = resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, teacher);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].studentId, enrolled.id);
  assert.equal(initial[0].permanentStudentId, enrolled.permanentStudentId);
  assert.equal(initial[0].saved, false);
  const saved = resultService.saveScore({ studentId: enrolled.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 43, examScore: 37 }, teacher);
  assert.equal(saved.totalScore, 80);
  assert.equal(resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, teacher)[0].totalScore, 80);
  assert.throws(() => resultService.saveScore({ studentId: enrolled.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, teacher), /between 0 and 50/);
  assert.throws(() => resultService.scoreEntryRoster({ academicYear: '2026/2027', term: 'First Term', classId, subjectId: subject.id }, { ...teacher, schoolId: 'another-school' }), /Forbidden/);
});

test('academic options and score-entry roster use the configured authenticated school instead of the legacy service default', async () => {
  const actor = { ...teacher, roleKey: 'PROPRIETOR', assignedClassIds: [], permissions: new Set(['*']) };
  const auth = { authenticateAsync: async (token) => token === 'osaah-school-user' ? actor : token === 'cross-school-user' ? { ...actor, schoolId: 'sch_other_02' } : null };
  const legacyService = createAcademicResultsService({ students: createStudentService({ schoolId }), subjects: createSubjectService({ schoolId }) });
  assert.throws(() => legacyService.options(actor), /Forbidden/, 'the old result-service default rejected the authenticated database school');
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  const app = createApp({ auth });
  if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
  else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  const server = http.createServer((incoming, outgoing) => {
    Promise.resolve(app(incoming, outgoing)).catch((error) => {
      outgoing.writeHead(error.message === 'Forbidden.' ? 403 : 500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const headers = { Authorization: 'Bearer osaah-school-user' };
    const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/academic/options`, { headers });
    assert.equal(optionsResponse.status, 200, 'the prior legacy-vs-authenticated school ID mismatch must not reject academic options');
    const options = await optionsResponse.json();
    assert.ok(options.classes.includes('Primary 1'));
    const subjectsResponse = await fetch(`http://127.0.0.1:${port}/api/subjects?classId=Primary%201`, { headers });
    assert.equal(subjectsResponse.status, 200);
    const subjectsBody = await subjectsResponse.json();
    assert.ok(subjectsBody.subjects.length > 0);
    const subjectId = subjectsBody.subjects[0].id;
    const missingQuery = new URLSearchParams({ term: 'First Term', classId: 'Primary 1', subjectId });
    const invalidRoster = await fetch(`http://127.0.0.1:${port}/api/academic/score-entry/roster?${missingQuery}`, { headers });
    assert.equal(invalidRoster.status, 400);
    assert.equal((await invalidRoster.json()).error, 'Unable to load students. Please try again.');
    const crossTenant = await fetch(`http://127.0.0.1:${port}/api/academic/options`, { headers: { Authorization: 'Bearer cross-school-user' } });
    assert.equal(crossTenant.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('authenticated Score Entry API loads scoped students, saves CA/Exam, and reloads the saved result', async () => {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const student = eligibleStudent(students, 'JHS 1', 'Api');
  eligibleStudent(students, 'JHS 2', 'OutOfClass');
  const subject = subjects.list({ classId: 'JHS 1' }, teacher)[0];
  const resultService = createAcademicResultsService({ schoolId, students, subjects });
  const actor = { ...teacher, roleKey: 'PROPRIETOR', assignedClassIds: [], permissions: new Set(['*']) };
  const auth = { authenticateAsync: async (token) => token === 'authorized' ? actor : null };
  const app = createApp({ auth, students, subjects, academicResults: resultService });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer authorized' };
    const query = new URLSearchParams({ academicYear: '2026/2027', term: 'First Term', classId: 'JHS 1', subjectId: subject.id });
    const loaded = await fetch(`${base}/api/academic/score-entry/roster?${query}`, { headers });
    assert.equal(loaded.status, 200);
    const roster = await loaded.json();
    assert.equal(roster.students.length, 1);
    assert.equal(roster.students[0].permanentStudentId, student.permanentStudentId);
    const savedResponse = await fetch(`${base}/api/academic/scores`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(query), studentId: student.id, caScore: 45, examScore: 35 }) });
    assert.equal(savedResponse.status, 201);
    const saved = await savedResponse.json();
    assert.equal(saved.totalScore, 80);
    assert.equal(saved.grade, 1);
    const reloadedResponse = await fetch(`${base}/api/academic/score-entry/roster?${query}`, { headers });
    assert.equal(reloadedResponse.status, 200);
    const reloaded = await reloadedResponse.json();
    assert.equal(reloaded.students[0].totalScore, 80);
    assert.equal(reloaded.students[0].saved, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Score Entry UI has dependent single-select subjects, required-selection gates, ID display, loading and error states', () => {
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/score-entry.js', import.meta.url), 'utf8');
  for (const header of ['OSAAH STUDENT INDEX', 'STUDENT NAME', 'CA / 50', 'Exam / 50', 'TOTAL', 'GRADE', 'SAVE STATUS']) assert.match(html, new RegExp(header));
  assert.match(js, /Select Class First/);
  assert.match(js, /Loading subjects…/);
  assert.match(js, /No subjects configured for this class\./);
  assert.match(js, /Loading students…/);
  assert.match(js, /No students found for the selected class and academic year\./);
  assert.match(js, /\/api\/academic\/score-entry\/roster/);
  assert.match(js, /student\.permanentStudentId/);
  assert.match(js, /subjectSelect\.value = ''/);
  assert.match(js, /ca < 0 \|\| ca > 50/);
  assert.match(js, /exam < 0 \|\| exam > 50/);
  assert.match(js, /setTimeout\(\(\) => save/);
  assert.match(js, /Error saving/);
});
