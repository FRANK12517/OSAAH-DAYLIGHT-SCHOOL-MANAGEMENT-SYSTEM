import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { createReportingService } from '../src/reporting.js';
import { classGenderDistribution } from '../src/gender-distribution.js';

const actor = { id: 'reports-gender-part3', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
const YEAR = '2026/2027';
const TERM = '1st Term';

function context() {
  const students = createStudentService();
  const reporting = createReportingService({ schoolId: actor.schoolId });
  const examinations = {
    listMarks: ({ requestedSchoolId } = {}) => requestedSchoolId === actor.schoolId ? marks : [],
    listExaminations: () => [{ academicYearId: YEAR }]
  };
  const marks = [];
  return { students, reporting, examinations, marks };
}

for (const classId of CORE_LEVELS) {
  test(`broadsheet adds canonical gender and distribution for ${classId}`, () => {
    const { students, reporting, examinations, marks } = context();
    const male = students.createStudent({ firstName: 'Male', surname: classId, gender: 'M', classId, admissionYearId: '2026' });
    const female = students.createStudent({ firstName: 'Female', surname: classId, gender: 'Female', classId, admissionYearId: '2026' });
    const legacy = students.createStudent({ firstName: 'Legacy', surname: classId, classId, admissionYearId: '2026' });
    students.createStudent({ firstName: 'Test', surname: classId, gender: 'Male', classId, isTestRecord: true });
    marks.push(
      { studentId: male.id, rawMarks: 80, academicYear: YEAR, term: TERM, subjectId: `english-${classId}` },
      { studentId: female.id, rawMarks: 70, academicYear: YEAR, term: TERM, subjectId: `english-${classId}` },
      { studentId: legacy.id, rawMarks: 99, academicYear: '2025/2026', term: TERM, subjectId: `english-${classId}` }
    );
    const report = reporting.buildAcademicReport({ classId, academicYear: YEAR, term: TERM }, actor, { students, examinations, attendance: [] });
    assert.deepEqual(report.genderDistribution, { totalBoys: 1, totalGirls: 1, totalStudents: 3 });
    assert.equal(report.summary.totalBoys, 1); assert.equal(report.summary.totalGirls, 1); assert.equal(report.summary.totalStudents, 3);
    assert.deepEqual(report.studentPerformance.map((row) => row.gender).sort(), ['Female', 'Male', 'Not Recorded']);
    assert.equal(report.studentPerformance.find((row) => row.studentId === male.id).averageScore, 80);
    assert.equal(report.studentPerformance.find((row) => row.studentId === legacy.id).assessmentCount, 0);
    assert.deepEqual(classGenderDistribution({ students, classId, academicYear: YEAR, term: TERM }), report.genderDistribution);
    const csv = reporting.exportReport(report, 'csv'); const pdf = reporting.exportReport(report, 'pdf');
    assert.match(csv.content, /gender/i); assert.match(csv.content, /Male/); assert.match(pdf.content.toString(), /^%PDF-1\.4/);
  });
}

test('changing selected class changes broadsheet counts without cross-class contamination', () => {
  const { students, reporting, examinations } = context();
  students.createStudent({ firstName: 'A', surname: 'Primary1', gender: 'Male', classId: 'Primary 1', admissionYearId: '2026' });
  students.createStudent({ firstName: 'B', surname: 'Primary2', gender: 'Female', classId: 'Primary 2', admissionYearId: '2026' });
  const first = reporting.buildAcademicReport({ classId: 'Primary 1', academicYear: YEAR, term: TERM }, actor, { students, examinations, attendance: [] });
  const second = reporting.buildAcademicReport({ classId: 'Primary 2', academicYear: YEAR, term: TERM }, actor, { students, examinations, attendance: [] });
  assert.deepEqual(first.genderDistribution, { totalBoys: 1, totalGirls: 0, totalStudents: 1 });
  assert.deepEqual(second.genderDistribution, { totalBoys: 0, totalGirls: 1, totalStudents: 1 });
});

test('broadsheet UI keeps horizontal scroll and exposes gender, print, and export controls', () => {
  const html = fs.readFileSync(new URL('../public/reports-academic.html', import.meta.url), 'utf8');
  assert.match(html, /GENDER/); assert.match(html, /TOTAL BOYS IN CLASS/); assert.match(html, /TOTAL GIRLS IN CLASS/); assert.match(html, /TOTAL STUDENTS IN CLASS/);
  assert.match(html, /table-scroll/); assert.match(html, /window\.print/); assert.match(html, /export-csv/); assert.match(html, /export-pdf/);
});
