import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createClassDatabaseService } from '../src/class-database.js';
import { createResultSlipPdfService } from '../src/result-slip-pdf.js';

const actor = { id: 'head-gender-part2', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
const classes = ['Nursery 1', 'KG1', 'Primary 1', 'Primary 6', 'JHS 1'];

function makeContext() {
  const students = createStudentService();
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  const classDatabase = createClassDatabaseService({ students });
  return { students, subjects, results, classDatabase };
}

for (const classId of classes) {
  test(`terminal result live gender distribution matches Class Database for ${classId}`, () => {
    const { students, subjects, results, classDatabase } = makeContext();
    const male = students.createStudent({ firstName: 'Kojo', surname: classId, gender: 'Male', classId, admissionYearId: '2026' });
    students.createStudent({ firstName: 'Ama', surname: classId, gender: 'Female', classId, admissionYearId: '2026' });
    students.createStudent({ firstName: 'Legacy', surname: classId, classId, admissionYearId: '2026' });
    students.createStudent({ firstName: 'Other', surname: 'Class', gender: 'Female', classId: 'Primary 2', admissionYearId: '2026' });
    const subject = subjects.list({ classId }, actor)[0];
    results.saveScore({ studentId: male.id, classId, subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 40 }, actor);
    const report = results.result({ studentId: male.id, classId, academicYear: '2026/2027', term: 'First Term' }, actor);
    const rows = classDatabase.list({ classId }, actor);
    assert.equal(report.studentName, 'Kojo ' + classId);
    assert.equal(report.gender, 'Male');
    assert.deepEqual(report.classGenderDistribution, { totalBoys: 1, totalGirls: 1, totalStudents: 3 });
    assert.equal(report.classGenderDistribution.totalStudents, rows.length);
    assert.equal(rows.filter((row) => row.gender === 'Male').length, report.classGenderDistribution.totalBoys);
    assert.equal(rows.filter((row) => row.gender === 'Female').length, report.classGenderDistribution.totalGirls);
  });
}

test('Mock result uses the same live canonical distribution and excludes production test records', () => {
  const { students, subjects, results, classDatabase } = makeContext();
  const male = students.createStudent({ firstName: 'JHS', surname: 'Male', gender: 'M', classId: 'JHS 1', admissionYearId: '2026' });
  students.createStudent({ firstName: 'JHS', surname: 'Female', gender: 'Female', classId: 'JHS 1', admissionYearId: '2026' });
  students.createStudent({ firstName: 'JHS', surname: 'Unknown', classId: 'JHS 1', admissionYearId: '2026' });
  students.createStudent({ isTestRecord: true, permanentStudentId: 'TEST-OSAAH-J1-999', firstName: 'Sample', surname: 'Boy', gender: 'Male', classId: 'JHS 1' });
  const subject = subjects.list({ classId: 'JHS 1' }, actor)[0];
  results.saveMockScore({ studentId: male.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 72 }, actor);
  const report = results.result({ studentId: male.id, classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, actor, { mock: true });
  const rows = classDatabase.list({ classId: 'JHS 1' }, actor);
  assert.equal(report.resultType, 'MOCK'); assert.equal(report.gender, 'Male');
  assert.deepEqual(report.classGenderDistribution, { totalBoys: 1, totalGirls: 1, totalStudents: 3 });
  assert.equal(report.classGenderDistribution.totalStudents, rows.length);
});

test('browser and PDF contracts include the student gender distribution fields', async () => {
  const terminal = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const mock = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  const pdfSource = fs.readFileSync(new URL('../src/result-slip-pdf.js', import.meta.url), 'utf8');
  for (const source of [terminal, mock, pdfSource]) { assert.match(source, /Gender/); assert.match(source, /TOTAL BOYS IN CLASS|Total Boys in Class/); assert.match(source, /TOTAL GIRLS IN CLASS|Total Girls in Class/); assert.match(source, /TOTAL STUDENTS IN CLASS|Total Students in Class/); }
  const pdf = await createResultSlipPdfService().pdf({ resultType: 'MOCK', mockLabel: '1st Mock', studentName: 'JHS Male', studentIndexNumber: 'OSAAH/2026/0001', classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', gender: 'Male', classGenderDistribution: { totalBoys: 1, totalGirls: 1, totalStudents: 3 }, subjects: [], totalScore: 0, average: 0 });
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1\./); assert.ok(pdf.length > 2500);
});
