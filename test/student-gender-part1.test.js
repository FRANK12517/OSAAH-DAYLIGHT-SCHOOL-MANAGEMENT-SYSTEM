import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdmissionFormService } from '../src/admission-form.js';
import { createStudentService } from '../src/students.js';
import { createClassDatabaseService } from '../src/class-database.js';
import { displayStudentGender, normalizeStudentGender, requireStudentGender } from '../src/student-gender.js';

const parent = { id: 'parent-gender-1', portal: 'parent', roleKey: 'PARENT' };
const baseAdmission = (gender) => ({ studentSurname: 'Mensah', studentFirstName: gender === 'Male' ? 'Kofi' : 'Adwoa', studentMiddleName: '', dateOfBirth: '2017-01-01', gender, hometown: 'Accra', region: 'Greater Accra', nationality: 'Ghanaian', classAppliedFor: 'Nursery', residentialAddress: 'Accra', digitalAddress: 'GA-000-0000', nearestLandmark: 'School', primaryGuardianFullName: 'Kwame Mensah', primaryGuardianPrimaryPhone: '0241111111', primaryGuardianSecondaryPhone: '', secondaryGuardianPrimaryPhone: '', secondaryGuardianSecondaryPhone: '', emergencyContactPhone: '' });

function readyApplication(service, gender) {
  const application = service.createApplication(baseAdmission(gender), parent);
  service.updateApplication(application.applicationNumber, { parentDeclarationAccepted: true }, parent);
  for (const documentType of ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD']) service.attachDocument(application.applicationNumber, { documentType, fileReference: `${documentType}.pdf` }, parent);
  return service.submitApplication(application.applicationNumber, parent, null);
}

test('new admissions require gender and normalize equivalent values', () => {
  const service = createAdmissionFormService();
  assert.equal(readyApplication(service, 'M').section1.gender, 'Male');
  assert.equal(readyApplication(service, 'FEMALE').section1.gender, 'Female');
  const missing = service.createApplication(baseAdmission(''), parent);
  service.updateApplication(missing.applicationNumber, { parentDeclarationAccepted: true }, parent);
  for (const documentType of ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD']) service.attachDocument(missing.applicationNumber, { documentType, fileReference: documentType }, parent);
  assert.throws(() => service.submitApplication(missing.applicationNumber, parent, null), /Missing required field: gender/);
});

test('canonical student gender survives Permanent Student ID allocation and promotion/repetition', () => {
  const students = createStudentService();
  const male = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'M', classId: 'Primary 1', admissionYearId: '2026' });
  const female = students.createStudent({ firstName: 'Adwoa', surname: 'Mensah', gender: 'Female', classId: 'Primary 2', admissionYearId: '2026' });
  assert.match(male.permanentStudentId, /^OSAAH\/2026\//); assert.equal(male.gender, 'Male'); assert.equal(female.gender, 'Female');
  const promoted = students.assignClass(male.id, { classId: 'Primary 2', academicYearId: '2027', termId: 'TERM_1', reason: 'PROMOTION' });
  const repeated = students.assignClass(female.id, { classId: 'Primary 2', academicYearId: '2027', termId: 'TERM_1', reason: 'REPETITION' });
  assert.equal(promoted.id, male.id); assert.equal(promoted.permanentStudentId, male.permanentStudentId); assert.equal(promoted.gender, 'Male'); assert.equal(repeated.id, female.id); assert.equal(repeated.gender, 'Female'); assert.equal(students.listStudents().filter((item) => item.permanentStudentId === male.permanentStudentId).length, 1);
});

test('Class Database autopulls canonical gender and does not guess missing legacy gender', () => {
  const students = createStudentService();
  const male = students.createStudent({ firstName: 'Kofi', surname: 'Mensah', gender: 'MALE', classId: 'Primary 1', admissionYearId: '2026' });
  const missing = students.createStudent({ firstName: 'Legacy', surname: 'Learner', classId: 'Primary 1', admissionYearId: '2026' });
  students.linkParent(male.id, { parentId: 'p1', fullName: 'Kwame Mensah', telephone: '0241111111', primary: true });
  const service = createClassDatabaseService({ students }); const actor = { schoolId: 'school-osaah-daylight', roleKey: 'HEADTEACHER', permissions: new Set(['students.read']) };
  const rows = service.list({ classId: 'Primary 1' }, actor); const maleRow = rows.find((row) => row.studentId === male.id); const missingRow = rows.find((row) => row.studentId === missing.id);
  assert.equal(maleRow.gender, 'Male'); assert.equal(maleRow.parentGuardianName, 'Kwame Mensah'); assert.equal(missingRow.gender, 'Not Recorded');
});

test('gender normalization contract and existing schema/enrollment path remain canonical', () => {
  assert.equal(normalizeStudentGender('M'), 'Male'); assert.equal(normalizeStudentGender('F'), 'Female'); assert.equal(normalizeStudentGender('unknown'), null); assert.equal(displayStudentGender(null), 'Not Recorded'); assert.throws(() => requireStudentGender(''), /Male or Female/);
  const enrollment = fs.readFileSync(new URL('../src/admission-enrollment.js', import.meta.url), 'utf8'); const studentSchema = fs.readFileSync(new URL('../schema/003_students_admissions.sql', import.meta.url), 'utf8');
  assert.match(enrollment, /requireStudentGender/); assert.match(enrollment, /students \([^)]*gender/); assert.match(enrollment, /student_profiles \([^)]*gender/); assert.match(studentSchema, /student_profiles[^\n]*gender/i);
});

test('admission UI already exposes one required Male/Female selector', () => {
  const page = fs.readFileSync(new URL('../public/admission-application.html', import.meta.url), 'utf8');
  assert.match(page, /name="gender"[^>]*required/); assert.match(page, /<option>Male<\/option>/); assert.match(page, /<option>Female<\/option>/); assert.equal((page.match(/name="gender"/g) ?? []).length, 1);
});

test('Class Database retains all canonical classes and exposes the Gender column', () => {
  const page = fs.readFileSync(new URL('../public/class-database.html', import.meta.url), 'utf8'); const client = fs.readFileSync(new URL('../public/class-database.js', import.meta.url), 'utf8'); const students = createStudentService(); const service = createClassDatabaseService({ students });
  assert.match(page, /<th>Gender<\/th>/); assert.match(client, /item\.gender/); assert.deepEqual(service.classes(), ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
});
