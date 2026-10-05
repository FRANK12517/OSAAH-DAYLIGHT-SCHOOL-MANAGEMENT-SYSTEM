import { randomUUID } from 'node:crypto';

const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => Array.isArray(value) ? value : [];
const pick = (...items) => items.find((item) => item !== undefined && item !== null && item !== '') ?? null;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function parse(value, fallback = {}) { if (!value) return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { fail('Admission applicant data is invalid.', 409); } }
function recordFromRow(row) {
  const applicant = parse(row.applicant_data ?? row.applicantData);
  const officialUse = applicant.officialUse ?? {};
  const record = { id: row.id, schoolId: row.school_id ?? row.schoolId, applicationNumber: row.application_number ?? row.applicationNumber, academicYear: applicant.academicYear ?? null, admissionTerm: applicant.admissionTerm ?? null, applicationDate: applicant.applicationDate ?? row.created_at?.slice?.(0, 10) ?? null, status: String(row.stage ?? row.status ?? applicant.status ?? 'DRAFT').toUpperCase(), parentUserId: applicant.parentUserId ?? null, section1: { ...applicant }, section2: { ...applicant }, section3: { ...applicant }, parentDeclarationAccepted: Boolean(applicant.parentDeclarationAccepted), parentSignatureReference: applicant.parentSignatureReference ?? null, parentDeclarationDate: applicant.parentDeclarationDate ?? null, officialUse: { entranceAssessmentScore: officialUse.entranceAssessmentScore ?? null, classAssigned: officialUse.classAssigned ?? null, admissionGranted: officialUse.admissionGranted ?? recordStatusAccepted(row), permanentStudentId: row.permanent_student_id ?? officialUse.permanentStudentId ?? null, studentId: row.student_id ?? applicant.studentId ?? null, reviewerId: officialUse.reviewerId ?? null, reviewerRole: officialUse.reviewerRole ?? null, reviewedAt: officialUse.reviewedAt ?? null }, feeSnapshot: applicant.feeSnapshot ?? null, documents: applicant.documents ?? [], studentId: row.student_id ?? applicant.studentId ?? null, createdAt: row.created_at ?? row.createdAt ?? null, updatedAt: row.updated_at ?? row.updatedAt ?? null };
  return clone(record);
}
function recordStatusAccepted(row) { return String(row.stage ?? '').toUpperCase() === 'ACCEPTED'; }
function payload(record) { return { ...record.section1, ...record.section2, ...record.section3, academicYear: record.academicYear, admissionTerm: record.admissionTerm, applicationDate: record.applicationDate, parentUserId: record.parentUserId, parentDeclarationAccepted: record.parentDeclarationAccepted, parentSignatureReference: record.parentSignatureReference, parentDeclarationDate: record.parentDeclarationDate, officialUse: record.officialUse, feeSnapshot: record.feeSnapshot, documents: record.documents ?? [] }; }

