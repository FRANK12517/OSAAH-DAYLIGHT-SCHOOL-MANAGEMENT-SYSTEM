import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService } from '../src/students.js';
import { createConfiguredTestParent, TEST_PARENT_STUDENT_IDS } from '../src/test-parent-fixture.js';
import { createParentDashboardService } from '../src/parent-dashboard.js';
import { listConfiguredSampleAcademicContexts } from '../src/sample-academic-context.js';

const schoolId = 'school-osaah-daylight';
const academicYears = [{ id: 'year-current', name: '2026/2027', isCurrent: true }, { id: 'year-next', name: '2027/2028' }];
const terms = [
  { id: 'term-1', name: 'First Term', academicYearId: 'year-current' },
  { id: 'term-2', name: 'Second Term', academicYearId: 'year-current' },
  { id: 'term-3', name: 'Third Term', academicYearId: 'year-current' },
  { id: 'next-term-1', name: 'First Term', academicYearId: 'year-next' }
];
const classes = [{ id: 'class-primary-6', name: 'Primary 6' }, { id: 'class-jhs-1', name: 'JHS 1' }];

function academicService() {
  return { options: async () => ({ academicYears, terms, classes }) };
}

test('controlled sample contexts are deterministic, narrow, and preserve canonical IDs', () => {
  const parent = createConfiguredTestParent(schoolId);
  const contexts = listConfiguredSampleAcademicContexts({ actor: parent, permanentStudentId: TEST_PARENT_STUDENT_IDS[0], academicYears, terms, classes, schoolId });
  assert.deepEqual(contexts.map((item) => item.termId), ['term-1', 'term-2', 'term-3']);
  assert.ok(contexts.every((item) => item.academicYearId === 'year-current' && item.classId === 'class-primary-6' && item.isTestContext && item.provenance === 'TEST'));
  assert.deepEqual(listConfiguredSampleAcademicContexts({ actor: { ...parent, id: 'other-parent' }, permanentStudentId: TEST_PARENT_STUDENT_IDS[0], academicYears, terms, classes, schoolId }), []);
  assert.deepEqual(listConfiguredSampleAcademicContexts({ actor: parent, permanentStudentId: TEST_PARENT_STUDENT_IDS[0], academicYears, terms, classes: [{ id: 'class-jhs-1', name: 'JHS 1' }], schoolId }), []);
});

test('Parent options present exactly 1st Term, 2nd Term, and 3rd Term while retaining IDs', async () => {
  const service = createParentDashboardService({ students: createStudentService({ schoolId }), durableAcademic: academicService(), cards: [], testParentSchoolId: schoolId });
  const options = await service.options(createConfiguredTestParent(schoolId));
  assert.deepEqual(options.terms.filter((item) => item.academicYearId === 'year-current').map((item) => item.name), ['1st Term', '2nd Term', '3rd Term']);
  assert.deepEqual(options.terms.filter((item) => item.academicYearId === 'year-current').map((item) => item.id), ['term-1', 'term-2', 'term-3']);
});

test('authorized sample class succeeds, arbitrary class and year remain denied', async () => {
  const students = createStudentService({ schoolId });
  students.seedSampleStudents();
  const service = createParentDashboardService({ students, durableAcademic: academicService(), cards: [], testParentSchoolId: schoolId });
  const parent = createConfiguredTestParent(schoolId);
  const valid = await service.loadRecord(parent, { permanentStudentId: TEST_PARENT_STUDENT_IDS[0], recordType: 'student-summary', academicYear: 'year-current', term: 'term-1', classId: 'class-primary-6' });
  assert.equal(valid.context.classId, 'class-primary-6');
  await assert.rejects(() => service.loadRecord(parent, { permanentStudentId: TEST_PARENT_STUDENT_IDS[0], recordType: 'student-summary', academicYear: 'year-current', term: 'term-1', classId: 'class-jhs-1' }), (error) => error.code === 'PARENT_CLASS_FORBIDDEN');
  await assert.rejects(() => service.loadRecord(parent, { permanentStudentId: TEST_PARENT_STUDENT_IDS[0], recordType: 'student-summary', academicYear: 'year-next', term: 'next-term-1', classId: 'class-primary-6' }), (error) => error.code === 'PARENT_CLASS_FORBIDDEN');
});

test('sample context remains available after service recreation and does not change official counts', async () => {
  const firstStudents = createStudentService({ schoolId });
  firstStudents.seedSampleStudents();
  const parent = createConfiguredTestParent(schoolId);
  const first = createParentDashboardService({ students: firstStudents, durableAcademic: academicService(), cards: [], testParentSchoolId: schoolId });
  assert.equal((await first.loadRecord(parent, { permanentStudentId: TEST_PARENT_STUDENT_IDS[1], recordType: 'student-summary', academicYear: 'year-current', term: 'term-3', classId: 'class-primary-6' })).context.termId, 'term-3');
  const secondStudents = createStudentService({ schoolId });
  secondStudents.seedSampleStudents();
  const second = createParentDashboardService({ students: secondStudents, durableAcademic: academicService(), cards: [], testParentSchoolId: schoolId });
  assert.equal((await second.loadRecord(parent, { permanentStudentId: TEST_PARENT_STUDENT_IDS[1], recordType: 'student-summary', academicYear: 'year-current', term: 'term-3', classId: 'class-primary-6' })).context.termId, 'term-3');
  assert.equal(secondStudents.counts().students, 0);
  assert.equal(secondStudents.listStudents().length, 0);
});
