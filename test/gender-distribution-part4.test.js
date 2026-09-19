import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createExaminationService } from '../src/examinations.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createClassDatabaseService } from '../src/class-database.js';
import { createReportingService } from '../src/reporting.js';
import { classGenderDistribution } from '../src/gender-distribution.js';

const SCHOOL = 'school-osaah-daylight';
const YEAR = '2026/2027';
const TERM = 'First Term';
const actor = { id: 'gender-part4-headteacher', userId: 'gender-part4-headteacher', roleKey: 'HEADTEACHER', schoolId: SCHOOL, permissions: new Set(['*']), canApprove: true };

function makeContext() {
  const students = createStudentService({ schoolId: SCHOOL });
  const examinations = createExaminationService({ schoolId: SCHOOL, students, classes: CORE_LEVELS });
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects, schoolId: SCHOOL });
  const classDatabase = createClassDatabaseService({ students, schoolId: SCHOOL });
  const reporting = createReportingService({ schoolId: SCHOOL });
  return { students, examinations, subjects, results, classDatabase, reporting };
}

function names(student) { return [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '); }

function assertDistributionInvariants(distribution) {
  assert.ok(distribution.totalBoys >= 0);
  assert.ok(distribution.totalGirls >= 0);
  assert.ok(distribution.totalStudents >= 0);
  assert.ok(distribution.totalBoys + distribution.totalGirls <= distribution.totalStudents);
}

test('one canonical source flows from admission/student identity through all reporting modules', () => {
  const { students, subjects, results, classDatabase, reporting } = makeContext();
  const application = students.createAdmission({ firstName: 'Ama', surname: 'Mensah', gender: 'F', classAppliedFor: 'Primary 1' });
  assert.equal(application.applicant.gender, 'F');
  const student = students.createStudent({ ...application.applicant, firstName: 'Ama', surname: 'Mensah', gender: application.applicant.gender, classId: 'Primary 1', academicYearId: YEAR, termId: TERM });
  const canonical = students.findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER', requestedSchoolId: SCHOOL });
  assert.equal(canonical.gender, 'Female');
  assert.equal(canonical.permanentStudentId, student.permanentStudentId);
  students.linkParent(student.id, { parentId: 'parent-ama', fullName: 'Parent Mensah', primary: true });
  const subject = subjects.list({ classId: 'Primary 1' }, actor)[0];
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: YEAR, term: TERM, caScore: 35, examScore: 45 }, actor);
  const result = results.result({ studentId: student.id, classId: 'Primary 1', academicYear: YEAR, term: TERM }, actor);
  const rows = classDatabase.list({ classId: 'Primary 1' }, actor);
  const broadsheet = reporting.buildAcademicReport({ classId: 'Primary 1', academicYear: YEAR, term: TERM }, actor, { students, examinations: { listMarks: () => [], listExaminations: () => [] }, attendance: [] });
  assert.equal(result.studentIndexNumber, student.permanentStudentId);
  assert.equal(result.gender, 'Female');
  assert.equal(result.classGenderDistribution.totalGirls, 1);
  assert.equal(rows.find((row) => row.permanentStudentId === student.permanentStudentId).gender, 'Female');
  assert.equal(broadsheet.studentPerformance.find((row) => row.permanentStudentId === student.permanentStudentId).gender, 'Female');
  assert.equal(students.parentLinksFor(student.id)[0].permanentStudentId, student.permanentStudentId);
});

test('promotion moves male and female students without changing identity, gender, or downstream class counts', () => {
  const { students, examinations, results, classDatabase, reporting } = makeContext();
  const male = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'Male', classId: 'Primary 1', academicYearId: YEAR, termId: TERM });
  const female = students.createStudent({ firstName: 'Esi', surname: 'Owusu', gender: 'Female', classId: 'Primary 1', academicYearId: YEAR, termId: TERM });
  const original = { maleId: male.permanentStudentId, femaleId: female.permanentStudentId };
  for (const student of [male, female]) {
    examinations.promote(student.id, YEAR, 'PROMOTED', actor, null, { classId: 'Primary 1', termId: TERM, toClassId: 'Primary 2', nextAcademicYearId: '2027/2028', nextTermId: TERM });
  }
  assert.equal(students.listStudents().filter((item) => item.classId === 'Primary 1').length, 0);
  const promoted = students.listStudents().filter((item) => item.classId === 'Primary 2');
  assert.equal(promoted.length, 2);
  assert.deepEqual(promoted.map((item) => item.gender).sort(), ['Female', 'Male']);
  assert.deepEqual(promoted.map((item) => item.permanentStudentId).sort(), Object.values(original).sort());
  assert.deepEqual(classGenderDistribution({ students, classId: 'Primary 2', academicYear: '2027/2028', term: TERM }), { totalBoys: 1, totalGirls: 1, totalStudents: 2 });
  assert.equal(classDatabase.list({ classId: 'Primary 2' }, actor).length, 2);
  const result = results.result({ studentId: male.id, classId: 'Primary 2', academicYear: '2027/2028', term: TERM }, actor);
  assert.equal(result.studentIndexNumber, original.maleId);
  assert.equal(result.gender, 'Male');
  const report = reporting.buildAcademicReport({ classId: 'Primary 2', academicYear: '2027/2028', term: TERM }, actor, { students, examinations: { listMarks: () => [], listExaminations: () => [] }, attendance: [] });
  assert.equal(report.genderDistribution.totalStudents, 2);
  assert.equal(report.studentPerformance.find((row) => row.permanentStudentId === original.femaleId).gender, 'Female');
});

