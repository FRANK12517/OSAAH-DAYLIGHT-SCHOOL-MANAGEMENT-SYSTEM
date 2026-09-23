import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStudentService } from '../src/students.js';
import { createClassDatabaseService } from '../src/class-database.js';

const actor = { roleKey: 'SCHOOL_ADMIN', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read']) };

test('Class Database exposes configured academic years and canonical class options', () => {
  const database = createClassDatabaseService({ students: createStudentService() });
  const options = database.options(actor);
  assert.deepEqual(options.academicYears, ['2024/2025', '2025/2026', '2026/2027', '2027/2028', '2028/2029']);
  assert.deepEqual(options.classes, ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
});

test('Class Database query path verifies every canonical class', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  const classes = database.classes();
  classes.forEach((classId, index) => {
    const student = students.createStudent({ firstName: `Student${index}`, surname: 'Fixture', gender: index % 2 ? 'Female' : 'Male', classId, admissionYearId: '2026' });
    students.assignClass(student.id, { classId, academicYearId: '2026/2027' });
  });
  for (const classId of classes) assert.equal(database.list({ classId, academicYear: '2026/2027' }, actor).length, 1, classId);
});

test('Class Database selects historical enrollment by academic year rather than latest class', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  const student = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'Male', classId: 'Primary 2', admissionYearId: '2026', family: [{ fullName: 'Kwame Mensah', telephone: '0240000000', primary: true }] });
  students.assignClass(student.id, { classId: 'Primary 1', academicYearId: '2026/2027' });
  students.assignClass(student.id, { classId: 'Primary 2', academicYearId: '2027/2028' });
  assert.equal(database.list({ classId: 'Primary 1', academicYear: '2026/2027', search: 'Kofi Mensah' }, actor)[0].permanentStudentId, student.permanentStudentId);
  assert.equal(database.list({ classId: 'Primary 1', academicYear: '2027/2028' }, actor).length, 0);
  assert.equal(database.list({ classId: 'Primary 2', academicYear: '2027/2028' }, actor)[0].studentName, 'Kofi Mensah');
});

test('Class Database searches ID, student, parent, and phone and retains siblings', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  const first = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'Male', classId: 'Primary 3', admissionYearId: '2026', family: [{ fullName: 'Kwame Mensah', telephone: '0240000000', primary: true }] });
  const second = students.createStudent({ firstName: 'Ama', surname: 'Mensah', gender: 'Female', classId: 'Primary 3', admissionYearId: '2026', family: [{ fullName: 'Kwame Mensah', telephone: '0240000000', primary: true }] });
  for (const value of [first, second]) students.assignClass(value.id, { classId: 'Primary 3', academicYearId: '2026/2027' });
  assert.equal(database.list({ classId: 'Primary 3', academicYear: '2026/2027', search: first.permanentStudentId }, actor).length, 1);
  assert.equal(database.list({ classId: 'Primary 3', academicYear: '2026/2027', search: 'Kofi Mensah' }, actor)[0].studentName, 'Kofi Mensah');
  assert.equal(database.list({ classId: 'Primary 3', academicYear: '2026/2027', search: 'Kwame Mensah' }, actor).length, 2);
  assert.equal(database.list({ classId: 'Primary 3', academicYear: '2026/2027', search: '0240000000' }, actor).length, 2);
  assert.equal(database.list({ classId: 'Primary 4', academicYear: '2026/2027', search: 'Kwame' }, actor).length, 0);
});

test('Class Database preserves missing gender and returns an explicit empty result', () => {
  const students = createStudentService();
  const database = createClassDatabaseService({ students });
  students.createStudent({ firstName: 'Legacy', surname: 'Student', classId: 'JHS 3', admissionYearId: '2026' });
  const row = database.list({ classId: 'JHS 3', academicYear: '2026/2027' }, actor)[0];
  assert.equal(row.gender, 'Not Recorded');
  assert.deepEqual(database.list({ classId: 'Nursery 2', academicYear: '2026/2027' }, actor), []);
});

test('Class Database page has canonical selectors, required columns, and deterministic loading/error states', async () => {
  const page = await readFile(new URL('../public/class-database.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/class-database.js', import.meta.url), 'utf8');
  assert.match(page, /Academic Year:<select[^>]+id="academicYear"/);
  assert.match(page, /Class:<select[^>]+id="classId"/);
  assert.match(page, /Permanent Student ID.*Name of Student.*Gender.*Name of Parent\/Guardian.*Registered Parent Phone Number/s);
  assert.match(client, /year\.addEventListener\('change'/);
  assert.match(client, /No students are currently enrolled in this class for the selected academic year/);
  assert.match(client, /Loading…/);
  assert.match(client, /Unable to load Class Database records/);
  assert.doesNotMatch(client, /Basic \$1/);
});
