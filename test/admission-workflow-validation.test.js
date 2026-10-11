import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionFormService, validateStaffAdmission } from '../src/admission-form.js';

const base = { admissionType: 'EXISTING_STUDENT', firstName: 'Ama', surname: 'Mensah', classId: 'Primary 4', admissionYear: '2022', term: 'TERM_1', existingStudentId: 'LEGACY-42' };

test('existing-student pathway needs a stable reference but bypasses new-applicant assessment and document review', () => {
  assert.deepEqual(validateStaffAdmission(base, { decision: 'ACCEPTED' }), { valid: true, errors: [] });
});

test('transfer and first-time acceptance retain assessment and document-review gates', () => {
  const transfer = { ...base, admissionType: 'TRANSFER', previousSchool: 'Previous School', guardianName: 'Parent', guardianPhone: '0240000000' };
  assert.equal(validateStaffAdmission(transfer).valid, true);
  assert.match(validateStaffAdmission(transfer, { decision: 'ACCEPTED' }).errors.join(' '), /assessment score/);
  assert.match(validateStaffAdmission({ ...transfer, assessmentScore: 80 }, { decision: 'ACCEPTED' }).errors.join(' '), /Document review/);
  assert.equal(validateStaffAdmission({ ...transfer, assessmentScore: 80, documentsReviewed: true }, { decision: 'ACCEPTED' }).valid, true);
});

test('health insurance number is optional and validated only when supplied', () => {
  assert.equal(validateStaffAdmission(base).valid, true);
  assert.equal(validateStaffAdmission({ ...base, healthInsuranceNumber: 'NHIS 12-3456' }).valid, true);
  assert.match(validateStaffAdmission({ ...base, healthInsuranceNumber: '!' }).errors.join(' '), /Health insurance/);
});

test('public applications remain first-time applications and preserve optional insurance', () => {
  const service = createAdmissionFormService();
  const application = service.createApplication({ studentFirstName: 'Ama', studentSurname: 'Mensah', classAppliedFor: 'Basic 4', healthInsuranceNumber: 'NHIS-1234' }, { id: 'parent-1', portal: 'parent' });
  assert.equal(application.section1.admissionType, 'FIRST_TIME');
  assert.equal(application.section1.healthInsuranceNumber, 'NHIS-1234');
  const withoutInsurance = service.createApplication({ studentFirstName: 'Kojo', studentSurname: 'Mensah', classAppliedFor: 'Basic 4' }, { id: 'parent-2', portal: 'parent' });
  assert.equal(withoutInsurance.section1.healthInsuranceNumber, null);
  assert.throws(() => service.createApplication({ studentFirstName: 'Esi', studentSurname: 'Mensah', classAppliedFor: 'Basic 4', healthInsuranceNumber: '!' }, { id: 'parent-3', portal: 'parent' }), /Health insurance/);
  assert.throws(() => service.updateApplication(withoutInsurance.applicationNumber, { healthInsuranceNumber: '!' }, { id: 'parent-2', portal: 'parent' }), /Health insurance/);
  assert.equal(service.getApplication(withoutInsurance.applicationNumber, { id: 'parent-2', portal: 'parent' }).section1.healthInsuranceNumber, null);
});
