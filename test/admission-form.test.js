import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../src/server.js';
import { createAuthService } from '../src/auth.js';
import { DEFAULT_ADMISSION_FEES, createAdmissionFormService, feeDivisionForClass } from '../src/admission-form.js';

test('official admission form preserves five sections, class divisions, snapshots and secure documents', () => {
  const service = createAdmissionFormService({ now: () => '2026-09-02T00:00:00.000Z' });
  const parent = { id: 'parent-1', portal: 'parent', schoolId: 'school-osaah-daylight' };
  const application = service.createApplication({ studentSurname: 'Mensah', studentFirstName: 'Ama', dateOfBirth: '2018-01-01', gender: 'FEMALE', hometown: 'Bogoso', region: 'Western', nationality: 'Ghanaian', classAppliedFor: 'Basic 4', residentialAddress: 'Bogoso', digitalAddress: 'WS-000-0000', nearestLandmark: 'School', academicYear: '2026', admissionTerm: 'TERM_1', primaryGuardianFullName: 'Kwame Mensah', secondaryGuardianFullName: 'Adwoa Mensah' }, parent);
  assert.equal(application.temporaryApplicationId.startsWith('TMP-'), true);
  assert.equal(application.status, 'DRAFT');
  assert.equal(feeDivisionForClass('Basic 4'), 'PRIMARY');
  assert.equal(feeDivisionForClass('KG 1'), 'KINDERGARTEN');
  for (const documentType of ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT']) service.attachDocument(application.applicationNumber, { documentType, fileReference: `secure/${documentType.toLowerCase()}` }, parent);
  service.updateApplication(application.applicationNumber, { parentDeclarationAccepted: true, parentSignatureReference: 'signature-key', parentDeclarationDate: '2026-09-02' }, parent);
  const fee = service.createFeeStructure({ level: 'PRIMARY', academicYear: '2026', term: 'TERM_1', ...DEFAULT_ADMISSION_FEES.PRIMARY }, { userId: 'bursar-1' });
  assert.equal(fee.totalTermlyFee, 650);
  const edited = service.updateFeeStructure(fee.id, { tuitionAcademicFee: 600 }, { userId: 'bursar-1' });
  assert.equal(edited.totalTermlyFee, 750);
  service.publishFeeStructure(fee.id, { userId: 'proprietor-1', roleKey: 'PROPRIETOR' });
  assert.equal(service.listFeeStructures({ publishedOnly: true }).length, 1);
  assert.equal(service.listFeeStructures({ publishedOnly: true })[0].publisherRole, 'PROPRIETOR');
  const submitted = service.submitApplication(application.applicationNumber, parent, service.activeFeeFor('Basic 4', '2026', 'TERM_1'));
  assert.equal(submitted.status, 'SUBMITTED');
  assert.equal(submitted.feeSnapshot.totalTermlyFee, 750);
  assert.equal(service.listDocuments(application.applicationNumber, parent).length, 4);
  const reviewed = service.reviewApplication(application.applicationNumber, { status: 'ACCEPTED', entranceAssessmentScore: 82, classAssigned: 'basic-4a' }, { id: 'headteacher-1', roleKey: 'HEADTEACHER' });
  assert.equal(reviewed.officialUse.permanentStudentId, 'OSAAH/2026/0001');
  assert.equal(service.reviewApplication(application.applicationNumber, { status: 'ACCEPTED' }, { id: 'headteacher-1', roleKey: 'HEADTEACHER' }).officialUse.permanentStudentId, 'OSAAH/2026/0001');
  assert.throws(() => service.reviewApplication(application.applicationNumber, { status: 'REJECTED', rejectionReason: 'Late review' }, { id: 'headteacher-1', roleKey: 'HEADTEACHER' }), /eligible/);
});

test('admission review requires rejection reasons and protects annual permanent ID capacity', () => {
  const service = createAdmissionFormService({ now: () => '2026-09-02T00:00:00.000Z' });
  const reviewer = { id: 'assistant-1', roleKey: 'ASSISTANT_HEADTEACHER', portal: 'school' };
  const createSubmitted = (firstName) => { const record = service.createApplication({ studentSurname: 'Abban', studentFirstName: firstName, dateOfBirth: '2018-01-01', gender: 'Male', hometown: 'Bogoso', region: 'Western', nationality: 'Ghanaian', classAppliedFor: 'Basic 4', residentialAddress: 'Bogoso', digitalAddress: 'WS-000-0000', nearestLandmark: 'School', academicYear: '2026', admissionTerm: 'TERM_1' }, { id: `parent-${firstName}`, portal: 'parent' }); service.updateApplication(record.applicationNumber, { parentDeclarationAccepted: true }, { id: `parent-${firstName}`, portal: 'parent' }); for (const documentType of ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT']) service.attachDocument(record.applicationNumber, { documentType, fileReference: documentType }, { id: `parent-${firstName}`, portal: 'parent' }); return service.submitApplication(record.applicationNumber, { id: `parent-${firstName}`, portal: 'parent' }); };
  const first = createSubmitted('Frank');
  assert.throws(() => service.reviewApplication(first.applicationNumber, { status: 'REJECTED' }, reviewer), /reason/);
  const rejected = service.reviewApplication(first.applicationNumber, { status: 'REJECTED', rejectionReason: 'Incomplete assessment' }, reviewer);
  assert.equal(rejected.officialUse.permanentStudentId, null);
  const second = createSubmitted('George');
  const accepted = service.reviewApplication(second.applicationNumber, { status: 'ACCEPTED', entranceAssessmentScore: 75, classAssigned: 'basic-4a' }, reviewer);
  assert.equal(accepted.officialUse.permanentStudentId, 'OSAAH/2026/0001');
});

test('admission form migration contains relational constraints and versioned fee publication', async () => {
  const schema = await readFile(new URL('../schema/015_admission_form_fee_engine.sql', import.meta.url), 'utf8');
  assert.match(schema, /temporary_application_id TEXT NOT NULL UNIQUE/);
  assert.match(schema, /application_number TEXT NOT NULL UNIQUE/);
  assert.match(schema, /entrance_assessment_score|official_use JSON/);
  assert.match(schema, /CHECK \(status IN \('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED'\)\)/);
  assert.match(schema, /total_termly_fee NUMERIC.*GENERATED ALWAYS/);
  assert.match(schema, /uq_admission_fee_active/);
});

test('admission form endpoints enforce parent and fee authority server-side', async () => {
  const auth = createAuthService();
  const parent = auth.login({ username: 'parent@example.com', password: 'Parent123!', portal: 'parent' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, method: options.method ?? 'GET', headers: { Authorization: `Bearer ${options.token ?? ''}`, 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
  try {
    assert.equal(await request('/api/admission-fees', { token: parent.token }), 200);
    assert.equal(await request('/api/admission-fees', { token: teacher.token }), 403);
    assert.equal(await request('/api/admission-applications', { method: 'POST', token: teacher.token, body: {} }), 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
