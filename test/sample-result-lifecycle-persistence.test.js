import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createSampleFixtureRepository } from '../src/sample-fixture-repository.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'fixture-publisher', roleKey: 'HEADTEACHER', portal: 'school', schoolId, permissions: new Set(['results.read', 'results.generate', 'results.publish', 'marks.write']) };
const mockActor = { ...actor, permissions: new Set([...actor.permissions, 'mock.scores.write', 'mock.scores.read', 'mock.results.read']) };

function fixtureDatabase() {
  const rows = new Map();
  const calls = [];
  return {
    dialect: 'tidb',
    calls,
    async query(sql, parameters) {
      calls.push({ kind: 'query', sql });
      const [requestedSchool, sampleStudent, year, term, classId, type, version] = parameters;
      return [...rows.values()].filter((row) => row.schoolId === requestedSchool && row.sampleStudentId === sampleStudent && row.academicYearId === year && row.termId === term && row.classId === classId && row.fixtureType === type && row.fixtureVersion === version);
    },
    async execute(sql, parameters) {
      calls.push({ kind: 'write', sql });
      if (sql.startsWith('UPDATE sample_data_fixtures')) {
        const row = [...rows.values()].find((item) => item.fixtureId === parameters[2]);
        if (row) { row.fixturePayload = parameters[0]; row.updatedAt = parameters[1]; }
        return { affectedRows: row ? 1 : 0 };
      }
      const [fixtureId, rowSchoolId, sampleStudentId, academicYearId, termId, rowClassId, fixtureType, fixturePayload, fixtureVersion, createdAt, updatedAt] = parameters;
      const row = { fixtureId, schoolId: rowSchoolId, sampleStudentId, academicYearId, termId, classId: rowClassId, fixtureType, fixturePayload, fixtureVersion, createdAt, updatedAt };
      rows.set([rowSchoolId, sampleStudentId, academicYearId, termId, rowClassId, fixtureType, fixtureVersion].join('|'), row);
      return { affectedRows: 1 };
    }
  };
}

function runtime(adapter) {
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  const realStudent = students.createStudent({ firstName: 'Real', surname: 'Learner', classId: 'Primary 1', admissionYearId: '2026' });
  const subjects = createSubjectService({ schoolId });
  const academicResults = createAcademicResultsService({ students, subjects, schoolId });
  const repository = createSampleFixtureRepository({ adapter, schoolId });
  const workflow = createSampleResultWorkflow({ students, subjects, academicResults, sampleFixtureRepository: repository, schoolId, now: () => '2026-11-08T00:00:00.000Z' });
  return { students, realStudent, academicResults, workflow };
}

test('sample lifecycle publication and reset survive independent runtime instances using only the TiDB sample fixture table', async () => {
  const db = fixtureDatabase();
  const first = runtime(db);
  const sample = first.workflow.students('Primary 1')[0];
  const generated = first.workflow.generate({ studentId: sample.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' }, actor);
  await first.workflow.persistGeneratedState(generated, actor);

  const afterReload = runtime(db);
  const beforePublish = await afterReload.workflow.state({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' }, actor);
  assert.equal(beforePublish.isSample, true);
  assert.equal(beforePublish.publicationStatus, 'UNPUBLISHED');
  const published = await afterReload.workflow.publish({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(published.isSample, true);
  assert.equal(published.status, 'PUBLISHED');

  const afterPublishReload = runtime(db);
  const reloaded = await afterPublishReload.workflow.state({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.equal(reloaded.publicationStatus, 'PUBLISHED');
  assert.equal(reloaded.publication.id, published.id);
  assert.equal((await afterPublishReload.workflow.publish({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor)).id, published.id, 'repeated publish is idempotent');

  const beforeResetStudentCount = afterPublishReload.students.counts().students;
  await afterPublishReload.workflow.reset({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  const afterResetReload = runtime(db);
  assert.equal(await afterResetReload.workflow.state({ permanentStudentId: sample.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor), null);
  assert.equal(afterResetReload.students.counts().students, beforeResetStudentCount, 'reset preserves all official students');
  assert.ok(db.calls.length > 0);
  assert.ok(db.calls.every(({ sql }) => sql.includes('sample_data_fixtures')), 'lifecycle persistence must use only the dedicated sample fixture table');
});

test('result lifecycle fixture authorization is school scoped and does not permit parents or unrelated writers', async () => {
  const db = fixtureDatabase();
  const { workflow } = runtime(db);
  const sample = workflow.students('Primary 1')[0];
  const generated = workflow.generate({ studentId: sample.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  await assert.rejects(() => workflow.persistGeneratedState(generated, { ...actor, schoolId: 'other-school' }), /Forbidden/);
  const noPermission = { ...actor, permissions: new Set() };
  await assert.rejects(() => workflow.persistGeneratedState(generated, noPermission), /forbidden/i);
  assert.equal(db.calls.length, 0, 'rejected writes must not query or update fixtures');
});

test('Mock publication and reset persist separately from terminal sample lifecycle state', async () => {
  const db = fixtureDatabase();
  const initial = runtime(db);
  const sample = initial.workflow.students('JHS 1')[0];
  const terminal = initial.workflow.generate({ studentId: sample.id, classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'TERMINAL' }, actor);
  await initial.workflow.persistGeneratedState(terminal, actor);
  const mock = initial.workflow.generateMock({ studentId: sample.id, classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, mockActor);
  await initial.workflow.persistGeneratedState(mock, mockActor);

  const publisher = runtime(db);
  const mockState = { permanentStudentId: sample.permanentStudentId, classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', examinationType: 'MOCK', mockLabel: '1st Mock' };
  assert.equal((await publisher.workflow.state(mockState, mockActor)).publicationStatus, 'UNPUBLISHED');
  const publication = await publisher.workflow.publish({ ...mockState, examination: 'MOCK' }, mockActor);
  assert.equal(publication.examination, 'MOCK');
  const afterPublish = runtime(db);
  assert.equal((await afterPublish.workflow.state(mockState, mockActor)).publicationStatus, 'PUBLISHED');
  await afterPublish.workflow.resetMock({ ...mockState, permanentStudentId: sample.permanentStudentId }, mockActor);
  const afterReset = runtime(db);
  assert.equal(await afterReset.workflow.state(mockState, mockActor), null);
  assert.equal((await afterReset.workflow.state({ ...mockState, examinationType: 'TERMINAL', mockLabel: undefined }, actor)).isSample, true, 'Mock reset leaves terminal sample state intact');
  assert.ok(db.calls.every(({ sql }) => sql.includes('sample_data_fixtures')), 'terminal and Mock lifecycle updates remain fixture-only');
});