export function createDurableAdmissionsService({ database, schoolId, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.query || !database?.execute) return null;
  async function load(applicationNumber, actor) {
    const row = rows(await database.query('SELECT * FROM admission_applications WHERE school_id=? AND application_number=? LIMIT 1', [actor.schoolId ?? schoolId, applicationNumber]))[0];
    if (!row) return null;
    const result = recordFromRow(row);
    if (actor.portal === 'parent' && result.parentUserId !== actor.id) return null;
    return result;
  }
  async function nextNumber() {
    const last = rows(await database.query('SELECT application_number AS applicationNumber FROM admission_applications WHERE school_id=? ORDER BY created_at DESC,application_number DESC LIMIT 1', [schoolId]))[0]?.applicationNumber;
    const match = /^APP-(\d+)$/.exec(String(last ?? ''));
    return `APP-${String(match ? Number(match[1]) + 1 : 1).padStart(6, '0')}`;
  }
  async function createApplication(input, actor) {
    if (!input?.studentSurname || !input?.studentFirstName || !input?.classAppliedFor) fail('Candidate name and a valid class are required.');
    const now = clock(); const applicationNumber = await nextNumber(); const id = idFactory();
    const record = { id, schoolId: actor.schoolId ?? schoolId, applicationNumber, academicYear: input.academicYear ?? null, admissionTerm: input.admissionTerm ?? null, applicationDate: input.applicationDate ?? now.slice(0, 10), status: 'DRAFT', parentUserId: actor.portal === 'parent' ? actor.id : input.parentUserId ?? null, section1: { ...input }, section2: { ...input }, section3: { ...input }, parentDeclarationAccepted: false, parentSignatureReference: null, parentDeclarationDate: null, officialUse: { entranceAssessmentScore: null, classAssigned: null, admissionGranted: null, permanentStudentId: null, studentId: null, reviewerId: null, reviewerRole: null, reviewedAt: null }, feeSnapshot: null, createdAt: now, updatedAt: now };
    await database.execute('INSERT INTO admission_applications (id,school_id,application_number,stage,applicant_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, record.schoolId, applicationNumber, 'DRAFT', JSON.stringify(payload(record)), now, now]);
    return clone(record);
  }
  async function listApplications(filters = {}, actor) {
    const records = rows(await database.query('SELECT * FROM admission_applications WHERE school_id=? ORDER BY created_at DESC,application_number DESC', [actor.schoolId ?? schoolId])).map(recordFromRow).filter((record) => (actor.portal !== 'parent' || record.parentUserId === actor.id) && (!filters.status || record.status === String(filters.status).toUpperCase()) && (!filters.academicYear || record.academicYear === filters.academicYear) && (!filters.term || record.admissionTerm === filters.term));
    return records;
  }
  async function updateApplication(applicationNumber, input, actor) {
    const record = await load(applicationNumber, actor); if (!record || (actor.portal === 'parent' && record.status !== 'DRAFT')) fail('Application not found or cannot be edited.');
    Object.assign(record.section1, input); Object.assign(record.section2, input); Object.assign(record.section3, input); if (input.parentDeclarationAccepted !== undefined) record.parentDeclarationAccepted = Boolean(input.parentDeclarationAccepted); record.academicYear = input.academicYear ?? record.academicYear; record.admissionTerm = input.admissionTerm ?? record.admissionTerm; record.updatedAt = clock();
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(record);
  }
  async function submitApplication(applicationNumber, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); record.status = 'SUBMITTED'; record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', ['SUBMITTED', JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function reviewApplication(applicationNumber, input, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); if (!['ACCEPTED', 'REJECTED', 'UNDER_REVIEW'].includes(input.status)) fail('Invalid application status.'); record.status = input.status; record.officialUse = { ...record.officialUse, entranceAssessmentScore: input.entranceAssessmentScore ?? record.officialUse.entranceAssessmentScore, classAssigned: input.classAssigned ?? record.officialUse.classAssigned, admissionGranted: input.status === 'ACCEPTED', reviewerId: actor.id, reviewerRole: actor.roleKey, reviewedAt: clock() }; record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [record.status, JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function attachStudent(applicationNumber, student, actor) { const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404); const studentId = typeof student === 'string' ? student : student.id; record.studentId = studentId; record.officialUse.studentId = studentId; record.officialUse.permanentStudentId = typeof student === 'string' ? record.officialUse.permanentStudentId : (student.permanentStudentId ?? student.permanent_student_id ?? record.officialUse.permanentStudentId); record.updatedAt = clock(); await database.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [record.studentId, record.officialUse.permanentStudentId, 'ENROLLMENT', JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]); return clone(record); }
  async function attachDocument(applicationNumber, input, actor) {
    const record = await load(applicationNumber, actor); if (!record) fail('Application not found.', 404);
    if (!input?.documentType || !input?.fileReference) fail('Invalid admission document.');
    record.documents = [...(record.documents ?? []), { id: idFactory(), applicationNumber, schoolId: actor.schoolId ?? schoolId, documentType: input.documentType, fileReference: input.fileReference, uploadedAt: clock(), verified: false }];
    record.updatedAt = clock();
    await database.execute('UPDATE admission_applications SET applicant_data=?,updated_at=? WHERE school_id=? AND application_number=?', [JSON.stringify(payload(record)), record.updatedAt, actor.schoolId ?? schoolId, applicationNumber]);
    return clone(record.documents.at(-1));
  }
  async function listDocuments(applicationNumber, actor) { const record = await load(applicationNumber, actor); return record?.documents ?? []; }
  return Object.freeze({ createApplication, listApplications, getApplication: load, updateApplication, submitApplication, reviewApplication, attachStudent, attachDocument, listDocuments });
}
