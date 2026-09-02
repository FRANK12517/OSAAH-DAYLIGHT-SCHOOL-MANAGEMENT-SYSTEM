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
  service.publishFeeStructure(fee.id, { userId: 'proprietor-1' });
  const submitted = service.submitApplication(application.applicationNumber, parent, service.activeFeeFor('Basic 4', '2026', 'TERM_1'));
  assert.equal(submitted.status, 'SUBMITTED');
  assert.equal(submitted.feeSnapshot.totalTermlyFee, 650);
  assert.equal(service.listDocuments(application.applicationNumber, parent).length, 4);
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