test('repetition retains permanent ID, name, gender, parent link, class, and history without duplication', () => {
  const { students, examinations } = makeContext();
  const student = students.createStudent({ firstName: 'Yaw', middleName: 'Kojo', surname: 'Addo', gender: 'Male', classId: 'Primary 3', academicYearId: YEAR, termId: TERM });
  students.linkParent(student.id, { parentId: 'parent-yaw', fullName: 'Parent Addo', primary: true });
  const before = students.getStudent(student.id);
  examinations.promote(student.id, YEAR, 'REPEAT', actor, 'Retain current class', { classId: 'Primary 3', termId: TERM, nextAcademicYearId: '2027/2028', nextTermId: TERM });
  const after = students.getStudent(student.id);
  assert.equal(after.permanentStudentId, before.permanentStudentId);
  assert.equal(names(after), names(before));
  assert.equal(after.gender, 'Male');
  assert.equal(after.classId, 'Primary 3');
  assert.equal(students.listStudents().filter((item) => item.permanentStudentId === before.permanentStudentId).length, 1);
  assert.equal(students.parentLinksFor(student.id)[0].fullName, 'Parent Addo');
  assert.ok(after.history.some((entry) => entry.reason === 'REPEAT'));
});

test('legacy missing gender is not inferred and is counted only in total students', () => {
  const { students } = makeContext();
  students.createStudent({ firstName: 'Legacy', surname: 'Record', classId: 'KG1', admissionYearId: YEAR, termId: TERM });
  const distribution = classGenderDistribution({ students, classId: 'KG1', academicYear: YEAR, term: TERM });
  assert.deepEqual(distribution, { totalBoys: 0, totalGirls: 0, totalStudents: 1 });
  assert.equal(students.listStudents().find((item) => item.classId === 'KG1').gender, null);
});

test('sample records remain isolated from real population counts', () => {
  const { students } = makeContext();
  students.createStudent({ firstName: 'Real', surname: 'Boy', gender: 'Male', classId: 'JHS 1', admissionYearId: YEAR, termId: TERM });
  students.createStudent({ isTestRecord: true, permanentStudentId: 'TEST-OSAAH-J1-999', firstName: 'Sample', surname: 'Boy', gender: 'Male', classId: 'JHS 1' });
  assert.deepEqual(classGenderDistribution({ students, classId: 'JHS 1', academicYear: YEAR, term: TERM }), { totalBoys: 1, totalGirls: 0, totalStudents: 1 });
  assert.deepEqual(classGenderDistribution({ students, classId: 'JHS 1', academicYear: YEAR, term: TERM, includeTestRecords: true }), { totalBoys: 2, totalGirls: 0, totalStudents: 2 });
});

test('fully classified and legacy distributions satisfy the documented equations', () => {
  const { students } = makeContext();
  students.createStudent({ firstName: 'Boy', surname: 'One', gender: 'M', classId: 'Nursery 1', admissionYearId: YEAR, termId: TERM });
  students.createStudent({ firstName: 'Girl', surname: 'One', gender: 'F', classId: 'Nursery 1', admissionYearId: YEAR, termId: TERM });
  const complete = classGenderDistribution({ students, classId: 'Nursery 1', academicYear: YEAR, term: TERM });
  assertDistributionInvariants(complete);
  assert.equal(complete.totalBoys + complete.totalGirls, complete.totalStudents);
  students.createStudent({ firstName: 'Unknown', surname: 'One', classId: 'Nursery 1', admissionYearId: YEAR, termId: TERM });
  const legacy = classGenderDistribution({ students, classId: 'Nursery 1', academicYear: YEAR, term: TERM });
  assertDistributionInvariants(legacy);
  assert.ok(legacy.totalBoys + legacy.totalGirls < legacy.totalStudents);
});

test('gender metadata does not alter score, grade, ranking, attendance, or PDF/print contracts', async () => {
  const { students, subjects, results } = makeContext();
  const male = students.createStudent({ firstName: 'Score', surname: 'Student', gender: 'Male', classId: 'Primary 4', admissionYearId: YEAR, termId: TERM });
  const female = students.createStudent({ firstName: 'Score', surname: 'Student', gender: 'Female', classId: 'Primary 4', admissionYearId: YEAR, termId: TERM });
  const subject = subjects.list({ classId: 'Primary 4' }, actor)[0];
  for (const student of [male, female]) results.saveScore({ studentId: student.id, classId: 'Primary 4', subjectId: subject.id, academicYear: YEAR, term: TERM, caScore: 30, examScore: 50 }, actor);
  const maleResult = results.result({ studentId: male.id, classId: 'Primary 4', academicYear: YEAR, term: TERM }, actor);
  const femaleResult = results.result({ studentId: female.id, classId: 'Primary 4', academicYear: YEAR, term: TERM }, actor);
  for (const field of ['totalScore', 'average', 'aggregate', 'classPosition', 'subjectsSat']) assert.equal(maleResult[field], femaleResult[field], field);
  const terminal = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const mock = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  assert.match(terminal, /window\.print/); assert.match(mock, /window\.print/);
});
